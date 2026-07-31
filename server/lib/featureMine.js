/**
 * Feature mining layer — turns events/profiles/TF into actionable products.
 */
const { db, mapProduct, money } = require('../db');
const { getProfile, profileKeyFor, PERSONAS } = require('./behaviorEngine');
const { getInferenceCache } = require('./realtimeAi');
const { analyzeAllBotsBuying } = require('./buyAnalysis');

function parseJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((1000 * n) / d) / 10;
}

/** Priority score for "who's about to buy" */
function buyerPriorityScore(row) {
  const intent = row.purchase_intent || 0;
  const risk = row.abandon_risk || 0;
  const engage = row.engagement_score || 0;
  const spentBoost = Math.min(20, (row.total_spent_cents || 0) / 1000);
  // high intent, not fully converted abandon-only, engaged
  return Math.round(intent * 0.55 + (100 - risk) * 0.2 + engage * 0.15 + spentBoost);
}

/**
 * Full consumer feature vector for a user or session.
 */
function getConsumerFeatures({ userId, sessionId }) {
  const key = profileKeyFor({ userId, sessionId });
  if (!key) {
    return { ok: false, error: 'Need userId or sessionId' };
  }

  let profile = getProfile(key);
  const row = db
    .prepare('SELECT * FROM consumer_profiles WHERE profile_key = ?')
    .get(key);

  if (!profile && !row) {
    return {
      ok: true,
      profileKey: key,
      userId: userId || null,
      features: {
        intent_score: 0,
        abandon_prob: 15,
        loyalty_score: 0,
        engagement_score: 0,
        price_sensitivity: 20,
        preferred_category_top3: [],
        preferred_brand_top3: [],
        tf_label: null,
        tf_confidence: 0,
        buyer_stage: 'cold',
        priority_score: 0,
      },
      insights: ['Not enough activity yet to score this shopper.'],
      recommendations: ['Continue browsing to build a signal.'],
    };
  }

  const scores = profile?.scores || {
    purchaseIntent: row?.purchase_intent || 0,
    abandonRisk: row?.abandon_risk || 0,
    engagement: row?.engagement_score || 0,
    loyalty: row?.loyalty_score || 0,
    priceSensitivity: row?.price_sensitivity || 0,
  };

  const cats = parseJson(row?.category_affinity || profile?.categoryAffinity, []);
  const brands = parseJson(row?.brand_affinity || profile?.brandAffinity, []);
  const journey = row?.journey_path || profile?.journeyPath || '';

  // Prefer live cache — never block shop personalize on Python spawn
  const live = getInferenceCache().find((c) => c.profileKey === key);
  const tf = live?.transformer?.label
    ? {
        available: true,
        label: live.transformer.label,
        confidence: live.transformer.confidence,
        probs: live.transformer.probs || [],
      }
    : { available: false, reason: 'Awaiting live classification' };

  let buyerStage = 'cold';
  const purchases = row?.purchase_count || 0;
  const intent = scores.purchaseIntent || 0;
  const risk = scores.abandonRisk || 0;
  if (purchases >= 2) buyerStage = 'loyal_customer';
  else if (purchases === 1) buyerStage = 'converted_once';
  else if (risk >= 55 && intent >= 40) buyerStage = 'cart_at_risk';
  else if (intent >= 65) buyerStage = 'high_intent';
  else if (intent >= 35) buyerStage = 'researching';
  else buyerStage = 'browsing';

  const priority = buyerPriorityScore({
    purchase_intent: scores.purchaseIntent,
    abandon_risk: scores.abandonRisk,
    engagement_score: scores.engagement,
    total_spent_cents: row?.total_spent_cents || 0,
  });

  const topCats = (Array.isArray(cats) ? cats : []).slice(0, 3);
  const topBrands = (Array.isArray(brands) ? brands : []).slice(0, 3);

  const insights = [
    ...(profile?.insights || []),
    tf.available
      ? `Model class: ${tf.label} (${Math.round((tf.confidence || 0) * 100)}% conf)`
      : 'Model not trained — rule-based scores only.',
  ];

  const recommendations = [...(profile?.recommendations || [])];
  if (buyerStage === 'cart_at_risk') {
    recommendations.unshift('High cart risk — offer free shipping or soft recovery.');
  }
  if (buyerStage === 'high_intent') {
    recommendations.unshift('Prioritize checkout path; reduce friction.');
  }
  if (topCats[0]) {
    recommendations.push(`Lead with ${topCats[0].name} merchandising.`);
  }

  // Personalization product ids from top category
  let forYou = [];
  if (topCats[0]) {
    const slug =
      topCats[0].name &&
      db
        .prepare('SELECT slug FROM categories WHERE name = ? OR slug = ?')
        .get(topCats[0].name, String(topCats[0].name).toLowerCase().replace(/\s+/g, '-'));
    const catSlug = slug?.slug;
    if (catSlug) {
      forYou = db
        .prepare(
          `SELECT p.*, c.name AS category_name, c.slug AS category_slug
           FROM products p JOIN categories c ON c.id = p.category_id
           WHERE c.slug = ? AND p.stock > 0
           ORDER BY p.rating_count DESC LIMIT 8`
        )
        .all(catSlug)
        .map(mapProduct);
    }
  }
  if (!forYou.length) {
    forYou = db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.is_bestseller = 1 AND p.stock > 0
         ORDER BY p.rating_count DESC LIMIT 8`
      )
      .all()
      .map(mapProduct);
  }

  // Deal rail if price sensitive
  let dealsForYou = [];
  if ((scores.priceSensitivity || 0) >= 45) {
    dealsForYou = db
      .prepare(
        `SELECT p.*, c.name AS category_name, c.slug AS category_slug
         FROM products p JOIN categories c ON c.id = p.category_id
         WHERE p.list_price_cents > p.price_cents AND p.stock > 0
         ORDER BY (1.0 * (p.list_price_cents - p.price_cents) / p.list_price_cents) DESC
         LIMIT 8`
      )
      .all()
      .map(mapProduct);
  }

  return {
    ok: true,
    profileKey: key,
    userId: userId || row?.user_id || null,
    displayName: row?.display_name || profile?.displayName,
    persona: row?.persona || profile?.persona,
    personaLabel:
      PERSONAS[row?.persona || profile?.persona]?.label ||
      row?.persona ||
      profile?.persona,
    features: {
      intent_score: scores.purchaseIntent || 0,
      abandon_prob: scores.abandonRisk || 0,
      loyalty_score: scores.loyalty || 0,
      engagement_score: scores.engagement || 0,
      price_sensitivity: scores.priceSensitivity || 0,
      preferred_category_top3: topCats,
      preferred_brand_top3: topBrands,
      tf_label: tf.available ? tf.label : live?.transformer?.label || null,
      tf_confidence: tf.available
        ? tf.confidence
        : live?.transformer?.confidence || 0,
      tf_probs: tf.available ? tf.probs : live?.transformer?.probs || [],
      buyer_stage: buyerStage,
      priority_score: priority,
      event_count: row?.event_count || 0,
      purchase_count: purchases,
      total_spent: money(row?.total_spent_cents || 0),
      journey_path: journey,
      model_ready: !!tf.available,
    },
    personalization: {
      headline:
        buyerStage === 'high_intent'
          ? 'Pick up where you left off'
          : buyerStage === 'cart_at_risk'
            ? 'Your cart is waiting — exclusive picks'
            : topCats[0]
              ? `More in ${topCats[0].name}`
              : 'Recommended for you',
      forYou,
      dealsForYou,
      showDealRail: dealsForYou.length > 0,
      urgency:
        buyerStage === 'high_intent' || buyerStage === 'cart_at_risk'
          ? 'soft'
          : 'none',
    },
    insights,
    recommendations: [...new Set(recommendations)].slice(0, 8),
    analyzedAt: new Date().toISOString(),
  };
}

/** Merchant queues */
function getGrowthQueues() {
  const profiles = db
    .prepare(
      `SELECT * FROM consumer_profiles
       WHERE event_count >= 2
       ORDER BY purchase_intent DESC`
    )
    .all();

  const aboutToBuy = profiles
    .map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      personaLabel: PERSONAS[r.persona]?.label || r.persona,
      intent: r.purchase_intent,
      abandonRisk: r.abandon_risk,
      engagement: r.engagement_score,
      priority: buyerPriorityScore(r),
      spent: money(r.total_spent_cents),
      purchases: r.purchase_count,
      lastActive: r.last_active,
    }))
    .filter((p) => p.intent >= 40 && p.purchases < 3)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 25);

  const cartAtRisk = profiles
    .map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      personaLabel: PERSONAS[r.persona]?.label || r.persona,
      intent: r.purchase_intent,
      abandonRisk: r.abandon_risk,
      priority: buyerPriorityScore(r),
      lastActive: r.last_active,
      recoveryAction:
        r.abandon_risk >= 70
          ? 'Send recovery offer (shipping/discount)'
          : 'Soft reminder + social proof',
    }))
    .filter((p) => p.abandonRisk >= 45 && p.intent >= 25)
    .sort((a, b) => b.abandonRisk - a.abandonRisk || b.intent - a.intent)
    .slice(0, 25);

  // Lookalikes of loyal buyers: high loyalty or multiple purchases
  const seeds = profiles.filter(
    (r) => r.purchase_count >= 2 || r.loyalty_score >= 50 || r.persona === 'loyal_buyer'
  );
  const seedCats = new Set();
  for (const s of seeds) {
    for (const c of parseJson(s.category_affinity, []).slice(0, 2)) {
      if (c.name) seedCats.add(c.name);
    }
  }
  const lookalikes = profiles
    .filter((r) => r.purchase_count === 0 && r.purchase_intent >= 30)
    .map((r) => {
      const cats = parseJson(r.category_affinity, []);
      const overlap = cats.filter((c) => seedCats.has(c.name)).length;
      return {
        profileKey: r.profile_key,
        displayName: r.display_name,
        persona: r.persona,
        intent: r.purchase_intent,
        categoryOverlap: overlap,
        reason:
          overlap > 0
            ? `Shares ${overlap} category(ies) with loyal buyers`
            : 'Elevated intent without purchase yet',
        score: r.purchase_intent + overlap * 10,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const dealSensitive = profiles
    .filter((r) => r.price_sensitivity >= 55)
    .map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      priceSensitivity: r.price_sensitivity,
      persona: r.persona,
      action: 'Route markdowns / bundles; avoid full-price push',
    }))
    .sort((a, b) => b.priceSensitivity - a.priceSensitivity)
    .slice(0, 20);

  return {
    aboutToBuy,
    cartAtRisk,
    lookalikes,
    dealSensitive,
    generatedAt: new Date().toISOString(),
  };
}

/** Catalog demand + dead stock + co-view affinities */
function getCatalogFeatures() {
  const events = db
    .prepare(
      `SELECT type, product_id, payload FROM behavior_events
       WHERE product_id IS NOT NULL OR type IN ('view_product','add_to_cart','purchase')`
    )
    .all();

  const views = {};
  const carts = {};
  const buys = {};
  const sessions = {}; // session co-views approx via consecutive user+product

  // Better co-view: group by user_id sequences
  const byUser = {};
  const rows = db
    .prepare(
      `SELECT user_id, session_id, type, product_id, created_at
       FROM behavior_events
       WHERE product_id IS NOT NULL
       ORDER BY user_id, created_at`
    )
    .all();

  for (const e of rows) {
    const pid = e.product_id;
    if (e.type === 'view_product') views[pid] = (views[pid] || 0) + 1;
    if (e.type === 'add_to_cart') carts[pid] = (carts[pid] || 0) + 1;
    if (e.type === 'purchase') buys[pid] = (buys[pid] || 0) + 1;
    const uk = e.user_id || e.session_id;
    if (!byUser[uk]) byUser[uk] = new Set();
    if (e.type === 'view_product') byUser[uk].add(pid);
  }

  const pairCounts = {};
  for (const set of Object.values(byUser)) {
    const arr = [...set];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i] < arr[j] ? arr[i] : arr[j];
        const b = arr[i] < arr[j] ? arr[j] : arr[i];
        const k = `${a}||${b}`;
        pairCounts[k] = (pairCounts[k] || 0) + 1;
      }
    }
  }

  const products = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id`
    )
    .all();

  const heat = products
    .map((p) => {
      const v = views[p.id] || 0;
      const c = carts[p.id] || 0;
      const b = buys[p.id] || 0;
      const demand = v * 1 + c * 4 + b * 10;
      const convert = pct(b, v);
      const cartRate = pct(c, v);
      return {
        productId: p.id,
        title: p.title,
        brand: p.brand,
        category: p.category_name,
        price: money(p.price_cents),
        stock: p.stock,
        views: v,
        carts: c,
        purchases: b,
        demandScore: demand,
        viewToCart: cartRate,
        viewToBuy: convert,
        signal:
          v >= 5 && c === 0 && b === 0
            ? 'dead_interest'
            : b > 0
              ? 'converting'
              : c > 0
                ? 'consideration'
                : v > 0
                  ? 'awareness'
                  : 'cold',
      };
    })
    .sort((a, b) => b.demandScore - a.demandScore);

  const deadStock = heat
    .filter((h) => h.views >= 3 && h.purchases === 0 && h.carts <= 1)
    .slice(0, 15);

  const topDemand = heat.filter((h) => h.demandScore > 0).slice(0, 15);

  const affinities = Object.entries(pairCounts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, n]) => {
      const [a, b] = k.split('||');
      const pa = products.find((p) => p.id === a);
      const pb = products.find((p) => p.id === b);
      return {
        productA: { id: a, title: pa?.title || a },
        productB: { id: b, title: pb?.title || b },
        coViews: n,
        suggestion: `Often viewed together — bundle or “with this” rail`,
      };
    });

  return {
    topDemand,
    deadStock,
    affinities,
    catalogSize: products.length,
    generatedAt: new Date().toISOString(),
  };
}

/** Bot lab: DNA purity / calibration */
function getBotLabFeatures() {
  const fleet = analyzeAllBotsBuying({ limit: 80 });
  const purity = (fleet.bots || []).map((b) => {
    const designed = b.persona;
    const model = b.transformer?.label;
    const match =
      model && designed
        ? model === designed ||
          (designed === 'cart_abandons' && model === 'cart_builder')
        : null;
    return {
      botId: b.botId,
      displayName: b.displayName,
      designedPersona: designed,
      designedLabel: b.personaLabel,
      modelLabel: model || null,
      modelConfidence: b.transformer?.confidence || 0,
      pure: match === true,
      drift: match === false,
      buyerStage: b.buyerStage,
      viewToBuy: b.funnel?.viewToPurchase,
      dnaVsObserved: b.dnaAlignment,
      topInsight: b.topInsight,
    };
  });

  const pureCount = purity.filter((p) => p.pure).length;
  const driftCount = purity.filter((p) => p.drift).length;

  return {
    fleetSummary: fleet.fleet,
    purity,
    purityRate: purity.length ? pct(pureCount, purity.length) : 0,
    driftCount,
    pureCount,
    generatedAt: new Date().toISOString(),
  };
}

/** Model ops: confidence + simple persona drift */
function getModelOpsFeatures() {
  const cache = getInferenceCache();
  const confs = cache
    .map((c) => c.transformer?.confidence)
    .filter((c) => typeof c === 'number');
  const avgConf = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : 0;

  const lowConfidence = cache
    .filter((c) => (c.transformer?.confidence || 0) > 0 && c.transformer.confidence < 0.45)
    .slice(0, 15);

  const personaMix = db
    .prepare(
      `SELECT persona, COUNT(*) AS c FROM consumer_profiles GROUP BY persona ORDER BY c DESC`
    )
    .all();

  const gated = cache.filter((c) => (c.transformer?.confidence || 0) >= 0.6);

  return {
    liveClassifications: cache.length,
    avgConfidence: Math.round(avgConf * 1000) / 1000,
    highConfidenceCount: gated.length,
    confidenceGate: 0.6,
    lowConfidence,
    personaMix,
    note: 'Act on labels only when confidence ≥ 0.6 (gate)',
    generatedAt: new Date().toISOString(),
  };
}

/** One payload for admin Insights page */
function getAllMinedFeatures() {
  return {
    growth: getGrowthQueues(),
    catalog: getCatalogFeatures(),
    botLab: getBotLabFeatures(),
    modelOps: getModelOpsFeatures(),
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  getConsumerFeatures,
  getGrowthQueues,
  getCatalogFeatures,
  getBotLabFeatures,
  getModelOpsFeatures,
  getAllMinedFeatures,
};
