/**
 * Real-time AI pipeline: every behavior event updates profiles quickly,
 * then (async) re-runs Tiny Transformer without blocking HTTP.
 */
const { db } = require('../db');
const {
  rebuildProfileFromEvent,
  profileKeyFor,
} = require('./behaviorEngine');
const { enqueueTransformerPredict } = require('./buyAnalysis');
const { publish } = require('./liveBus');
const { maybePublishPulse } = require('./marketPulse');

/** profileKey -> last inference */
const inferenceCache = new Map();
/** profileKey -> event count since last full infer */
const inferCounters = new Map();

const INFER_EVERY_N = 5;
// Keep hot path light: only infer on strong commerce signals (not every login)
const INFER_TYPES = new Set([
  'purchase',
  'add_to_cart',
  'begin_checkout',
  'view_product',
]);

function shouldInfer(type, profileKey) {
  if (INFER_TYPES.has(type)) return true;
  const n = (inferCounters.get(profileKey) || 0) + 1;
  inferCounters.set(profileKey, n);
  return n % INFER_EVERY_N === 0;
}

function lookupBot(userId) {
  if (!userId) return null;
  return db
    .prepare(
      `SELECT id, display_name, email, persona, sessions_run FROM bots WHERE user_id = ?`
    )
    .get(userId);
}

/**
 * Fast path — never blocks on Python. Safe to call from login/cart handlers.
 */
function processEventRealtime(row) {
  let profile = null;
  try {
    profile = rebuildProfileFromEvent(row);
  } catch (err) {
    console.error('profile rebuild:', err.message);
  }

  const profileKey = profileKeyFor({
    userId: row.user_id,
    sessionId: row.session_id,
  });

  let bot = null;
  try {
    bot = lookupBot(row.user_id);
  } catch {
    bot = null;
  }

  const eventPayload = {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    type: row.type,
    target: row.target,
    productId: row.product_id,
    path: row.path,
    createdAt: row.created_at || new Date().toISOString(),
    isBot: !!bot,
    botId: bot?.id || null,
    botName: bot?.display_name || null,
    profileKey,
  };

  try {
    publish('event', eventPayload);
  } catch {
    /* ignore */
  }

  if (profile) {
    try {
      publish('profile', {
        profileKey,
        displayName: profile.displayName,
        persona: profile.persona,
        purchaseIntent: profile.scores?.purchaseIntent,
        abandonRisk: profile.scores?.abandonRisk,
        eventCount: profile.eventCount || profile.counts?.totalEvents,
        isBot: !!bot,
        botId: bot?.id || null,
      });
    } catch {
      /* ignore */
    }
  }

  // Dataset stats — cheap SQL only
  if (
    row.type === 'purchase' ||
    row.type === 'add_to_cart' ||
    (row.id && Number(row.id) % 10 === 0)
  ) {
    try {
      publish('dataset', snapshotDataset());
    } catch {
      /* ignore */
    }
  }

  // General market pulse for Real-time Analysis page (throttled)
  if (
    row.type === 'purchase' ||
    row.type === 'add_to_cart' ||
    row.type === 'begin_checkout' ||
    (row.id && Number(row.id) % 8 === 0)
  ) {
    setImmediate(() => {
      try {
        maybePublishPulse(publish, 2500);
      } catch (e) {
        console.error('pulse publish:', e.message);
      }
    });
  }

  // Heavy TF inference: deferred + async (does not delay HTTP response)
  if (profileKey && profile && shouldInfer(row.type, profileKey)) {
    setImmediate(() => {
      runAsyncInfer(row, profile, profileKey, bot).catch((err) => {
        console.error('async infer:', err.message);
      });
    });
  }

  // Continuous self-training: new commerce data → schedule auto retrain
  if (
    row.type === 'purchase' ||
    row.type === 'add_to_cart' ||
    row.type === 'begin_checkout' ||
    row.type === 'view_product'
  ) {
    setImmediate(() => {
      try {
        require('./mlTrain').scheduleAutoTrain(row.type);
      } catch {
        /* ignore */
      }
    });
  }

  return { event: eventPayload, ai: null, profile };
}

async function runAsyncInfer(row, profile, profileKey, bot) {
  const stored = db
    .prepare(
      `SELECT journey_path, persona, purchase_intent, abandon_risk, engagement_score, display_name, event_count
       FROM consumer_profiles WHERE profile_key = ?`
    )
    .get(profileKey);

  const pathText =
    stored?.journey_path ||
    profile.journeyPath ||
    (profile.tokens && profile.tokens.join(' ')) ||
    '';

  const tf = await enqueueTransformerPredict(pathText);

  const aiUpdate = {
    profileKey,
    displayName: stored?.display_name || profile.displayName || profileKey,
    rulePersona: stored?.persona || profile.persona,
    scores: {
      purchaseIntent: stored?.purchase_intent ?? profile.scores?.purchaseIntent,
      abandonRisk: stored?.abandon_risk ?? profile.scores?.abandonRisk,
      engagement: stored?.engagement_score ?? profile.scores?.engagement,
    },
    transformer: tf.available
      ? {
          label: tf.label,
          confidence: tf.confidence,
          probs: (tf.probs || []).slice(0, 4),
        }
      : { available: false, reason: tf.reason },
    eventCount: stored?.event_count || profile.eventCount || profile.counts?.totalEvents,
    lastEventType: row.type,
    isBot: !!bot,
    botId: bot?.id || null,
    botName: bot?.display_name || null,
    updatedAt: new Date().toISOString(),
  };

  putInference(aiUpdate);
  inferCounters.set(profileKey, 0);
  publish('ai', aiUpdate);
  return aiUpdate;
}

function snapshotDataset() {
  const events = db.prepare('SELECT COUNT(*) AS c FROM behavior_events').get().c;
  const profiles = db.prepare('SELECT COUNT(*) AS c FROM consumer_profiles').get().c;
  const bots = db.prepare('SELECT COUNT(*) AS c FROM bots').get().c;
  const trainable = db
    .prepare(
      `SELECT COUNT(*) AS c FROM consumer_profiles
       WHERE event_count >= 2 AND journey_path IS NOT NULL AND length(journey_path) > 3`
    )
    .get().c;
  return {
    behaviorEvents: events,
    consumerProfiles: profiles,
    bots,
    trainableExamples: trainable,
    at: new Date().toISOString(),
  };
}

function getInferenceCache() {
  return [...inferenceCache.values()].sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
}

/** Write/update one live classification (used by fleet warm + async infer). */
function putInference(aiUpdate) {
  if (!aiUpdate?.profileKey) return;
  inferenceCache.set(aiUpdate.profileKey, aiUpdate);
  // Cap memory
  if (inferenceCache.size > 400) {
    const oldest = [...inferenceCache.entries()].sort((a, b) =>
      String(a[1].updatedAt || '').localeCompare(String(b[1].updatedAt || ''))
    );
    for (let i = 0; i < 50 && i < oldest.length; i++) {
      inferenceCache.delete(oldest[i][0]);
    }
  }
}

function getLiveSnapshot() {
  return {
    dataset: snapshotDataset(),
    recentAi: getInferenceCache().slice(0, 30),
    recentMessages: require('./liveBus').getRecent(40),
    serverTime: new Date().toISOString(),
  };
}

module.exports = {
  processEventRealtime,
  getInferenceCache,
  putInference,
  getLiveSnapshot,
  snapshotDataset,
};
