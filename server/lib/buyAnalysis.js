/**
 * High-resolution buying behavior analysis for a single bot/user.
 * Combines event funnel stats, order economics, DNA alignment, and optional Tiny TF inference.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { getProfile, PERSONAS, eventToken } = require('./behaviorEngine');
const { MODEL_PATH } = require('./mlTrain');

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

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const predictTextCache = new Map(); // text hash -> result
let inferQueue = Promise.resolve();
let inferBusy = false;

/** Drop cached predictions after a retrain so live AI uses new weights */
function clearPredictCache() {
  predictTextCache.clear();
}

function parseInferOutput(stdout, stderr, status, error) {
  if (error || status !== 0) {
    return {
      available: false,
      reason: (stderr || error?.message || 'infer failed').toString().slice(0, 200),
    };
  }
  try {
    const out = JSON.parse((stdout || '').trim().split('\n').pop());
    if (!out.ok && out.error) {
      return { available: false, reason: out.error };
    }
    return {
      available: true,
      label: out.label,
      confidence: out.confidence,
      probs: out.probs || [],
      model: out.model || 'TinyVisitorTransformer',
    };
  } catch {
    return { available: false, reason: 'Could not parse model output' };
  }
}

/**
 * Async transformer predict — does NOT block the Node event loop.
 * Prefer this on request paths.
 */
function runTransformerPredictAsync(text) {
  return new Promise((resolve) => {
    if (!fs.existsSync(MODEL_PATH) || !text || text.length < 3) {
      resolve({ available: false, reason: 'Model not trained yet or empty journey' });
      return;
    }
    const key = text.slice(0, 500);
    if (predictTextCache.has(key)) {
      resolve(predictTextCache.get(key));
      return;
    }
    const py = process.env.PYTHON || 'python3';
    const script = path.join(__dirname, '..', '..', 'ml_transformer', 'infer.py');
    const child = spawn(py, [script, '--model', MODEL_PATH, '--text', text], {
      timeout: 12000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      resolve(parseInferOutput('', String(err.message), 1, err));
    });
    child.on('close', (code) => {
      const result = parseInferOutput(stdout, stderr, code, null);
      if (result.available) {
        predictTextCache.set(key, result);
        if (predictTextCache.size > 200) {
          const first = predictTextCache.keys().next().value;
          predictTextCache.delete(first);
        }
      }
      resolve(result);
    });
  });
}

/**
 * Sync predict — ONLY for offline/admin analysis tools. Avoid on login/cart paths.
 */
function runTransformerPredict(text) {
  if (!fs.existsSync(MODEL_PATH) || !text || text.length < 3) {
    return { available: false, reason: 'Model not trained yet or empty journey' };
  }
  const key = text.slice(0, 500);
  if (predictTextCache.has(key)) return predictTextCache.get(key);

  const py = process.env.PYTHON || 'python3';
  const script = path.join(__dirname, '..', '..', 'ml_transformer', 'infer.py');
  const r = spawnSync(py, [script, '--model', MODEL_PATH, '--text', text], {
    encoding: 'utf8',
    timeout: 8000,
  });
  const result = parseInferOutput(r.stdout, r.stderr, r.status, r.error);
  if (result.available) predictTextCache.set(key, result);
  return result;
}

/** Serialize async infers so we don't spawn 50 python processes at once */
function enqueueTransformerPredict(text) {
  const job = inferQueue.then(() => runTransformerPredictAsync(text));
  inferQueue = job.catch(() => {});
  return job;
}

function productMeta(id) {
  return db
    .prepare(
      `SELECT p.id, p.title, p.brand, p.price_cents, p.list_price_cents, c.name AS category, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`
    )
    .get(id);
}

/**
 * Deep analysis for one bot (by bot id).
 * @param {string} botId
 * @param {{ allowSyncTf?: boolean }} [opts]
 *   allowSyncTf=false never spawnSync Python (fleet/list paths — keeps API responsive).
 */
function analyzeBotBuying(botId, opts = {}) {
  const allowSyncTf = opts.allowSyncTf !== false;
  const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(botId);
  if (!bot) return null;

  let dna = {};
  try {
    dna = JSON.parse(bot.dna_json || '{}');
  } catch {
    dna = {};
  }

  const userId = bot.user_id;
  const events = db
    .prepare(
      `SELECT * FROM behavior_events WHERE user_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all(userId);

  const orders = db
    .prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY placed_at ASC`)
    .all(userId);

  const orderItems = db
    .prepare(
      `SELECT oi.*, o.placed_at FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = ?
       ORDER BY o.placed_at ASC`
    )
    .all(userId);

  // --- counts ---
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;

  const pageViews = counts.page_view || 0;
  const searches = counts.search || 0;
  const productViews = counts.view_product || 0;
  const addToCarts = counts.add_to_cart || 0;
  const checkouts = counts.begin_checkout || 0;
  const purchases = counts.purchase || orders.length;

  // --- funnel conversion ---
  const funnel = {
    views: productViews,
    addToCart: addToCarts,
    beginCheckout: checkouts,
    purchase: purchases,
    viewToCart: pct(addToCarts, productViews),
    cartToCheckout: pct(checkouts, addToCarts),
    checkoutToPurchase: pct(purchases, checkouts),
    viewToPurchase: pct(purchases, productViews),
    overallConversion: pct(purchases, Math.max(bot.sessions_run, 1)),
  };

  // --- money ---
  const totalSpent = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
  const aov = orders.length ? Math.round(totalSpent / orders.length) : 0;
  const itemsBought = orderItems.reduce((s, i) => s + i.qty, 0);

  // --- catalog taste from views + purchases ---
  const viewCats = {};
  const viewBrands = {};
  const viewProducts = {};
  const purchaseCats = {};
  const purchaseBrands = {};
  let dealViews = 0;
  let viewPriceSum = 0;
  let viewPriceN = 0;
  let purchasePriceSum = 0;

  for (const e of events) {
    const payload = parsePayload(e.payload);
    const pid = e.product_id || payload.productId;
    if (!pid) continue;
    const meta = productMeta(pid);
    if (!meta) continue;
    if (e.type === 'view_product') {
      viewCats[meta.category] = (viewCats[meta.category] || 0) + 1;
      viewBrands[meta.brand] = (viewBrands[meta.brand] || 0) + 1;
      viewProducts[pid] = (viewProducts[pid] || 0) + 1;
      viewPriceSum += meta.price_cents;
      viewPriceN += 1;
      if (meta.list_price_cents && meta.list_price_cents > meta.price_cents) dealViews += 1;
    }
  }

  for (const oi of orderItems) {
    const meta = productMeta(oi.product_id);
    const cat = meta?.category || 'Unknown';
    const brand = oi.brand || meta?.brand || 'Unknown';
    purchaseCats[cat] = (purchaseCats[cat] || 0) + oi.qty;
    purchaseBrands[brand] = (purchaseBrands[brand] || 0) + oi.qty;
    purchasePriceSum += oi.unit_price_cents * oi.qty;
  }

  const sortMap = (obj) =>
    Object.entries(obj)
      .filter(([k]) => k)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

  const topViewed = sortMap(viewProducts).map((p) => {
    const m = productMeta(p.name);
    return {
      productId: p.name,
      title: m?.title || p.name,
      brand: m?.brand,
      views: p.count,
      price: money(m?.price_cents || 0),
    };
  });

  const boughtProducts = orderItems.map((oi) => ({
    productId: oi.product_id,
    title: oi.title,
    brand: oi.brand,
    qty: oi.qty,
    unitPrice: money(oi.unit_price_cents),
    lineTotal: money(oi.line_total_cents),
    placedAt: oi.placed_at,
  }));

  // --- session breakdown ---
  const bySession = {};
  for (const e of events) {
    const sid = e.session_id || 'unknown';
    if (!bySession[sid]) bySession[sid] = [];
    bySession[sid].push(e);
  }
  const sessions = Object.entries(bySession).map(([sid, list]) => {
    const types = {};
    for (const e of list) types[e.type] = (types[e.type] || 0) + 1;
    return {
      sessionId: sid,
      events: list.length,
      purchased: !!(types.purchase),
      addedCart: !!(types.add_to_cart),
      checkedOut: !!(types.begin_checkout),
      productViews: types.view_product || 0,
      searches: types.search || 0,
      path: list.map(eventToken).join(' '),
      startedAt: list[0]?.created_at,
      endedAt: list[list.length - 1]?.created_at,
    };
  });

  const sessionsWithCart = sessions.filter((s) => s.addedCart).length;
  const sessionsWithPurchase = sessions.filter((s) => s.purchased).length;
  const abandonSessions = sessions.filter((s) => s.addedCart && !s.purchased).length;

  // --- DNA vs observed alignment ---
  const observedPCart = productViews ? addToCarts / productViews : 0;
  const observedPCheckout = addToCarts ? checkouts / addToCarts : 0;
  const observedPBuy = checkouts ? purchases / Math.max(checkouts, 1) : 0;
  const dnaAlignment = {
    designed: {
      pAddToCart: dna.pAddToCart,
      pBeginCheckout: dna.pBeginCheckout,
      pPurchase: dna.pPurchase,
    },
    observed: {
      pAddToCart: Math.round(observedPCart * 1000) / 1000,
      pBeginCheckout: Math.round(observedPCheckout * 1000) / 1000,
      pPurchase: Math.round(observedPBuy * 1000) / 1000,
    },
    drift: {
      addToCart: Math.round((observedPCart - (dna.pAddToCart || 0)) * 1000) / 1000,
      checkout: Math.round((observedPCheckout - (dna.pBeginCheckout || 0)) * 1000) / 1000,
      purchase: Math.round((observedPBuy - (dna.pPurchase || 0)) * 1000) / 1000,
    },
  };

  // --- consumer profile + transformer ---
  const profileKey = `user:${userId}`;
  // Prefer lightweight stored profile over full rebuild on fleet paths
  let profile = null;
  try {
    profile = getProfile(profileKey);
  } catch {
    profile = null;
  }
  const journeyPath =
    profile?.journeyPath || events.map(eventToken).join(' ') || '';
  // Prefer cache from real-time pipeline; sync Python ONLY when allowed (single-bot detail)
  let transformer = { available: false, reason: 'No live classification yet' };
  try {
    const { getInferenceCache } = require('./realtimeAi');
    const cached = getInferenceCache().find(
      (c) => c.profileKey === profileKey || c.botId === botId
    );
    if (cached?.transformer?.label) {
      transformer = {
        available: true,
        label: cached.transformer.label,
        confidence: cached.transformer.confidence,
        probs: cached.transformer.probs || [],
        model: 'TinyVisitorTransformer',
      };
    } else if (allowSyncTf && journeyPath.length > 3) {
      // Single-bot detail only — never on fleet list (blocks Node event loop)
      transformer = runTransformerPredict(journeyPath);
    } else if (!allowSyncTf && journeyPath.length > 3) {
      transformer = {
        available: false,
        reason: 'Awaiting async classification (run bots or open bot detail)',
      };
    }
  } catch {
    /* ignore */
  }

  // --- narrative insights ---
  const insights = [];
  const recommendations = [];

  if (events.length === 0) {
    insights.push('No activity yet. Run sessions for this bot to generate buying signals.');
  } else {
    insights.push(
      `Across ${bot.sessions_run || sessions.length} session(s): ${productViews} product views, ${addToCarts} cart adds, ${purchases} purchase(s).`
    );
  }

  if (purchases === 0 && addToCarts > 0) {
    insights.push(
      `Classic abandon pattern: ${addToCarts} cart action(s) and ${checkouts} checkout start(s) with zero completed orders.`
    );
    recommendations.push('Raise DNA pPurchase slightly or run more sessions to sample conversion.');
  }

  if (funnel.viewToPurchase >= 40) {
    insights.push(
      `High view→buy conversion (${funnel.viewToPurchase}%) — decisive buyer, short research cycle.`
    );
  } else if (productViews >= 5 && purchases === 0) {
    insights.push(
      `Heavy browsing (${productViews} views) without purchase — researcher / window pattern.`
    );
  }

  if (orders.length >= 2) {
    insights.push(
      `Repeat purchaser: ${orders.length} orders, AOV ${money(aov).formatted}, lifetime ${money(totalSpent).formatted}.`
    );
    recommendations.push('Surface loyalty offers and reorder of top brands.');
  }

  if (dealViews && viewPriceN && dealViews / viewPriceN > 0.4) {
    insights.push(
      `Deal-oriented browsing: ${pct(dealViews, viewPriceN)}% of viewed items were discounted.`
    );
  }

  const topCat = sortMap(viewCats)[0] || sortMap(purchaseCats)[0];
  if (topCat) {
    insights.push(`Strongest category gravity: ${topCat.name} (${topCat.count} signals).`);
    recommendations.push(`Merchandize more ${topCat.name} on next session landing.`);
  }

  if (abandonSessions > 0) {
    insights.push(
      `${abandonSessions} session(s) left items in cart without buying — abandon rate ${pct(abandonSessions, sessionsWithCart)}% of cart sessions.`
    );
    recommendations.push('Trigger recovery style messaging after cart_builder / abandon sessions.');
  }

  if (Math.abs(dnaAlignment.drift.purchase) > 0.25 && bot.sessions_run >= 2) {
    insights.push(
      `Observed purchase rate drifts from designed DNA by ${(dnaAlignment.drift.purchase * 100).toFixed(0)} pts — stochastic sampling or small sample size.`
    );
  }

  if (transformer.available) {
    insights.push(
      `Tiny Transformer classifies journey as “${transformer.label}” (confidence ${(transformer.confidence * 100).toFixed(0)}%).`
    );
    if (transformer.label !== bot.persona && transformer.confidence > 0.35) {
      insights.push(
        `Model disagrees with designed persona “${bot.persona}” — behavior may have shifted through random runs or DNA edit.`
      );
    }
  } else {
    recommendations.push('Train Tiny AI on the Learning page so each bot gets model classification.');
  }

  // buyer stage
  let buyerStage = 'cold';
  if (purchases >= 2) buyerStage = 'loyal_customer';
  else if (purchases === 1) buyerStage = 'converted_once';
  else if (checkouts > 0) buyerStage = 'checkout_abandoner';
  else if (addToCarts > 0) buyerStage = 'cart_considering';
  else if (productViews > 0) buyerStage = 'researching';
  else if (searches > 0) buyerStage = 'searching';
  else buyerStage = 'inactive';

  const riskScore = Math.min(
    100,
    Math.round(
      (abandonSessions / Math.max(sessions.length, 1)) * 50 +
        (addToCarts > 0 && purchases === 0 ? 35 : 0) +
        (checkouts > purchases ? 15 : 0)
    )
  );

  const valueScore = Math.min(
    100,
    Math.round(
      purchases * 25 +
        Math.min(40, totalSpent / 500) +
        (orders.length >= 2 ? 20 : 0) +
        funnel.viewToPurchase * 0.3
    )
  );

  return {
    bot: {
      id: bot.id,
      displayName: bot.display_name,
      email: bot.email,
      persona: bot.persona,
      personaLabel: dna.personaLabel || PERSONAS[bot.persona]?.label || bot.persona,
      sessionsRun: bot.sessions_run,
      lastRunAt: bot.last_run_at,
      userId,
      dna,
    },
    buyerStage,
    scores: {
      purchaseIntent: profile?.scores?.purchaseIntent ?? 0,
      abandonRisk: profile?.scores?.abandonRisk ?? riskScore,
      engagement: profile?.scores?.engagement ?? 0,
      loyalty: profile?.scores?.loyalty ?? 0,
      priceSensitivity: profile?.scores?.priceSensitivity ?? 0,
      valueScore,
      riskScore,
    },
    funnel,
    commerce: {
      orders: orders.length,
      itemsBought,
      totalSpent: money(totalSpent),
      aov: money(aov),
      avgViewPrice: money(viewPriceN ? Math.round(viewPriceSum / viewPriceN) : 0),
      avgPurchasePrice: money(itemsBought ? Math.round(purchasePriceSum / itemsBought) : 0),
    },
    activity: {
      totalEvents: events.length,
      pageViews,
      searches,
      productViews,
      addToCarts,
      checkouts,
      purchases,
      sessions: sessions.length,
      sessionsWithCart,
      sessionsWithPurchase,
      abandonSessions,
    },
    taste: {
      viewCategories: sortMap(viewCats),
      purchaseCategories: sortMap(purchaseCats),
      viewBrands: sortMap(viewBrands),
      purchaseBrands: sortMap(purchaseBrands),
      topViewed,
      boughtProducts: boughtProducts.slice(-20),
      dealViewRate: pct(dealViews, viewPriceN),
    },
    dnaAlignment,
    sessions: sessions.slice(-15).reverse(),
    journeyPath,
    transformer,
    profile: profile
      ? {
          persona: profile.persona,
          personaLabel: profile.personaLabel,
          confidence: profile.confidence,
          insights: profile.insights,
          recommendations: profile.recommendations,
        }
      : null,
    insights,
    recommendations,
    analyzedAt: new Date().toISOString(),
  };
}

function analyzeAllBotsBuying({ limit = 5000 } = {}) {
  // Full fleet via SQL (was limit 50 + deep per-bot scan — looked like only 50 bots)
  const cap = Math.min(20000, Math.max(1, Number(limit) || 5000));

  let cache = [];
  try {
    cache = require('./realtimeAi').getInferenceCache();
  } catch {
    cache = [];
  }

  const rows = db
    .prepare(
      `SELECT
         b.id AS bot_id,
         b.user_id,
         b.display_name,
         b.persona,
         b.sessions_run,
         COALESCE(ev.views, 0) AS views,
         COALESCE(ev.searches, 0) AS searches,
         COALESCE(ev.carts, 0) AS carts,
         COALESCE(ev.checkouts, 0) AS checkouts,
         COALESCE(ev.purchases, 0) AS purchase_events,
         COALESCE(ord.orders, 0) AS orders,
         COALESCE(ord.revenue, 0) AS revenue,
         cp.purchase_intent,
         cp.abandon_risk,
         cp.engagement_score
       FROM bots b
       LEFT JOIN (
         SELECT user_id,
           SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
           SUM(CASE WHEN type = 'search' THEN 1 ELSE 0 END) AS searches,
           SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
           SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts,
           SUM(CASE WHEN type = 'purchase' THEN 1 ELSE 0 END) AS purchases
         FROM behavior_events WHERE user_id IS NOT NULL GROUP BY user_id
       ) ev ON ev.user_id = b.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS orders, SUM(total_cents) AS revenue
         FROM orders GROUP BY user_id
       ) ord ON ord.user_id = b.user_id
       LEFT JOIN consumer_profiles cp ON cp.profile_key = 'user:' || b.user_id
       WHERE b.sessions_run > 0 OR b.last_run_at IS NOT NULL
       ORDER BY COALESCE(b.last_run_at, b.created_at) DESC
       LIMIT ?`
    )
    .all(cap);

  const analyses = [];
  for (const r of rows) {
    const purchases = Math.max(r.orders || 0, r.purchase_events || 0);
    let buyerStage = 'inactive';
    if (purchases >= 2) buyerStage = 'loyal_customer';
    else if (purchases === 1) buyerStage = 'converted_once';
    else if ((r.checkouts || 0) > 0) buyerStage = 'checkout_abandoner';
    else if ((r.carts || 0) > 0) buyerStage = 'cart_considering';
    else if ((r.views || 0) > 0) buyerStage = 'researching';
    else if ((r.searches || 0) > 0) buyerStage = 'searching';

    const cached = cache.find(
      (c) => c.botId === r.bot_id || c.profileKey === `user:${r.user_id}`
    );
    const tf = cached?.transformer?.label
      ? {
          label: cached.transformer.label,
          confidence: cached.transformer.confidence,
          probs: (cached.transformer.probs || []).slice(0, 3),
        }
      : { available: false };

    const views = r.views || 0;
    analyses.push({
      botId: r.bot_id,
      displayName: r.display_name,
      persona: r.persona,
      personaLabel: (PERSONAS[r.persona] || {}).label || r.persona,
      buyerStage,
      scores: {
        purchaseIntent: r.purchase_intent ?? 0,
        abandonRisk: r.abandon_risk ?? 0,
        engagement: r.engagement_score ?? 0,
      },
      funnel: {
        views,
        addToCart: r.carts || 0,
        beginCheckout: r.checkouts || 0,
        purchase: purchases,
        viewToCart: pct(r.carts || 0, views),
        cartToCheckout: pct(r.checkouts || 0, r.carts || 0),
        checkoutToPurchase: pct(purchases, r.checkouts || 0),
        viewToPurchase: pct(purchases, views),
      },
      commerce: {
        orders: r.orders || 0,
        totalSpent: money(r.revenue || 0),
        aov: money(r.orders ? Math.round((r.revenue || 0) / r.orders) : 0),
      },
      activity: {
        totalEvents: (r.views || 0) + (r.searches || 0) + (r.carts || 0),
        productViews: r.views || 0,
        searches: r.searches || 0,
      },
      transformer: tf,
      topInsight: null,
      dnaAlignment: null,
    });
  }

  setImmediate(() => {
    warmFleetTransformerCache(analyses).catch(() => {});
  });

  const totalActiveBots = db
    .prepare(
      `SELECT COUNT(*) AS c FROM bots WHERE sessions_run > 0 OR last_run_at IS NOT NULL`
    )
    .get().c;
  const totalBots = db.prepare(`SELECT COUNT(*) AS c FROM bots`).get().c;

  const fleet = {
    botsAnalyzed: analyses.length,
    totalActiveBots,
    totalBots,
    coveredAllActive: analyses.length >= totalActiveBots,
    totalOrders: analyses.reduce((s, a) => s + a.commerce.orders, 0),
    totalSpentCents: analyses.reduce((s, a) => s + a.commerce.totalSpent.cents, 0),
    avgConversion: analyses.length
      ? Math.round(
          analyses.reduce((s, a) => s + a.funnel.viewToPurchase, 0) / analyses.length
        )
      : 0,
    stageCounts: {},
    modelLabels: {},
  };
  for (const a of analyses) {
    fleet.stageCounts[a.buyerStage] = (fleet.stageCounts[a.buyerStage] || 0) + 1;
    if (a.transformer.label) {
      fleet.modelLabels[a.transformer.label] =
        (fleet.modelLabels[a.transformer.label] || 0) + 1;
    }
  }
  fleet.totalSpent = money(fleet.totalSpentCents);

  return { fleet, bots: analyses };
}

async function warmFleetTransformerCache(analyses) {
  const { publish } = require('./liveBus');
  const { putInference, getInferenceCache } = require('./realtimeAi');
  const cache = getInferenceCache();
  const have = new Set(
    cache
      .filter((c) => c.transformer?.label)
      .flatMap((c) => [c.botId, c.profileKey].filter(Boolean))
  );

  for (const a of analyses || []) {
    if (!a?.botId || have.has(a.botId)) continue;
    if (a.transformer?.label) continue;
    try {
      const bot = db
        .prepare('SELECT user_id, display_name, persona FROM bots WHERE id = ?')
        .get(a.botId);
      if (!bot) continue;
      const profileKey = `user:${bot.user_id}`;
      if (have.has(profileKey)) continue;
      const prof = db
        .prepare(
          `SELECT journey_path, persona, purchase_intent, abandon_risk, engagement_score, display_name, event_count
           FROM consumer_profiles WHERE profile_key = ?`
        )
        .get(profileKey);
      const pathText = prof?.journey_path || '';
      if (pathText.length < 3) continue;
      const tf = await enqueueTransformerPredict(pathText);
      if (!tf.available) continue;
      const aiUpdate = {
        profileKey,
        displayName: prof?.display_name || bot.display_name,
        rulePersona: prof?.persona || bot.persona,
        scores: {
          purchaseIntent: prof?.purchase_intent,
          abandonRisk: prof?.abandon_risk,
          engagement: prof?.engagement_score,
        },
        transformer: {
          label: tf.label,
          confidence: tf.confidence,
          probs: (tf.probs || []).slice(0, 4),
        },
        eventCount: prof?.event_count || 0,
        lastEventType: 'warm_cache',
        isBot: true,
        botId: a.botId,
        botName: bot.display_name,
        updatedAt: new Date().toISOString(),
      };
      putInference(aiUpdate);
      publish('ai', aiUpdate);
      have.add(a.botId);
      have.add(profileKey);
    } catch {
      /* continue next bot */
    }
  }
}

module.exports = {
  analyzeBotBuying,
  analyzeAllBotsBuying,
  runTransformerPredict,
  runTransformerPredictAsync,
  enqueueTransformerPredict,
  warmFleetTransformerCache,
  clearPredictCache,
};
