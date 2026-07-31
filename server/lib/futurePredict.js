/**
 * Future predictions from learned buyer behavior.
 * Uses historical conversion rates by stage/persona + current journey position
 * + Tiny AI persona when available. Not fortune-telling — data-driven forecasts.
 */
const { db } = require('../db');
const { PERSONAS } = require('./behaviorEngine');
const { classifyBuyerStage, STAGE_META } = require('./buyerBehavior');

function money(cents) {
  return {
    cents: cents || 0,
    formatted: `$${((cents || 0) / 100).toFixed(2)}`,
  };
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((1000 * n) / d) / 10;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function getTfCache() {
  try {
    return require('./realtimeAi').getInferenceCache() || [];
  } catch {
    return [];
  }
}

/** Base chance of purchase in the "near future" by current stage (learned priors) */
const STAGE_BUY_PRIOR = {
  loyal_customer: 0.72,
  converted_once: 0.48,
  checkout_abandoner: 0.38,
  cart_considering: 0.28,
  researching: 0.12,
  searching: 0.08,
  inactive: 0.03,
};

const STAGE_ABANDON_PRIOR = {
  loyal_customer: 0.12,
  converted_once: 0.22,
  checkout_abandoner: 0.62,
  cart_considering: 0.55,
  researching: 0.25,
  searching: 0.2,
  inactive: 0.1,
};

const NEXT_ACTION_BY_STAGE = {
  loyal_customer: [
    { action: 'return_and_buy', label: 'Come back and buy again', weight: 0.45 },
    { action: 'browse_category', label: 'Browse a favorite category', weight: 0.3 },
    { action: 'idle', label: 'Stay quiet a while', weight: 0.25 },
  ],
  converted_once: [
    { action: 'second_purchase', label: 'Make a second purchase', weight: 0.35 },
    { action: 'browse', label: 'Browse more products', weight: 0.4 },
    { action: 'churn_risk', label: 'Go quiet (no second order)', weight: 0.25 },
  ],
  checkout_abandoner: [
    { action: 'return_checkout', label: 'Return and finish checkout', weight: 0.32 },
    { action: 'abandon_for_good', label: 'Drop the cart permanently', weight: 0.4 },
    { action: 'edit_cart', label: 'Change cart then leave', weight: 0.28 },
  ],
  cart_considering: [
    { action: 'start_checkout', label: 'Start checkout', weight: 0.28 },
    { action: 'keep_browsing', label: 'Keep browsing with cart open', weight: 0.35 },
    { action: 'empty_cart', label: 'Leave without buying', weight: 0.37 },
  ],
  researching: [
    { action: 'add_to_cart', label: 'Add something to cart', weight: 0.3 },
    { action: 'more_views', label: 'View more products', weight: 0.45 },
    { action: 'leave', label: 'Leave the site', weight: 0.25 },
  ],
  searching: [
    { action: 'open_product', label: 'Open a product page', weight: 0.5 },
    { action: 'new_search', label: 'Search again', weight: 0.3 },
    { action: 'leave', label: 'Leave', weight: 0.2 },
  ],
  inactive: [
    { action: 'first_visit', label: 'Start browsing', weight: 0.4 },
    { action: 'stay_inactive', label: 'Stay inactive', weight: 0.6 },
  ],
};

/**
 * Empirical rates from data: among people who were in stage-like funnel position,
 * what fraction eventually bought (orders > 0).
 */
function learnRatesFromHistory() {
  const rows = db
    .prepare(
      `SELECT
         u.id AS user_id,
         COALESCE(ev.views, 0) AS views,
         COALESCE(ev.searches, 0) AS searches,
         COALESCE(ev.carts, 0) AS carts,
         COALESCE(ev.checkouts, 0) AS checkouts,
         COALESCE(ord.orders, 0) AS orders
       FROM users u
       LEFT JOIN (
         SELECT user_id,
           SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
           SUM(CASE WHEN type = 'search' THEN 1 ELSE 0 END) AS searches,
           SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
           SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts
         FROM behavior_events WHERE user_id IS NOT NULL GROUP BY user_id
       ) ev ON ev.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS orders FROM orders GROUP BY user_id
       ) ord ON ord.user_id = u.id
       WHERE COALESCE(ev.views,0)+COALESCE(ev.carts,0)+COALESCE(ev.checkouts,0)+COALESCE(ord.orders,0) > 0`
    )
    .all();

  const byStage = {};
  for (const r of rows) {
    const stage = classifyBuyerStage({
      purchases: r.orders || 0,
      checkouts: r.checkouts || 0,
      carts: r.carts || 0,
      views: r.views || 0,
      searches: r.searches || 0,
    });
    if (!byStage[stage]) byStage[stage] = { n: 0, buyers: 0 };
    byStage[stage].n += 1;
    if ((r.orders || 0) > 0) byStage[stage].buyers += 1;
  }

  const buyRate = {};
  for (const [stage, s] of Object.entries(byStage)) {
    // Blend empirical with prior when sample small
    const emp = s.n ? s.buyers / s.n : STAGE_BUY_PRIOR[stage] || 0.1;
    const prior = STAGE_BUY_PRIOR[stage] || 0.1;
    const w = Math.min(1, s.n / 20);
    buyRate[stage] = emp * w + prior * (1 - w);
  }

  // Global funnel rates for forecasts
  const funnel = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
         SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts,
         SUM(CASE WHEN type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM behavior_events`
    )
    .get();

  const aov = db.prepare(`SELECT AVG(total_cents) AS aov FROM orders`).get()?.aov || 5000;

  return {
    buyRateByStage: buyRate,
    stageCounts: byStage,
    funnel: {
      views: funnel.views || 0,
      carts: funnel.carts || 0,
      checkouts: funnel.checkouts || 0,
      purchases: funnel.purchases || 0,
      viewToCart: pct(funnel.carts, funnel.views),
      cartToCheckout: pct(funnel.checkouts, funnel.carts),
      checkoutToBuy: pct(funnel.purchases, funnel.checkouts),
      viewToBuy: pct(funnel.purchases, funnel.views),
    },
    aovCents: Math.round(aov),
  };
}

function predictNextAction(stage, buyP, abandonP) {
  const opts = (NEXT_ACTION_BY_STAGE[stage] || NEXT_ACTION_BY_STAGE.inactive).map((o) => ({
    ...o,
  }));
  // Tilt weights using buy/abandon probabilities
  if (stage === 'checkout_abandoner' || stage === 'cart_considering') {
    opts[0].weight *= 0.5 + buyP;
    opts[1].weight *= 0.5 + abandonP;
  }
  const total = opts.reduce((s, o) => s + o.weight, 0) || 1;
  const ranked = opts
    .map((o) => ({
      action: o.action,
      label: o.label,
      probability: Math.round((1000 * o.weight) / total) / 10,
    }))
    .sort((a, b) => b.probability - a.probability);
  return { mostLikely: ranked[0], alternatives: ranked.slice(1) };
}

function predictOne(user, learned, tf) {
  const purchases = Math.max(user.orders || 0, user.purchase_events || 0);
  const stage = classifyBuyerStage({
    purchases,
    checkouts: user.checkouts || 0,
    carts: user.carts || 0,
    views: user.views || 0,
    searches: user.searches || 0,
  });

  let buyP = learned.buyRateByStage[stage] ?? STAGE_BUY_PRIOR[stage] ?? 0.1;
  let abandonP = STAGE_ABANDON_PRIOR[stage] ?? 0.3;

  // Adjust with scores (0-100)
  const intent = (user.purchase_intent ?? 40) / 100;
  const risk = (user.abandon_risk ?? 30) / 100;
  buyP = clamp01(buyP * 0.55 + intent * 0.35 + (1 - risk) * 0.1);
  abandonP = clamp01(abandonP * 0.5 + risk * 0.4 + (1 - intent) * 0.1);

  // Already loyal buyers: high repurchase, low abandon
  if (stage === 'loyal_customer') {
    buyP = clamp01(Math.max(buyP, 0.55));
    abandonP = clamp01(Math.min(abandonP, 0.25));
  }
  // In checkout with no order: high stakes
  if (stage === 'checkout_abandoner') {
    buyP = clamp01(buyP);
    abandonP = clamp01(Math.max(abandonP, 0.45));
  }

  // Tiny AI persona nudge
  const tfLabel = tf?.transformer?.label;
  if (tfLabel === 'loyal_buyer' || tfLabel === 'high_intent') {
    buyP = clamp01(buyP + 0.08);
    abandonP = clamp01(abandonP - 0.06);
  }
  if (tfLabel === 'cart_abandons') {
    abandonP = clamp01(abandonP + 0.1);
    buyP = clamp01(buyP - 0.06);
  }
  if (tfLabel === 'window_shopper') {
    buyP = clamp01(buyP - 0.05);
  }

  const next = predictNextAction(stage, buyP, abandonP);

  // Expected value if they convert once at AOV * buyP
  const expectedRevenueCents = Math.round(buyP * learned.aovCents);

  // Horizon narrative
  let outlook;
  if (buyP >= 0.55) outlook = 'Likely to buy soon';
  else if (buyP >= 0.35) outlook = 'Maybe — needs a push';
  else if (abandonP >= 0.5) outlook = 'Likely to walk away';
  else outlook = 'Watching / early stage';

  let advice;
  if (stage === 'checkout_abandoner' && buyP >= 0.3) {
    advice = 'Send a checkout recovery offer — they were one step from paying.';
  } else if (stage === 'cart_considering') {
    advice = 'Remind them of cart items; remove friction to checkout.';
  } else if (stage === 'converted_once') {
    advice = 'Win a second order (loyalty / reorder of related products).';
  } else if (stage === 'loyal_customer') {
    advice = 'Keep them happy — exclusive drops or early access.';
  } else if (stage === 'researching') {
    advice = 'Stronger product pages and clear CTAs to cart.';
  } else {
    advice = 'Keep them engaged with discovery; don’t hard-sell yet.';
  }

  const confidence = clamp01(
    0.35 +
      Math.min(0.35, (user.event_count || user.views || 0) / 80) +
      (tfLabel ? 0.1 : 0) +
      (learned.stageCounts[stage]?.n >= 10 ? 0.15 : 0.05)
  );

  return {
    userId: user.user_id,
    name: user.bot_name || user.display_name || user.name || user.email,
    isBot: !!user.is_bot,
    botId: user.bot_id || null,
    profileKey: user.profile_key || `user:${user.user_id}`,
    currentStage: stage,
    currentStageLabel: STAGE_META[stage]?.label || stage,
    persona: user.persona,
    personaLabel: (PERSONAS[user.persona] || {}).label || user.persona,
    transformer: tfLabel
      ? { label: tfLabel, confidence: tf?.transformer?.confidence }
      : null,
    // Future
    willBuySoon: {
      probability: Math.round(buyP * 1000) / 10,
      label: buyP >= 0.5 ? 'Yes, likely' : buyP >= 0.3 ? 'Maybe' : 'Unlikely',
    },
    willAbandon: {
      probability: Math.round(abandonP * 1000) / 10,
      label: abandonP >= 0.5 ? 'High risk' : abandonP >= 0.3 ? 'Medium risk' : 'Low risk',
    },
    nextAction: next.mostLikely,
    nextActionAlternatives: next.alternatives,
    expectedRevenue: money(expectedRevenueCents),
    outlook,
    advice,
    confidence: Math.round(confidence * 100),
    signals: {
      views: user.views || 0,
      carts: user.carts || 0,
      checkouts: user.checkouts || 0,
      orders: user.orders || 0,
      purchaseIntent: user.purchase_intent,
      abandonRisk: user.abandon_risk,
    },
  };
}

function getFuturePredictions({ limit = 60 } = {}) {
  const learned = learnRatesFromHistory();
  const tfCache = getTfCache();
  const tfByKey = new Map(tfCache.map((t) => [t.profileKey, t]));

  const users = db
    .prepare(
      `SELECT
         u.id AS user_id,
         u.name,
         u.email,
         u.is_bot,
         COALESCE(ev.views, 0) AS views,
         COALESCE(ev.searches, 0) AS searches,
         COALESCE(ev.carts, 0) AS carts,
         COALESCE(ev.checkouts, 0) AS checkouts,
         COALESCE(ev.purchases, 0) AS purchase_events,
         COALESCE(ord.orders, 0) AS orders,
         COALESCE(ord.revenue, 0) AS revenue,
         cp.persona,
         cp.purchase_intent,
         cp.abandon_risk,
         cp.profile_key,
         cp.display_name,
         cp.event_count,
         b.id AS bot_id,
         b.display_name AS bot_name
       FROM users u
       LEFT JOIN (
         SELECT user_id,
           SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
           SUM(CASE WHEN type = 'search' THEN 1 ELSE 0 END) AS searches,
           SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
           SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts,
           SUM(CASE WHEN type = 'purchase' THEN 1 ELSE 0 END) AS purchases
         FROM behavior_events WHERE user_id IS NOT NULL GROUP BY user_id
       ) ev ON ev.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS orders, SUM(total_cents) AS revenue
         FROM orders GROUP BY user_id
       ) ord ON ord.user_id = u.id
       LEFT JOIN consumer_profiles cp ON cp.profile_key = 'user:' || u.id
       LEFT JOIN bots b ON b.user_id = u.id
       WHERE COALESCE(ev.views,0)+COALESCE(ev.searches,0)+COALESCE(ev.carts,0)
             +COALESCE(ev.checkouts,0)+COALESCE(ord.orders,0)+COALESCE(cp.event_count,0) > 0
       ORDER BY COALESCE(cp.updated_at, u.created_at) DESC
       LIMIT 200`
    )
    .all();

  const predictions = users.map((u) => {
    const tf = tfByKey.get(u.profile_key || `user:${u.user_id}`);
    return predictOne(u, learned, tf);
  });

  const likelyBuyers = predictions
    .filter((p) => p.signals.orders === 0 && p.willBuySoon.probability >= 30)
    .sort((a, b) => b.willBuySoon.probability - a.willBuySoon.probability)
    .slice(0, limit);

  const abandonRisks = predictions
    .filter(
      (p) =>
        p.signals.orders === 0 &&
        (p.signals.carts > 0 || p.signals.checkouts > 0) &&
        p.willAbandon.probability >= 35
    )
    .sort((a, b) => b.willAbandon.probability - a.willAbandon.probability)
    .slice(0, limit);

  // Market-level forecast: if we touch all almost-buyers with recovery, expected conversions
  const almost = predictions.filter(
    (p) => p.signals.orders === 0 && (p.signals.carts > 0 || p.signals.checkouts > 0)
  );
  const expectedRecoveries = almost.reduce((s, p) => s + p.willBuySoon.probability / 100, 0);
  const expectedRecoveryRevenue = Math.round(expectedRecoveries * learned.aovCents);

  // If 100 more product views at current rates
  const f = learned.funnel;
  const extraViews = 100;
  const forecastExtraCarts = Math.round((extraViews * f.viewToCart) / 100);
  const forecastExtraCheckouts = Math.round((forecastExtraCarts * f.cartToCheckout) / 100);
  const forecastExtraBuys = Math.round((forecastExtraCheckouts * f.checkoutToBuy) / 100);
  const forecastExtraRevenue = forecastExtraBuys * learned.aovCents;

  const stories = buildStories({
    predictions,
    likelyBuyers,
    abandonRisks,
    almost,
    expectedRecoveries,
    expectedRecoveryRevenue,
    learned,
    forecastExtraBuys,
    forecastExtraRevenue,
  });

  return {
    generatedAt: new Date().toISOString(),
    howItWorks:
      'Predictions combine (1) what similar shoppers did before, (2) where this person is in the funnel now, (3) intent/abandon scores, and (4) Tiny AI persona when available. They are forecasts, not guarantees.',
    learned: {
      funnel: learned.funnel,
      aov: money(learned.aovCents),
      buyRateByStage: Object.fromEntries(
        Object.entries(learned.buyRateByStage).map(([k, v]) => [
          k,
          {
            stage: k,
            label: STAGE_META[k]?.label || k,
            buyChancePct: Math.round(v * 1000) / 10,
            sampleSize: learned.stageCounts[k]?.n || 0,
          },
        ])
      ),
    },
    stories,
    marketForecast: {
      almostBuyers: almost.length,
      expectedRecoveries: Math.round(expectedRecoveries * 10) / 10,
      expectedRecoveryRevenue: money(expectedRecoveryRevenue),
      plain: `If you re-engage the ${almost.length} almost-buyers, the model expects about ${Math.round(expectedRecoveries)} extra purchases (~${money(expectedRecoveryRevenue).formatted}) based on their buy chances.`,
      next100Views: {
        extraViews,
        expectedCarts: forecastExtraCarts,
        expectedCheckouts: forecastExtraCheckouts,
        expectedPurchases: forecastExtraBuys,
        expectedRevenue: money(forecastExtraRevenue),
        plain: `At today’s rates, 100 more product views → ~${forecastExtraCarts} carts → ~${forecastExtraCheckouts} checkouts → ~${forecastExtraBuys} buys (~${money(forecastExtraRevenue).formatted}).`,
      },
    },
    likelyToBuySoon: likelyBuyers.slice(0, 20),
    likelyToAbandon: abandonRisks.slice(0, 20),
    all: predictions
      .sort((a, b) => b.willBuySoon.probability - a.willBuySoon.probability)
      .slice(0, limit),
  };
}

function buildStories({
  predictions,
  likelyBuyers,
  abandonRisks,
  almost,
  expectedRecoveries,
  expectedRecoveryRevenue,
  learned,
  forecastExtraBuys,
  forecastExtraRevenue,
}) {
  const n = predictions.length || 1;
  const avgBuy =
    predictions.reduce((s, p) => s + p.willBuySoon.probability, 0) / n;

  return [
    {
      title: 'What the future looks like for this store',
      text: `Across ${predictions.length} shoppers, average chance of buying soon is ~${Math.round(avgBuy)}%. The model learned that from real funnels (view→cart ${learned.funnel.viewToCart}%, cart→checkout ${learned.funnel.cartToCheckout}%, checkout→buy ${learned.funnel.checkoutToBuy}%).`,
    },
    {
      title: 'Money you can still unlock',
      text: `${almost.length} people almost bought. Expected ~${Math.round(expectedRecoveries)} recoveries if you follow up (~${money(expectedRecoveryRevenue).formatted} at your average order size).`,
    },
    {
      title: 'Who to call first',
      text:
        likelyBuyers[0]
          ? `Highest near-term buyer: ${likelyBuyers[0].name} (${likelyBuyers[0].willBuySoon.probability}% buy chance) — ${likelyBuyers[0].advice}`
          : 'Need more cart/checkout activity to rank likely buyers.',
    },
    {
      title: 'Who is about to leave',
      text:
        abandonRisks[0]
          ? `Highest abandon risk: ${abandonRisks[0].name} (${abandonRisks[0].willAbandon.probability}% risk) — ${abandonRisks[0].nextAction.label}.`
          : 'No high-risk abandoners flagged right now.',
    },
    {
      title: 'If traffic keeps flowing',
      text: `Next 100 product views (at current rates) → about ${forecastExtraBuys} purchases (~${money(forecastExtraRevenue).formatted}).`,
    },
  ];
}

module.exports = {
  getFuturePredictions,
  predictOne,
  learnRatesFromHistory,
};
