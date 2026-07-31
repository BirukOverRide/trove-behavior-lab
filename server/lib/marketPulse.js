/**
 * General real-time AI market analysis — aggregate pulse of the whole system.
 */
const { db, money } = require('../db');
const { PERSONAS } = require('./behaviorEngine');

function getInferenceCacheSafe() {
  // Lazy require avoids circular dependency with realtimeAi
  try {
    return require('./realtimeAi').getInferenceCache();
  } catch {
    return [];
  }
}

function countSince(minutes, type = null) {
  if (type) {
    return db
      .prepare(
        `SELECT COUNT(*) AS c FROM behavior_events
         WHERE datetime(created_at) >= datetime('now', ?) AND type = ?`
      )
      .get(`-${minutes} minutes`, type).c;
  }
  return db
    .prepare(
      `SELECT COUNT(*) AS c FROM behavior_events
       WHERE datetime(created_at) >= datetime('now', ?)`
    )
    .get(`-${minutes} minutes`).c;
}

function typeBreakdown(minutes) {
  return db
    .prepare(
      `SELECT type, COUNT(*) AS c FROM behavior_events
       WHERE datetime(created_at) >= datetime('now', ?)
       GROUP BY type ORDER BY c DESC`
    )
    .all(`-${minutes} minutes`);
}

function hotProducts(minutes = 30, limit = 8) {
  return db
    .prepare(
      `SELECT e.product_id,
              p.title,
              p.brand,
              c.name AS category,
              SUM(CASE WHEN e.type = 'view_product' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN e.type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM behavior_events e
       LEFT JOIN products p ON p.id = e.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE e.product_id IS NOT NULL
         AND datetime(e.created_at) >= datetime('now', ?)
       GROUP BY e.product_id
       ORDER BY (views + carts * 3 + purchases * 8) DESC
       LIMIT ?`
    )
    .all(`-${minutes} minutes`, limit)
    .map((r) => ({
      productId: r.product_id,
      title: r.title || r.product_id,
      brand: r.brand,
      category: r.category,
      views: r.views,
      carts: r.carts,
      purchases: r.purchases,
      heat: r.views + r.carts * 3 + r.purchases * 8,
    }));
}

function recentOrders(limit = 8) {
  return db
    .prepare(
      `SELECT id, user_id, total_cents, placed_at, status FROM orders
       ORDER BY placed_at DESC LIMIT ?`
    )
    .all(limit)
    .map((o) => ({
      orderId: o.id,
      userId: o.user_id,
      total: money(o.total_cents),
      placedAt: o.placed_at,
      status: o.status,
    }));
}

function personaMix() {
  return db
    .prepare(
      `SELECT persona, COUNT(*) AS c,
              AVG(purchase_intent) AS avg_intent,
              AVG(abandon_risk) AS avg_risk
       FROM consumer_profiles
       WHERE event_count >= 2
       GROUP BY persona
       ORDER BY c DESC`
    )
    .all()
    .map((r) => ({
      persona: r.persona,
      label: PERSONAS[r.persona]?.label || r.persona,
      count: r.c,
      avgIntent: Math.round(r.avg_intent || 0),
      avgRisk: Math.round(r.avg_risk || 0),
    }));
}

function buildBriefing(pulse) {
  const lines = [];
  const { window, funnel, marketMood, alerts } = pulse;

  lines.push(
    `Last ${window.minutes}m: ${window.events} events · ${window.searches} searches · ${window.views} product views · ${window.carts} carts · ${window.purchases} purchases.`
  );

  if (funnel.viewToCart != null) {
    lines.push(
      `Live funnel: view→cart ${funnel.viewToCart}% · cart→checkout ${funnel.cartToCheckout}% · checkout→buy ${funnel.checkoutToBuy}%.`
    );
  }

  lines.push(`Market mood: ${marketMood.label} — ${marketMood.detail}`);

  if (pulse.hotProducts[0]) {
    lines.push(
      `Hottest SKU: “${pulse.hotProducts[0].title}” (heat ${pulse.hotProducts[0].heat}).`
    );
  }

  if (pulse.personas[0]) {
    lines.push(
      `Dominant persona: ${pulse.personas[0].label} (${pulse.personas[0].count} profiles, avg intent ${pulse.personas[0].avgIntent}).`
    );
  }

  if (pulse.model.liveClassifications > 0) {
    lines.push(
      `Model live: ${pulse.model.liveClassifications} classifications · avg conf ${(pulse.model.avgConfidence * 100).toFixed(0)}% · top label “${pulse.model.topLabel || '—'}”.`
    );
  } else {
    lines.push('Model has no live classifications yet — run bots or wait for shop traffic.');
  }

  for (const a of alerts.slice(0, 3)) {
    lines.push(`⚠ ${a.message}`);
  }

  return lines;
}

function computeMood(funnel, windowStats) {
  const buyRate = windowStats.events
    ? (100 * windowStats.purchases) / windowStats.events
    : 0;
  if (windowStats.purchases >= 3 && funnel.viewToCart >= 15) {
    return {
      label: 'Bullish',
      score: 80,
      detail: 'Purchases flowing with healthy cart conversion.',
    };
  }
  if (windowStats.carts >= 5 && windowStats.purchases === 0) {
    return {
      label: 'Abandon pressure',
      score: 35,
      detail: 'Carts without purchases — recovery opportunity.',
    };
  }
  if (windowStats.views >= 10 && windowStats.carts <= 1) {
    return {
      label: 'Browse-heavy',
      score: 45,
      detail: 'Lots of views, little cart action — research mode.',
    };
  }
  if (windowStats.events < 5) {
    return {
      label: 'Quiet',
      score: 20,
      detail: 'Low traffic in this window — hit Play on the fleet.',
    };
  }
  if (buyRate >= 2) {
    return {
      label: 'Healthy',
      score: 65,
      detail: 'Balanced mix of browse and conversion.',
    };
  }
  return {
    label: 'Mixed',
    score: 50,
    detail: 'Signals present but no clear conversion spike.',
  };
}

/**
 * Full real-time general analysis snapshot.
 */
function getRealtimeAnalysis({ minutes = 30 } = {}) {
  const m = Math.max(5, Math.min(180, Number(minutes) || 30));

  const events = countSince(m);
  const searches = countSince(m, 'search');
  const views = countSince(m, 'view_product');
  const carts = countSince(m, 'add_to_cart');
  const checkouts = countSince(m, 'begin_checkout');
  const purchases = countSince(m, 'purchase');
  const logins = countSince(m, 'login');

  const windowStats = {
    minutes: m,
    events,
    searches,
    views,
    carts,
    checkouts,
    purchases,
    logins,
    eventsPerMinute: Math.round((events / m) * 10) / 10,
  };

  const funnel = {
    views,
    carts,
    checkouts,
    purchases,
    viewToCart: views ? Math.round((1000 * carts) / views) / 10 : 0,
    cartToCheckout: carts ? Math.round((1000 * checkouts) / carts) / 10 : 0,
    checkoutToBuy: checkouts
      ? Math.round((1000 * purchases) / checkouts) / 10
      : 0,
    viewToBuy: views ? Math.round((1000 * purchases) / views) / 10 : 0,
  };

  const marketMood = computeMood(funnel, windowStats);
  const types = typeBreakdown(m);
  const hot = hotProducts(m, 8);
  const personas = personaMix();
  const orders = recentOrders(8);

  // High intent / high risk from profiles (not just window)
  const highIntent = db
    .prepare(
      `SELECT profile_key, display_name, persona, purchase_intent, abandon_risk, last_active
       FROM consumer_profiles
       WHERE purchase_intent >= 55
       ORDER BY purchase_intent DESC LIMIT 10`
    )
    .all()
    .map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      label: PERSONAS[r.persona]?.label || r.persona,
      intent: r.purchase_intent,
      risk: r.abandon_risk,
      lastActive: r.last_active,
    }));

  const highRisk = db
    .prepare(
      `SELECT profile_key, display_name, persona, purchase_intent, abandon_risk, last_active
       FROM consumer_profiles
       WHERE abandon_risk >= 50 AND purchase_intent >= 25
       ORDER BY abandon_risk DESC LIMIT 10`
    )
    .all()
    .map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      label: PERSONAS[r.persona]?.label || r.persona,
      intent: r.purchase_intent,
      risk: r.abandon_risk,
      lastActive: r.last_active,
    }));

  const cache = getInferenceCacheSafe();
  const confs = cache
    .map((c) => c.transformer?.confidence)
    .filter((c) => typeof c === 'number');
  const labelCounts = {};
  for (const c of cache) {
    const lab = c.transformer?.label;
    if (lab) labelCounts[lab] = (labelCounts[lab] || 0) + 1;
  }
  const topLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0];

  const model = {
    liveClassifications: cache.length,
    avgConfidence: confs.length
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000
      : 0,
    topLabel: topLabel ? topLabel[0] : null,
    topLabelCount: topLabel ? topLabel[1] : 0,
    recent: cache.slice(0, 12).map((c) => ({
      profileKey: c.profileKey,
      displayName: c.displayName,
      isBot: c.isBot,
      botId: c.botId,
      rulePersona: c.rulePersona,
      modelLabel: c.transformer?.label,
      confidence: c.transformer?.confidence,
      intent: c.scores?.purchaseIntent,
      lastEventType: c.lastEventType,
      updatedAt: c.updatedAt,
    })),
  };

  const totals = {
    allEvents: db.prepare('SELECT COUNT(*) AS c FROM behavior_events').get().c,
    profiles: db.prepare('SELECT COUNT(*) AS c FROM consumer_profiles').get().c,
    bots: db.prepare('SELECT COUNT(*) AS c FROM bots').get().c,
    orders: db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
    revenue: money(
      db.prepare('SELECT COALESCE(SUM(total_cents),0) AS s FROM orders').get().s
    ),
  };

  const alerts = [];
  if (windowStats.carts >= 5 && windowStats.purchases === 0) {
    alerts.push({
      level: 'warn',
      code: 'CART_NO_BUY',
      message: `${windowStats.carts} carts in ${m}m with zero purchases — abandon wave.`,
    });
  }
  if (funnel.viewToCart < 5 && windowStats.views >= 20) {
    alerts.push({
      level: 'info',
      code: 'LOW_CART_RATE',
      message: `View→cart only ${funnel.viewToCart}% — catalog interest without intent.`,
    });
  }
  if (highRisk.length >= 5) {
    alerts.push({
      level: 'warn',
      code: 'RISK_CLUSTER',
      message: `${highRisk.length} profiles with elevated abandon risk — open recovery queue.`,
    });
  }
  if (model.avgConfidence > 0 && model.avgConfidence < 0.4) {
    alerts.push({
      level: 'info',
      code: 'LOW_MODEL_CONF',
      message: 'Model confidence is low — retrain Tiny AI with more journeys.',
    });
  }
  if (windowStats.eventsPerMinute >= 20) {
    alerts.push({
      level: 'ok',
      code: 'TRAFFIC_SPIKE',
      message: `High velocity: ~${windowStats.eventsPerMinute} events/min.`,
    });
  }

  const pulse = {
    generatedAt: new Date().toISOString(),
    window: windowStats,
    funnel,
    marketMood,
    types,
    hotProducts: hot,
    personas,
    highIntent,
    highRisk,
    recentOrders: orders,
    model,
    totals,
    alerts,
  };

  pulse.briefing = buildBriefing(pulse);
  return pulse;
}

/** Throttled publisher for SSE */
let lastPublish = 0;
function maybePublishPulse(publishFn, minIntervalMs = 2500) {
  const now = Date.now();
  if (now - lastPublish < minIntervalMs) return null;
  lastPublish = now;
  try {
    const pulse = getRealtimeAnalysis({ minutes: 30 });
    publishFn('market_pulse', pulse);
    return pulse;
  } catch (e) {
    console.error('market pulse:', e.message);
    return null;
  }
}

module.exports = {
  getRealtimeAnalysis,
  maybePublishPulse,
  buildBriefing,
};
