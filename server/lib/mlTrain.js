/**
 * Tiny Transformer training orchestrator for admin console.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuid } = require('uuid');
const { db } = require('../db');
const { eventToken, upsertConsumerProfile, profileKeyFor } = require('./behaviorEngine');
const { publish } = require('./liveBus');

const ML_DIR = path.join(__dirname, '..', '..', 'ml_transformer');
const MODELS_DIR = path.join(ML_DIR, 'models');
const DATA_DIR = path.join(ML_DIR, 'models', 'runs');
const MODEL_PATH = path.join(MODELS_DIR, 'shop_tf.npz');
const PROGRESS_PATH = path.join(MODELS_DIR, 'train_progress.json');
const AUTO_STATE_PATH = path.join(MODELS_DIR, 'auto_train_state.json');
const LOCK_PATH = path.join(MODELS_DIR, 'train.lock');

let currentJob = null; // in-memory live job

/** Continuous self-training — no manual button required */
const autoCfg = {
  enabled: process.env.AUTO_TRAIN !== '0',
  minExamples: 3,
  /** Retrain when this many new journeys appear (or any growth if model missing) */
  minNewExamples: Number(process.env.AUTO_TRAIN_MIN_NEW) || 5,
  /** Cooldown between auto runs */
  minIntervalMs: Number(process.env.AUTO_TRAIN_INTERVAL_MS) || 90_000,
  /** Wait for a quiet window after events before training */
  debounceMs: Number(process.env.AUTO_TRAIN_DEBOUNCE_MS) || 15_000,
  /** Background poll even if no event hook fires */
  pollMs: Number(process.env.AUTO_TRAIN_POLL_MS) || 40_000,
  defaultEpochs: Number(process.env.AUTO_TRAIN_EPOCHS) || 16,
  /** Head+embedding training is stable at this LR */
  lr: Number(process.env.AUTO_TRAIN_LR) || 0.025,
  /**
   * While the fleet is playing, skip mid-event auto-trains.
   * One full train runs after fleet_done on ALL bot journeys.
   */
  waitForFleet: process.env.AUTO_TRAIN_WAIT_FLEET !== '0',
};

const autoState = {
  enabled: autoCfg.enabled,
  lastTrainAt: null,
  lastSampleCount: 0,
  lastDatasetSig: '',
  lastReason: null,
  lastError: null,
  lastResult: null,
  pendingReason: null,
  debounceTimer: null,
  pollTimer: null,
  started: false,
};

function loadAutoStateFile() {
  try {
    if (!fs.existsSync(AUTO_STATE_PATH)) return;
    const s = JSON.parse(fs.readFileSync(AUTO_STATE_PATH, 'utf8'));
    if (typeof s.enabled === 'boolean') autoState.enabled = s.enabled;
    autoState.lastTrainAt = s.lastTrainAt || null;
    autoState.lastSampleCount = s.lastSampleCount || 0;
    autoState.lastDatasetSig = s.lastDatasetSig || '';
  } catch {
    /* ignore */
  }
}

function saveAutoStateFile() {
  try {
    ensureDirs();
    fs.writeFileSync(
      AUTO_STATE_PATH,
      JSON.stringify(
        {
          enabled: autoState.enabled,
          lastTrainAt: autoState.lastTrainAt,
          lastSampleCount: autoState.lastSampleCount,
          lastDatasetSig: autoState.lastDatasetSig,
          lastReason: autoState.lastReason,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    /* ignore */
  }
}

function ensureDirs() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function datasetSignature(examples) {
  const labels = {};
  let pathLen = 0;
  for (const e of examples) {
    labels[e.label] = (labels[e.label] || 0) + 1;
    pathLen += (e.text || '').length;
  }
  const lab = Object.keys(labels)
    .sort()
    .map((k) => `${k}:${labels[k]}`)
    .join(',');
  return `${examples.length}|${pathLen}|${lab}`;
}

function pickAutoEpochs(n) {
  // More data needs care, not more chaotic epochs (early-stop handles rest)
  if (n < 8) return Math.min(autoCfg.defaultEpochs, 10);
  if (n < 50) return autoCfg.defaultEpochs;
  if (n < 200) return Math.min(16, autoCfg.defaultEpochs + 2);
  // Large fleets: one solid full-data pass, not endless long jobs
  if (n < 1000) return Math.min(18, autoCfg.defaultEpochs + 4);
  return Math.min(14, autoCfg.defaultEpochs + 2);
}

function isFleetPlaying() {
  if (!autoCfg.waitForFleet) return false;
  try {
    return !!require('./bots').getFleetRunStatus()?.running;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Prevent two trainers writing the same model (e.g. after server restart). */
function acquireTrainLock() {
  ensureDirs();
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const raw = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      if (raw.pid && pidAlive(raw.pid) && raw.pid !== process.pid) {
        // Another Node owns training
        return { ok: false, reason: 'lock_held', pid: raw.pid };
      }
      // Stale lock or our own — clear orphan python trainers for this model
      try {
        const { execSync } = require('child_process');
        execSync(
          `pkill -f '${ML_DIR.replace(/'/g, '')}/train_shop.py' 2>/dev/null || true`,
          { stdio: 'ignore' }
        );
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore corrupt lock */
  }
  fs.writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
  );
  return { ok: true };
}

function releaseTrainLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (!raw.pid || raw.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Schedule auto-train after activity (debounced).
 * Safe to call from every event / fleet finish.
 * Prefer one full train on ALL journeys after the fleet finishes.
 */
function scheduleAutoTrain(reason = 'data', { immediate = false } = {}) {
  if (!autoState.enabled) return { scheduled: false, reason: 'disabled' };
  // While bots are still playing, queue "train for all" for fleet_done only
  if (
    autoCfg.waitForFleet &&
    isFleetPlaying() &&
    reason !== 'fleet_done' &&
    reason !== 'manual' &&
    reason !== 'api'
  ) {
    autoState.pendingReason = 'fleet_pending';
    return { scheduled: false, reason: 'waiting_fleet' };
  }
  autoState.pendingReason = reason;
  if (autoState.debounceTimer) clearTimeout(autoState.debounceTimer);
  // fleet_done / manual → almost immediate full train on complete data
  const wait =
    immediate || reason === 'fleet_done' || reason === 'manual'
      ? 800
      : autoCfg.debounceMs;
  autoState.debounceTimer = setTimeout(() => {
    autoState.debounceTimer = null;
    tryAutoTrain(autoState.pendingReason || reason);
  }, wait);
  return { scheduled: true, reason, inMs: wait };
}

/**
 * Decide whether to train now. Never throws into request path.
 * Each run trains on ALL rebuildable bot + human journeys (train for all).
 */
function tryAutoTrain(reason = 'poll') {
  if (!autoState.enabled) {
    return { started: false, skip: 'disabled' };
  }
  if (currentJob) {
    autoState.pendingReason = reason;
    return { started: false, skip: 'already_training' };
  }

  // Don't burn CPU mid-fleet — one train after everyone has shopped
  if (
    autoCfg.waitForFleet &&
    isFleetPlaying() &&
    reason !== 'fleet_done' &&
    reason !== 'manual' &&
    reason !== 'api'
  ) {
    autoState.pendingReason = 'fleet_pending';
    return { started: false, skip: 'waiting_fleet' };
  }

  let examples;
  try {
    examples = buildTrainingExamples();
  } catch (e) {
    autoState.lastError = e.message;
    return { started: false, skip: 'build_failed', error: e.message };
  }

  if (examples.length < autoCfg.minExamples) {
    autoState.lastError = null;
    publish('auto_train', {
      status: 'waiting_data',
      reason,
      examples: examples.length,
      need: autoCfg.minExamples,
      message: `Auto-train waiting — need ≥${autoCfg.minExamples} journeys (have ${examples.length})`,
    });
    return { started: false, skip: 'too_few_examples', examples: examples.length };
  }

  const sig = datasetSignature(examples);
  const modelExists = fs.existsSync(MODEL_PATH);
  const now = Date.now();
  const sinceLast = autoState.lastTrainAt
    ? now - new Date(autoState.lastTrainAt).getTime()
    : Infinity;

  // fleet_done always allowed past cooldown if data changed (full-fleet retrain)
  const forceFull = reason === 'fleet_done' || reason === 'manual' || reason === 'api';

  // Cooldown (skip if we just trained on same-ish data)
  if (!forceFull && modelExists && sinceLast < autoCfg.minIntervalMs) {
    return {
      started: false,
      skip: 'cooldown',
      retryInMs: autoCfg.minIntervalMs - sinceLast,
    };
  }

  // Same dataset signature → nothing new to learn
  if (modelExists && sig === autoState.lastDatasetSig) {
    return { started: false, skip: 'no_new_data', samples: examples.length };
  }

  // Require growth unless forced full-fleet pass or signature path-length changed
  const growth = examples.length - (autoState.lastSampleCount || 0);
  if (
    !forceFull &&
    modelExists &&
    growth < autoCfg.minNewExamples &&
    sig === autoState.lastDatasetSig
  ) {
    return { started: false, skip: 'insufficient_growth', growth };
  }

  const epochs = pickAutoEpochs(examples.length);
  try {
    const result = startTraining({
      epochs,
      lr: autoCfg.lr,
      auto: true,
      reason,
    });
    autoState.lastReason = reason;
    autoState.lastError = null;
    publish('auto_train', {
      status: 'started',
      reason,
      ...result,
      message: `Full train started · ALL ${result.samples} journeys · ${result.epochs} epochs · reason: ${reason}`,
    });
    return { started: true, ...result };
  } catch (e) {
    autoState.lastError = e.message;
    publish('auto_train', {
      status: 'skipped',
      reason,
      error: e.message,
    });
    return { started: false, skip: 'start_failed', error: e.message };
  }
}

function getAutoTrainStatus() {
  const examples = (() => {
    try {
      return buildTrainingExamples().length;
    } catch {
      return 0;
    }
  })();
  const modelExists = fs.existsSync(MODEL_PATH);
  return {
    enabled: autoState.enabled,
    continuous: true,
    mode: autoState.enabled ? 'full_auto' : 'manual',
    minExamples: autoCfg.minExamples,
    minNewExamples: autoCfg.minNewExamples,
    minIntervalMs: autoCfg.minIntervalMs,
    debounceMs: autoCfg.debounceMs,
    pollMs: autoCfg.pollMs,
    defaultEpochs: autoCfg.defaultEpochs,
    lastTrainAt: autoState.lastTrainAt,
    lastSampleCount: autoState.lastSampleCount,
    lastReason: autoState.lastReason,
    lastError: autoState.lastError,
    lastResult: autoState.lastResult,
    pendingReason: autoState.pendingReason,
    trainingNow: !!currentJob,
    currentExamples: examples,
    modelExists,
    nextHint: !autoState.enabled
      ? 'Auto-train is off'
      : currentJob
        ? `Training on ALL ${examples} journeys…`
        : isFleetPlaying()
          ? 'Fleet playing — will train once on ALL bots when finished'
          : examples < autoCfg.minExamples
            ? `Need ${autoCfg.minExamples - examples} more journey(s)`
            : !modelExists
              ? 'Will train on ALL journeys as soon as data is ready'
              : 'Watching for new journey data — next train uses full fleet',
    trainForAll: true,
    waitForFleet: autoCfg.waitForFleet,
  };
}

function setAutoTrainEnabled(on) {
  autoState.enabled = !!on;
  saveAutoStateFile();
  publish('auto_train', {
    status: autoState.enabled ? 'enabled' : 'disabled',
    ...getAutoTrainStatus(),
  });
  if (autoState.enabled) scheduleAutoTrain('enabled', { immediate: true });
  return getAutoTrainStatus();
}

/**
 * Call once from server boot — starts continuous loop.
 */
function startAutoTrainLoop() {
  if (autoState.started) return getAutoTrainStatus();
  autoState.started = true;
  loadAutoStateFile();
  // Seed lastSampleCount from DB if we have completed runs
  try {
    const last = db
      .prepare(
        `SELECT samples FROM ml_training_runs WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`
      )
      .get();
    if (last?.samples && !autoState.lastSampleCount) {
      autoState.lastSampleCount = last.samples;
    }
  } catch {
    /* ignore */
  }

  // First pass shortly after boot (create model if missing / catch up)
  scheduleAutoTrain('boot', { immediate: false });
  setTimeout(() => tryAutoTrain('boot'), 4000);

  autoState.pollTimer = setInterval(() => {
    tryAutoTrain('poll');
  }, autoCfg.pollMs);
  if (autoState.pollTimer.unref) autoState.pollTimer.unref();

  console.log(
    `[auto-train] continuous ON · min ${autoCfg.minExamples} journeys · cooldown ${autoCfg.minIntervalMs}ms · poll ${autoCfg.pollMs}ms`
  );
  return getAutoTrainStatus();
}

function onTrainingFinished(ok, info = {}) {
  if (ok) {
    autoState.lastTrainAt = new Date().toISOString();
    autoState.lastSampleCount = info.samples ?? autoState.lastSampleCount;
    if (info.datasetSig) autoState.lastDatasetSig = info.datasetSig;
    autoState.lastResult = {
      trainAcc: info.train_acc,
      finalLoss: info.final_loss,
      samples: info.samples,
      at: autoState.lastTrainAt,
      reason: info.reason || autoState.lastReason,
    };
    autoState.lastError = null;
    saveAutoStateFile();
    // Drop stale inference results so live AI uses new weights
    try {
      require('./buyAnalysis').clearPredictCache?.();
    } catch {
      /* ignore */
    }
  }
  // If more data arrived during train, schedule another pass
  if (autoState.enabled) {
    const pending = autoState.pendingReason;
    autoState.pendingReason = null;
    setTimeout(() => tryAutoTrain(pending || 'post_train'), 2500);
  }
}

function buildTrainingExamples() {
  /**
   * Train for ALL: every bot with a real journey + every human profile.
   * Bot DNA persona is the label (designed ground truth).
   * No sample cap — full fleet goes into one training job.
   */
  const botByUser = new Map(
    db
      .prepare(`SELECT user_id, persona, id, display_name FROM bots`)
      .all()
      .map((b) => [b.user_id, b])
  );

  // Rebuild EVERY active bot that has events but a thin/missing profile (no 500 cap)
  const orphans = db
    .prepare(
      `SELECT b.user_id FROM bots b
       WHERE (b.sessions_run > 0 OR b.last_run_at IS NOT NULL)
         AND EXISTS (SELECT 1 FROM behavior_events e WHERE e.user_id = b.user_id)
         AND NOT EXISTS (
           SELECT 1 FROM consumer_profiles cp
           WHERE cp.profile_key = 'user:' || b.user_id
             AND cp.event_count >= 2
             AND cp.journey_path IS NOT NULL
             AND length(cp.journey_path) > 3
         )`
    )
    .all();
  for (const o of orphans) {
    try {
      upsertConsumerProfile(`user:${o.user_id}`);
    } catch {
      /* continue */
    }
  }

  const profiles = db
    .prepare(
      `SELECT profile_key, persona, journey_path, event_count, user_id, session_id
       FROM consumer_profiles
       WHERE event_count >= 2 AND journey_path IS NOT NULL AND length(journey_path) > 3`
    )
    .all();

  const examples = [];
  let botExamples = 0;
  let humanExamples = 0;
  for (const p of profiles) {
    const bot = p.user_id ? botByUser.get(p.user_id) : null;
    // Prefer designed DNA for bots so the model learns each bot's intended behavior
    const label = (bot?.persona || p.persona || 'window_shopper').trim() || 'window_shopper';
    examples.push({
      text: p.journey_path,
      label,
      source: bot ? 'bot' : 'consumer_profile',
      profileKey: p.profile_key,
      isBot: !!bot,
      botId: bot?.id || null,
    });
    if (bot) botExamples += 1;
    else humanExamples += 1;
  }

  // Fallback: rebuild from raw events if almost empty
  if (examples.length < 5) {
    const events = db
      .prepare('SELECT * FROM behavior_events ORDER BY created_at ASC, id ASC')
      .all();
    const byKey = {};
    for (const e of events) {
      const key = profileKeyFor({ userId: e.user_id, sessionId: e.session_id });
      if (!key) continue;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(e);
    }
    for (const [key, list] of Object.entries(byKey)) {
      if (list.length < 2) continue;
      const rebuilt = upsertConsumerProfile(key);
      const uid = key.startsWith('user:') ? key.slice(5) : null;
      const bot = uid ? botByUser.get(uid) : null;
      examples.push({
        text: list.map(eventToken).join(' '),
        label: bot?.persona || rebuilt?.persona || 'window_shopper',
        source: bot ? 'bot_events' : 'events',
        profileKey: key,
        isBot: !!bot,
        botId: bot?.id || null,
      });
      if (bot) botExamples += 1;
      else humanExamples += 1;
    }
  }

  // Deduplicate by profileKey keeping longest journey
  const map = new Map();
  for (const ex of examples) {
    const prev = map.get(ex.profileKey);
    if (!prev || ex.text.length > prev.text.length) map.set(ex.profileKey, ex);
  }
  // Training payload is only text+label (Python side)
  return [...map.values()].map(({ text, label }) => ({ text, label }));
}

/** How many bots vs humans feed the model (all active bot journeys when present). */
function getTrainingCoverage() {
  const botUsers = new Set(
    db.prepare(`SELECT user_id FROM bots`).all().map((b) => b.user_id)
  );
  const profiles = db
    .prepare(
      `SELECT user_id FROM consumer_profiles
       WHERE event_count >= 2 AND journey_path IS NOT NULL AND length(journey_path) > 3`
    )
    .all();
  let fromBots = 0;
  for (const p of profiles) {
    if (p.user_id && botUsers.has(p.user_id)) fromBots += 1;
  }
  return {
    total: profiles.length,
    fromBots,
    fromHumans: profiles.length - fromBots,
    botsInDb: botUsers.size,
    botsWithActivity: db
      .prepare(
        `SELECT COUNT(*) AS c FROM bots WHERE sessions_run > 0 OR last_run_at IS NOT NULL`
      )
      .get().c,
  };
}

function readProgressFile() {
  try {
    if (!fs.existsSync(PROGRESS_PATH)) return null;
    return JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function modelStats() {
  const exists = fs.existsSync(MODEL_PATH);
  let stat = null;
  if (exists) {
    const s = fs.statSync(MODEL_PATH);
    stat = {
      path: MODEL_PATH,
      sizeBytes: s.size,
      modifiedAt: s.mtime.toISOString(),
    };
  }
  return { exists, ...stat };
}

function listRuns(limit = 20) {
  return db
    .prepare(
      `SELECT * FROM ml_training_runs ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit)
    .map((r) => {
      const metrics = safeJson(r.metrics_json, {});
      return {
        id: r.id,
        status: r.status,
        epochs: r.epochs,
        samples: r.samples,
        trainAcc: r.train_acc,
        finalLoss: r.final_loss,
        vocabSize: r.vocab_size,
        seconds: r.seconds,
        history: safeJson(r.history_json, []),
        labelCounts: safeJson(r.label_counts_json, {}),
        metrics,
        perClassHistory: metrics.per_class_history || [],
        perClassMetrics: metrics.per_class_metrics || {},
        baselinePerClass: metrics.baseline_per_class || {},
        confusion: metrics.confusion || null,
        confusionLabels: metrics.confusion_labels || [],
        confidenceHist: metrics.confidence_hist || null,
        baselineConfidenceHist: metrics.baseline_confidence_hist || null,
        mistakes: metrics.mistakes || [],
        tokenStats: metrics.token_stats || {},
        exampleJourneys: metrics.example_journeys || {},
        evolution: metrics.evolution || null,
        diary: metrics.diary || [],
        meanConfidence: metrics.mean_confidence ?? null,
        meanTrueClassProb: metrics.mean_true_class_prob ?? null,
        meanEntropy: metrics.mean_entropy ?? null,
        error: r.error,
        modelPath: r.model_path,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
      };
    });
}

function safeJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function getLearningStatus() {
  const examples = buildTrainingExamples();
  const labelDist = {};
  for (const e of examples) {
    labelDist[e.label] = (labelDist[e.label] || 0) + 1;
  }
  const progress = readProgressFile();
  const model = modelStats();
  const runs = listRuns(15);
  const lastCompleted = runs.find((r) => r.status === 'completed') || null;

  // Dataset growth over time from events
  const eventCount = db.prepare('SELECT COUNT(*) AS c FROM behavior_events').get().c;
  const profileCount = db.prepare('SELECT COUNT(*) AS c FROM consumer_profiles').get().c;
  const botCount = db.prepare('SELECT COUNT(*) AS c FROM bots').get().c;

  // Live progress: full detail while training; slim snapshot when idle
  // (full completed metrics live on lastCompleted — avoid 150KB+ double payload)
  let liveProgress = null;
  if (progress) {
    if (progress.status === 'training' || progress.status === 'starting') {
      liveProgress = progress;
    } else if (progress.status === 'completed') {
      liveProgress = {
        status: 'completed',
        epoch: progress.epoch,
        epochs: progress.epochs,
        pct: 100,
        loss: progress.loss,
        train_acc: progress.train_acc,
        mean_confidence: progress.mean_confidence,
        mean_entropy: progress.mean_entropy,
        samples: progress.samples,
        seconds: progress.seconds,
      };
    } else if (progress.status === 'failed') {
      liveProgress = {
        status: 'failed',
        error: progress.error,
      };
    } else {
      liveProgress = progress;
    }
  }

  return {
    model: {
      name: 'TinyVisitorTransformer',
      description:
        'Small multi-head Transformer encoder that classifies shopper journey token sequences into consumer personas.',
      architecture: {
        type: 'TransformerEncoder',
        d_model: 64,
        n_heads: 4,
        n_layers: 2,
        d_ff: 128,
        max_len: 48,
      },
      labels: [
        'window_shopper',
        'product_browser',
        'bargain_hunter',
        'cart_builder',
        'cart_abandons',
        'high_intent',
        'loyal_buyer',
        'impulse_buyer',
        'category_loyal',
        'explorer',
      ],
      file: model,
      healthy: !!model.exists,
    },
    dataset: {
      trainableExamples: examples.length,
      labelDistribution: labelDist,
      behaviorEvents: eventCount,
      consumerProfiles: profileCount,
      bots: botCount,
      ready: examples.length >= 3,
      minRecommended: 10,
      // Full fleet learning coverage (not the old "50 bots" fleet report cap)
      coverage: getTrainingCoverage(),
    },
    live: currentJob
      ? {
          running: true,
          runId: currentJob.runId,
          startedAt: currentJob.startedAt,
          progress: liveProgress || { status: 'training' },
        }
      : {
          running: false,
          progress: liveProgress,
        },
    lastCompleted,
    runs,
    // Run-over-run evolution (what improved across trainings)
    evolutionAcrossRuns: runs
      .filter((r) => r.status === 'completed')
      .slice(0, 10)
      .reverse()
      .map((r, i) => ({
        index: i + 1,
        id: r.id,
        createdAt: r.createdAt,
        trainAcc: r.trainAcc,
        finalLoss: r.finalLoss,
        samples: r.samples,
        epochs: r.epochs,
        meanConfidence: r.meanConfidence,
      })),
    autoTrain: getAutoTrainStatus(),
  };
}

function startTraining({ epochs = 20, lr = 0.05, auto = false, reason = 'manual' } = {}) {
  if (currentJob) {
    throw new Error('Training already in progress');
  }
  const lock = acquireTrainLock();
  if (!lock.ok) {
    throw new Error(`Training already locked by another process (pid ${lock.pid})`);
  }
  ensureDirs();
  const examples = buildTrainingExamples();
  if (examples.length < 3) {
    releaseTrainLock();
    throw new Error(
      `Need at least 3 journey examples to train (have ${examples.length}). Run bots or shop more first.`
    );
  }

  const runId = uuid();
  const dataPath = path.join(DATA_DIR, `${runId}.json`);
  const datasetSig = datasetSignature(examples);
  // Full fleet payload — every journey text+label
  fs.writeFileSync(dataPath, JSON.stringify({ examples, trainForAll: true }, null, 2));

  db.prepare(
    `INSERT INTO ml_training_runs (id, status, epochs, samples, created_at)
     VALUES (?, 'running', ?, ?, datetime('now'))`
  ).run(runId, epochs, examples.length);

  fs.writeFileSync(
    PROGRESS_PATH,
    JSON.stringify({
      status: 'starting',
      epoch: 0,
      epochs,
      samples: examples.length,
      runId,
      auto: !!auto,
      reason,
      trainForAll: true,
    })
  );

  const py = process.env.PYTHON || 'python3';
  const args = [
    path.join(ML_DIR, 'train_shop.py'),
    '--data',
    dataPath,
    '--out',
    MODEL_PATH,
    '--progress',
    PROGRESS_PATH,
    '--epochs',
    String(epochs),
    '--lr',
    String(lr),
  ];

  let child;
  try {
    child = spawn(py, args, { cwd: ML_DIR });
  } catch (e) {
    releaseTrainLock();
    throw e;
  }
  let stdout = '';
  let stderr = '';

  currentJob = {
    runId,
    startedAt: new Date().toISOString(),
    child,
    auto: !!auto,
    reason,
    samples: examples.length,
    datasetSig,
  };

  child.stdout.on('data', (buf) => {
    stdout += buf.toString();
  });
  child.stderr.on('data', (buf) => {
    stderr += buf.toString();
  });

  // Push training progress to SSE clients while job runs
  const progressTimer = setInterval(() => {
    try {
      if (fs.existsSync(PROGRESS_PATH)) {
        const p = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
        publish('train', { runId, auto: !!auto, reason, ...p });
      }
    } catch {
      /* ignore */
    }
  }, 800);

  child.on('close', (code) => {
    clearInterval(progressTimer);
    const jobMeta = currentJob || {};
    let result = null;
    try {
      const lines = stdout.trim().split('\n').filter(Boolean);
      result = JSON.parse(lines[lines.length - 1] || '{}');
    } catch {
      result = { ok: false, error: stderr || 'parse failed' };
    }

    if (code === 0 && result.ok) {
      const metrics = {
        per_class_history: result.per_class_history || [],
        per_class_metrics: result.per_class_metrics || {},
        baseline_per_class: result.baseline_per_class || {},
        confusion: result.confusion || null,
        confusion_labels: result.confusion_labels || [],
        confidence_hist: result.confidence_hist || null,
        baseline_confidence_hist: result.baseline_confidence_hist || null,
        mistakes: result.mistakes || [],
        token_stats: result.token_stats || {},
        example_journeys: result.example_journeys || {},
        evolution: result.evolution || null,
        diary: result.diary || [],
        mean_confidence: result.mean_confidence ?? null,
        mean_true_class_prob: result.mean_true_class_prob ?? null,
        mean_entropy: result.mean_entropy ?? null,
      };
      // Prefer progress file if richer
      try {
        const p = readProgressFile();
        if (p && p.status === 'completed') {
          Object.assign(metrics, {
            per_class_history: p.per_class_history || metrics.per_class_history,
            per_class_metrics: p.per_class_metrics || metrics.per_class_metrics,
            baseline_per_class: p.baseline_per_class || metrics.baseline_per_class,
            confusion: p.confusion || metrics.confusion,
            confusion_labels: p.confusion_labels || metrics.confusion_labels,
            confidence_hist: p.confidence_hist || metrics.confidence_hist,
            baseline_confidence_hist:
              p.baseline_confidence_hist || metrics.baseline_confidence_hist,
            mistakes: p.mistakes || metrics.mistakes,
            token_stats: p.token_stats || metrics.token_stats,
            example_journeys: p.example_journeys || metrics.example_journeys,
            evolution: p.evolution || metrics.evolution,
            diary: p.diary || metrics.diary,
            mean_confidence: p.mean_confidence ?? metrics.mean_confidence,
            mean_true_class_prob:
              p.mean_true_class_prob ?? metrics.mean_true_class_prob,
            mean_entropy: p.mean_entropy ?? metrics.mean_entropy,
          });
        }
      } catch {
        /* ignore */
      }

      db.prepare(
        `UPDATE ml_training_runs SET
           status = 'completed',
           train_acc = ?,
           final_loss = ?,
           vocab_size = ?,
           seconds = ?,
           history_json = ?,
           label_counts_json = ?,
           metrics_json = ?,
           model_path = ?,
           finished_at = datetime('now')
         WHERE id = ?`
      ).run(
        result.train_acc ?? null,
        result.final_loss ?? null,
        result.vocab_size ?? null,
        result.seconds ?? null,
        JSON.stringify(result.history || []),
        JSON.stringify(result.label_counts || {}),
        JSON.stringify(metrics),
        MODEL_PATH,
        runId
      );
      publish('train', {
        runId,
        status: 'completed',
        auto: !!jobMeta.auto,
        reason: jobMeta.reason || reason,
        train_acc: result.train_acc,
        final_loss: result.final_loss,
        history: result.history,
        evolution: metrics.evolution,
        diary: metrics.diary,
        per_class_metrics: metrics.per_class_metrics,
        per_class_history: metrics.per_class_history,
        confusion: metrics.confusion,
        confidence_hist: metrics.confidence_hist,
        mistakes: metrics.mistakes,
        token_stats: metrics.token_stats,
        example_journeys: metrics.example_journeys,
        mean_confidence: metrics.mean_confidence,
        mean_entropy: metrics.mean_entropy,
      });
      publish('auto_train', {
        status: 'completed',
        auto: !!jobMeta.auto,
        reason: jobMeta.reason || reason,
        train_acc: result.train_acc,
        samples: result.samples,
        message: `Full train done · acc ${
          result.train_acc != null ? `${(result.train_acc * 100).toFixed(1)}%` : '—'
        } · ALL ${result.samples} journeys`,
      });
      currentJob = null;
      releaseTrainLock();
      onTrainingFinished(true, {
        samples: result.samples ?? jobMeta.samples,
        train_acc: result.train_acc,
        final_loss: result.final_loss,
        datasetSig: jobMeta.datasetSig,
        reason: jobMeta.reason || reason,
      });
    } else {
      const err = result.error || stderr || `exit ${code}`;
      db.prepare(
        `UPDATE ml_training_runs SET
           status = 'failed',
           error = ?,
           finished_at = datetime('now')
         WHERE id = ?`
      ).run(String(err).slice(0, 1000), runId);
      publish('train', {
        runId,
        status: 'failed',
        auto: !!jobMeta.auto,
        error: String(err).slice(0, 300),
      });
      publish('auto_train', {
        status: 'failed',
        error: String(err).slice(0, 300),
      });
      currentJob = null;
      releaseTrainLock();
      onTrainingFinished(false, { error: err });
    }
  });

  child.on('error', (err) => {
    clearInterval(progressTimer);
    currentJob = null;
    releaseTrainLock();
    console.error('train spawn error:', err.message);
  });

  return {
    runId,
    samples: examples.length,
    epochs,
    status: 'started',
    auto: !!auto,
    reason,
    trainForAll: true,
  };
}

module.exports = {
  getLearningStatus,
  startTraining,
  buildTrainingExamples,
  getTrainingCoverage,
  listRuns,
  scheduleAutoTrain,
  tryAutoTrain,
  getAutoTrainStatus,
  setAutoTrainEnabled,
  startAutoTrainLoop,
  MODEL_PATH,
  PROGRESS_PATH,
};
