/**
 * Buyer behavior analysis — the core commercial intelligence report.
 * Focus: who buys, who almost buys, where they drop, and what to do.
 * (Personas/AI labels are secondary context, not the main story.)
 */
const { db } = require('../db');
const { PERSONAS } = require('./behaviorEngine');

const STAGE_META = {
  loyal_customer: {
    label: 'Loyal customer',
    order: 1,
    color: '#3ecf8e',
    meaning: 'Bought 2+ times. Your revenue core — retain and upsell.',
  },
  converted_once: {
    label: 'First-time buyer',
    order: 2,
    color: '#80ed99',
    meaning: 'Bought once. Push second purchase / loyalty.',
  },
  checkout_abandoner: {
    label: 'Checkout abandoner',
    order: 3,
    color: '#ff6b7a',
    meaning: 'Started checkout, no order. Highest-intent leak.',
  },
  cart_considering: {
    label: 'Cart considerer',
    order: 4,
    color: '#f0a06a',
    meaning: 'Added to cart, never checked out. Soft abandon.',
  },
  researching: {
    label: 'Researcher',
    order: 5,
    color: '#4cc9f0',
    meaning: 'Views products, no cart yet. Needs push to cart.',
  },
  searching: {
    label: 'Searcher',
    order: 6,
    color: '#7c6cf0',
    meaning: 'Searching but not deep into products.',
  },
  inactive: {
    label: 'Inactive',
    order: 7,
    color: '#8b92a8',
    meaning: 'Little or no shopping signal yet.',
  },
};

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

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function classifyBuyerStage({ purchases, checkouts, carts, views, searches }) {
  if (purchases >= 2) return 'loyal_customer';
  if (purchases === 1) return 'converted_once';
  if (checkouts > 0) return 'checkout_abandoner';
  if (carts > 0) return 'cart_considering';
  if (views > 0) return 'researching';
  if (searches > 0) return 'searching';
  return 'inactive';
}

function getBuyerBehaviorAnalysis({ memberLimit = 12 } = {}) {
  // Global funnel from events
  const funnelRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN type = 'search' THEN 1 ELSE 0 END) AS searches,
         SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
         SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts,
         SUM(CASE WHEN type = 'purchase' THEN 1 ELSE 0 END) AS purchases,
         COUNT(*) AS total_events
       FROM behavior_events`
    )
    .get();

  const views = funnelRow.views || 0;
  const searches = funnelRow.searches || 0;
  const carts = funnelRow.carts || 0;
  const checkouts = funnelRow.checkouts || 0;
  const purchases = funnelRow.purchases || 0;

  const funnel = {
    views,
    searches,
    carts,
    checkouts,
    purchases,
    viewToCart: pct(carts, views),
    cartToCheckout: pct(checkouts, carts),
    checkoutToPurchase: pct(purchases, checkouts),
    viewToPurchase: pct(purchases, views),
    searchToView: pct(views, Math.max(searches, 1)),
  };

  // Drop-offs (people who reached step N but not N+1) — event-level rates inverted
  const lost = (convertPct) => Math.round((100 - convertPct) * 10) / 10;
  const dropOffs = [
    {
      step: 'View → Cart',
      from: views,
      to: carts,
      convertPct: funnel.viewToCart,
      lostPct: lost(funnel.viewToCart),
      severity: funnel.viewToCart < 15 ? 'high' : funnel.viewToCart < 30 ? 'medium' : 'low',
      plain:
        funnel.viewToCart < 15
          ? 'Most viewers never add to cart — product pages or pricing may not convince.'
          : funnel.viewToCart < 30
            ? 'OK interest, but many leave after viewing — strengthen PDP / social proof.'
            : 'Healthy view→cart interest.',
    },
    {
      step: 'Cart → Checkout',
      from: carts,
      to: checkouts,
      convertPct: funnel.cartToCheckout,
      lostPct: lost(funnel.cartToCheckout),
      severity: funnel.cartToCheckout < 40 ? 'high' : funnel.cartToCheckout < 60 ? 'medium' : 'low',
      plain:
        funnel.cartToCheckout < 40
          ? 'Carts die before checkout — friction, surprise costs, or weak urgency.'
          : 'Carts often continue to checkout.',
    },
    {
      step: 'Checkout → Buy',
      from: checkouts,
      to: purchases,
      convertPct: funnel.checkoutToPurchase,
      lostPct: lost(funnel.checkoutToPurchase),
      severity:
        funnel.checkoutToPurchase < 50 ? 'high' : funnel.checkoutToPurchase < 75 ? 'medium' : 'low',
      plain:
        funnel.checkoutToPurchase < 50
          ? 'Checkout is leaking buyers — payment UX, trust, or last-step doubt.'
          : 'Checkout completion is relatively strong.',
    },
  ];

  // Commerce totals
  const orderStats = db
    .prepare(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(total_cents), 0) AS revenue,
              COALESCE(AVG(total_cents), 0) AS aov
       FROM orders`
    )
    .get();

  // Per-user buying stats
  const userStats = db
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
         cp.engagement_score,
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
         FROM behavior_events
         WHERE user_id IS NOT NULL
         GROUP BY user_id
       ) ev ON ev.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS orders, SUM(total_cents) AS revenue
         FROM orders GROUP BY user_id
       ) ord ON ord.user_id = u.id
       LEFT JOIN consumer_profiles cp ON cp.profile_key = 'user:' || u.id
       LEFT JOIN bots b ON b.user_id = u.id
       WHERE COALESCE(ev.views,0) + COALESCE(ev.searches,0) + COALESCE(ev.carts,0)
             + COALESCE(ev.checkouts,0) + COALESCE(ord.orders,0) + COALESCE(cp.event_count,0) > 0
       ORDER BY COALESCE(ord.revenue, 0) DESC, COALESCE(ev.views, 0) DESC`
    )
    .all();

  const stages = {};
  for (const k of Object.keys(STAGE_META)) {
    stages[k] = {
      id: k,
      ...STAGE_META[k],
      count: 0,
      bots: 0,
      humans: 0,
      revenueCents: 0,
      orders: 0,
      views: 0,
      carts: 0,
      checkouts: 0,
      intents: [],
      risks: [],
      members: [],
    };
  }

  const shoppers = [];
  for (const u of userStats) {
    const purchaseCount = Math.max(u.orders || 0, u.purchase_events || 0);
    const stage = classifyBuyerStage({
      purchases: purchaseCount,
      checkouts: u.checkouts || 0,
      carts: u.carts || 0,
      views: u.views || 0,
      searches: u.searches || 0,
    });
    const st = stages[stage];
    st.count += 1;
    if (u.is_bot) st.bots += 1;
    else st.humans += 1;
    st.revenueCents += u.revenue || 0;
    st.orders += u.orders || 0;
    st.views += u.views || 0;
    st.carts += u.carts || 0;
    st.checkouts += u.checkouts || 0;
    if (u.purchase_intent != null) st.intents.push(u.purchase_intent);
    if (u.abandon_risk != null) st.risks.push(u.abandon_risk);

    const member = {
      userId: u.user_id,
      name: u.bot_name || u.display_name || u.name || u.email,
      isBot: !!u.is_bot,
      botId: u.bot_id || null,
      profileKey: u.profile_key || `user:${u.user_id}`,
      stage,
      stageLabel: STAGE_META[stage].label,
      views: u.views || 0,
      carts: u.carts || 0,
      checkouts: u.checkouts || 0,
      orders: u.orders || 0,
      revenue: money(u.revenue || 0),
      persona: u.persona,
      personaLabel: (PERSONAS[u.persona] || {}).label || u.persona,
      purchaseIntent: u.purchase_intent ?? null,
      abandonRisk: u.abandon_risk ?? null,
      viewToBuy: pct(purchaseCount, u.views || 0),
    };
    shoppers.push(member);
    if (st.members.length < memberLimit) st.members.push(member);
  }

  const totalShoppers = shoppers.length || 1;
  const stageList = Object.values(stages)
    .map((s) => ({
      id: s.id,
      label: s.label,
      order: s.order,
      color: s.color,
      meaning: s.meaning,
      count: s.count,
      sharePct: pct(s.count, totalShoppers),
      bots: s.bots,
      humans: s.humans,
      orders: s.orders,
      revenue: money(s.revenueCents),
      avgIntent: Math.round(avg(s.intents)),
      avgAbandonRisk: Math.round(avg(s.risks)),
      funnel: {
        views: s.views,
        carts: s.carts,
        checkouts: s.checkouts,
        purchases: s.orders,
      },
      members: s.members,
    }))
    .sort((a, b) => a.order - b.order);

  // Buyers vs non-buyers
  const buyers = shoppers.filter((s) => s.orders > 0);
  const nonBuyers = shoppers.filter((s) => s.orders === 0);
  const almostBuyers = shoppers.filter(
    (s) => s.orders === 0 && (s.checkouts > 0 || s.carts > 0)
  );

  // Category performance (view vs buy)
  const catPerf = db
    .prepare(
      `SELECT c.name AS category,
              SUM(CASE WHEN e.type = 'view_product' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN e.type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM behavior_events e
       JOIN products p ON p.id = e.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE e.product_id IS NOT NULL
       GROUP BY c.id
       HAVING views > 0
       ORDER BY purchases DESC, views DESC
       LIMIT 12`
    )
    .all()
    .map((r) => ({
      category: r.category,
      views: r.views,
      carts: r.carts,
      purchases: r.purchases,
      viewToCart: pct(r.carts, r.views),
      viewToBuy: pct(r.purchases, r.views),
    }));

  // Top converting products
  const topProducts = db
    .prepare(
      `SELECT p.id, p.title, p.brand, c.name AS category,
              SUM(CASE WHEN e.type = 'view_product' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN e.type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM behavior_events e
       JOIN products p ON p.id = e.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE e.product_id IS NOT NULL
       GROUP BY p.id
       HAVING purchases > 0 OR carts > 2
       ORDER BY purchases DESC, carts DESC
       LIMIT 10`
    )
    .all()
    .map((r) => ({
      productId: r.id,
      title: r.title,
      brand: r.brand,
      category: r.category,
      views: r.views,
      carts: r.carts,
      purchases: r.purchases,
      viewToBuy: pct(r.purchases, r.views),
    }));

  // Worst drop products (many views, few buys)
  const leakProducts = db
    .prepare(
      `SELECT p.id, p.title, p.brand,
              SUM(CASE WHEN e.type = 'view_product' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN e.type = 'purchase' THEN 1 ELSE 0 END) AS purchases
       FROM behavior_events e
       JOIN products p ON p.id = e.product_id
       WHERE e.product_id IS NOT NULL
       GROUP BY p.id
       HAVING views >= 8 AND purchases = 0
       ORDER BY views DESC
       LIMIT 8`
    )
    .all()
    .map((r) => ({
      productId: r.id,
      title: r.title,
      brand: r.brand,
      views: r.views,
      carts: r.carts,
      purchases: r.purchases,
    }));

  const takeaways = buildTakeaways({
    funnel,
    dropOffs,
    stageList,
    buyers,
    almostBuyers,
    nonBuyers,
    orderStats,
    totalShoppers: shoppers.length,
    catPerf,
  });

  const actions = buildActions({ dropOffs, stageList, almostBuyers, funnel });

  return {
    generatedAt: new Date().toISOString(),
    focus: 'buyer_behavior',
    summary: {
      shoppers: shoppers.length,
      buyers: buyers.length,
      buyerPct: pct(buyers.length, shoppers.length),
      almostBuyers: almostBuyers.length,
      almostBuyerPct: pct(almostBuyers.length, shoppers.length),
      nonBuyers: nonBuyers.length,
      orders: orderStats.orders || 0,
      revenue: money(orderStats.revenue || 0),
      aov: money(Math.round(orderStats.aov || 0)),
      viewToPurchase: funnel.viewToPurchase,
      checkoutToPurchase: funnel.checkoutToPurchase,
      biggestLeak: dropOffs.slice().sort((a, b) => {
        const score = (d) =>
          (d.severity === 'high' ? 3 : d.severity === 'medium' ? 2 : 1) * d.lostPct;
        return score(b) - score(a);
      })[0],
      biggestStage: stageList.slice().sort((a, b) => b.count - a.count)[0],
    },
    takeaways,
    actions,
    funnel,
    dropOffs,
    stages: stageList,
    segments: {
      buyers: {
        label: 'Buyers',
        count: buyers.length,
        sharePct: pct(buyers.length, shoppers.length),
        revenue: money(buyers.reduce((s, b) => s + b.revenue.cents, 0)),
        meaning: 'Completed at least one order. Protect and grow.',
      },
      almost: {
        label: 'Almost buyers',
        count: almostBuyers.length,
        sharePct: pct(almostBuyers.length, shoppers.length),
        meaning: 'Cart or checkout but no order. Highest recovery ROI.',
      },
      browsers: {
        label: 'Non-buyers (no cart)',
        count: nonBuyers.filter((s) => s.carts === 0 && s.checkouts === 0).length,
        sharePct: pct(
          nonBuyers.filter((s) => s.carts === 0 && s.checkouts === 0).length,
          shoppers.length
        ),
        meaning: 'Looking only — need better hooks to cart.',
      },
    },
    categories: catPerf,
    topProducts,
    leakProducts,
    shoppers: shoppers.slice(0, 80),
    topSpenders: shoppers.filter((s) => s.orders > 0).slice(0, 10),
    topAtRisk: shoppers
      .filter((s) => s.orders === 0 && (s.checkouts > 0 || s.carts > 0))
      .sort((a, b) => (b.abandonRisk || 0) - (a.abandonRisk || 0) || b.checkouts - a.checkouts)
      .slice(0, 10),
  };
}

function buildTakeaways({
  funnel,
  dropOffs,
  stageList,
  buyers,
  almostBuyers,
  nonBuyers,
  orderStats,
  totalShoppers,
  catPerf,
}) {
  const out = [];
  const n = totalShoppers || 1;

  out.push({
    id: 'headline',
    title: 'Bottom line',
    text: `${buyers.length} of ${totalShoppers} shoppers bought (${pct(buyers.length, n)}%). ${almostBuyers.length} almost bought (cart/checkout, no order). Revenue ${money(orderStats.revenue || 0).formatted} across ${orderStats.orders || 0} orders (AOV ${money(Math.round(orderStats.aov || 0)).formatted}).`,
  });

  const worst = dropOffs.slice().sort((a, b) => {
    const score = (d) => (d.severity === 'high' ? 100 : d.severity === 'medium' ? 50 : 10) + d.lostPct;
    return score(b) - score(a);
  })[0];
  if (worst) {
    out.push({
      id: 'leak',
      title: 'Biggest buying leak',
      text: `${worst.step}: only ${worst.convertPct}% convert (${worst.lostPct}% drop). ${worst.plain}`,
    });
  }

  const topStage = stageList.slice().sort((a, b) => b.count - a.count)[0];
  if (topStage && topStage.count) {
    out.push({
      id: 'stage',
      title: 'Most common buyer stage',
      text: `${topStage.label} — ${topStage.count} shoppers (${topStage.sharePct}%). ${topStage.meaning}`,
    });
  }

  const loyal = stageList.find((s) => s.id === 'loyal_customer');
  const checkoutAb = stageList.find((s) => s.id === 'checkout_abandoner');
  const cartCon = stageList.find((s) => s.id === 'cart_considering');
  if (loyal && loyal.count) {
    out.push({
      id: 'revenue_core',
      title: 'Who pays',
      text: `Loyal customers: ${loyal.count} people, ${loyal.revenue.formatted} spent. First-time + loyal = your real buyers.`,
    });
  }
  if ((checkoutAb?.count || 0) + (cartCon?.count || 0) > 0) {
    out.push({
      id: 'recover',
      title: 'Who almost paid',
      text: `${(checkoutAb?.count || 0) + (cartCon?.count || 0)} shoppers in cart/checkout abandon stages. This is the recovery list — not “cold traffic.”`,
    });
  }

  out.push({
    id: 'funnel',
    title: 'Funnel in one line',
    text: `${funnel.views} product views → ${funnel.carts} carts (${funnel.viewToCart}%) → ${funnel.checkouts} checkouts (${funnel.cartToCheckout}%) → ${funnel.purchases} purchases (${funnel.checkoutToPurchase}% of checkouts). Overall view→buy ${funnel.viewToPurchase}%.`,
  });

  const bestCat = catPerf.filter((c) => c.purchases > 0).sort((a, b) => b.viewToBuy - a.viewToBuy)[0];
  if (bestCat) {
    out.push({
      id: 'category',
      title: 'Best converting category',
      text: `${bestCat.category}: ${bestCat.viewToBuy}% view→buy (${bestCat.purchases} buys / ${bestCat.views} views). Double down here.`,
    });
  }

  if (nonBuyers.length > buyers.length * 1.5) {
    out.push({
      id: 'imbalance',
      title: 'Demand vs conversion',
      text: `Non-buyers (${nonBuyers.length}) far outnumber buyers (${buyers.length}). Problem is conversion/path, not “no one showed up.”`,
    });
  }

  return out;
}

function buildActions({ dropOffs, stageList, almostBuyers, funnel }) {
  const actions = [];
  const worst = dropOffs.find((d) => d.severity === 'high') || dropOffs[0];
  if (worst?.step === 'View → Cart') {
    actions.push({
      priority: 1,
      action: 'Improve product pages',
      why: 'View→cart is weak — better images, price clarity, reviews, or deals.',
    });
  }
  if (worst?.step === 'Cart → Checkout') {
    actions.push({
      priority: 1,
      action: 'Reduce cart friction',
      why: 'People add items then leave — show shipping early, simplify cart, add urgency.',
    });
  }
  if (worst?.step === 'Checkout → Buy') {
    actions.push({
      priority: 1,
      action: 'Fix checkout completion',
      why: 'High intent dies at payment — trust badges, fewer form fields, clearer total.',
    });
  }
  if (almostBuyers.length >= 3) {
    actions.push({
      priority: 2,
      action: `Recover ${almostBuyers.length} almost-buyers`,
      why: 'They already carted/checked out — highest ROI list for follow-up offers.',
    });
  }
  const loyal = stageList.find((s) => s.id === 'loyal_customer');
  if (loyal && loyal.count >= 2) {
    actions.push({
      priority: 3,
      action: 'Loyalty program for repeat buyers',
      why: `${loyal.count} loyal customers already drive ${loyal.revenue.formatted}.`,
    });
  }
  if (funnel.viewToPurchase < 5 && funnel.views > 50) {
    actions.push({
      priority: 2,
      action: 'Overall conversion is low',
      why: `Only ${funnel.viewToPurchase}% of views become purchases — attack the worst drop-off first.`,
    });
  }
  if (!actions.length) {
    actions.push({
      priority: 1,
      action: 'Keep generating sessions',
      why: 'Need more buying paths to strengthen the analysis — run bots or real shoppers.',
    });
  }
  return actions.sort((a, b) => a.priority - b.priority);
}

module.exports = {
  getBuyerBehaviorAnalysis,
  classifyBuyerStage,
  STAGE_META,
};
