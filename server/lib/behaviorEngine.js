/**
 * Consumer Behavior Engine
 * Builds a living profile from every tracked shop event for a user/guest.
 */
const { db } = require('../db');

const PERSONAS = {
  window_shopper: {
    label: 'Window Shopper',
    blurb: 'Browses casually with low purchase signals.',
  },
  product_browser: {
    label: 'Product Researcher',
    blurb: 'Deep product page engagement before deciding.',
  },
  bargain_hunter: {
    label: 'Bargain Hunter',
    blurb: 'Gravity toward deals, discounts, and price-sensitive paths.',
  },
  cart_builder: {
    label: 'Cart Builder',
    blurb: 'Adds items frequently; conversion still in progress.',
  },
  cart_abandons: {
    label: 'Cart Abandoner',
    blurb: 'Strong intent signals that stall before payment.',
  },
  high_intent: {
    label: 'High Intent Buyer',
    blurb: 'Short path from view → cart → checkout momentum.',
  },
  loyal_buyer: {
    label: 'Loyal Buyer',
    blurb: 'Repeat purchases and returning engagement.',
  },
  impulse_buyer: {
    label: 'Impulse Buyer',
    blurb: 'Quick add-to-cart and purchase with little research.',
  },
  category_loyal: {
    label: 'Category Loyalist',
    blurb: 'Spends attention in a narrow set of categories.',
  },
  explorer: {
    label: 'Category Explorer',
    blurb: 'Wide multi-category discovery pattern.',
  },
};

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
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

function eventToken(e) {
  const type = (e.type || 'event').toLowerCase();
  if (type === 'page_view') {
    return `page${String(e.path || e.target || '/').replace(/\s+/g, '')}`;
  }
  if (e.product_id) return `${type}:${e.product_id}`;
  if (type === 'purchase') return `purchase:${e.target || 'ok'}`;
  if (type === 'search') return 'search';
  if (type === 'filter_category') return `cat:${e.target || 'all'}`;
  return `${type}:${e.target || ''}`.replace(/:+$/, '');
}

function profileKeyFor({ userId, sessionId }) {
  if (userId && !String(userId).startsWith('u_') && !String(userId).startsWith('s_')) {
    // real registered user ids (uuid or user-demo)
    return `user:${userId}`;
  }
  if (userId && String(userId).startsWith('user-')) return `user:${userId}`;
  // guest / anonymous tracker ids
  if (sessionId) return `guest:${sessionId}`;
  if (userId) return `anon:${userId}`;
  return null;
}

function loadEvents(profileKey) {
  if (profileKey.startsWith('user:')) {
    const userId = profileKey.slice(5);
    return db
      .prepare(
        `SELECT * FROM behavior_events
         WHERE user_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(userId);
  }
  if (profileKey.startsWith('guest:')) {
    const sid = profileKey.slice(6);
    return db
      .prepare(
        `SELECT * FROM behavior_events
         WHERE session_id = ? AND (user_id IS NULL OR user_id LIKE 'u_%' OR user_id LIKE 's_%' OR user_id = ?)
         ORDER BY created_at ASC, id ASC`
      )
      .all(sid, sid);
  }
  if (profileKey.startsWith('anon:')) {
    const uid = profileKey.slice(5);
    return db
      .prepare(
        `SELECT * FROM behavior_events
         WHERE user_id = ?
         ORDER BY created_at ASC, id ASC`
      )
      .all(uid);
  }
  return [];
}

function loadOrders(userId) {
  if (!userId || userId.startsWith('u_') || userId.startsWith('s_') || userId.startsWith('guest')) {
    return [];
  }
  return db
    .prepare(
      `SELECT o.*, (
         SELECT GROUP_CONCAT(product_id) FROM order_items oi WHERE oi.order_id = o.id
       ) AS product_ids
       FROM orders o WHERE o.user_id = ? ORDER BY placed_at ASC`
    )
    .all(userId);
}

function productMeta(productId) {
  if (!productId) return null;
  return db
    .prepare(
      `SELECT p.id, p.title, p.brand, p.price_cents, p.list_price_cents, c.name AS category, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`
    )
    .get(productId);
}

/**
 * Core AI-ish scoring: deterministic multi-signal model over the journey.
 * Produces persona + 0–100 behavioral scores + natural-language insights.
 */
function analyzeEvents(events, orders = []) {
  const counts = {};
  const categories = {};
  const brands = {};
  const products = {};
  const searches = [];
  let dealViews = 0;
  let totalViewPrice = 0;
  let viewPriceN = 0;

  for (const e of events) {
    const t = e.type || 'event';
    counts[t] = (counts[t] || 0) + 1;
    const payload = parsePayload(e.payload);

    if (e.product_id || payload.productId) {
      const pid = e.product_id || payload.productId;
      products[pid] = (products[pid] || 0) + 1;
      const meta = productMeta(pid);
      if (meta) {
        categories[meta.category] = (categories[meta.category] || 0) + 1;
        brands[meta.brand] = (brands[meta.brand] || 0) + 1;
        if (t === 'view_product') {
          totalViewPrice += meta.price_cents;
          viewPriceN += 1;
          if (meta.list_price_cents && meta.list_price_cents > meta.price_cents) {
            dealViews += 1;
          }
        }
      }
    }

    if (payload.category || t === 'filter_category') {
      const cat = payload.category || e.target;
      if (cat) categories[cat] = (categories[cat] || 0) + 1;
    }

    if (t === 'search' && (payload.query || e.target)) {
      searches.push(payload.query || e.target);
    }
  }

  const pageViews = counts.page_view || 0;
  const productViews = counts.view_product || 0;
  const addToCarts = counts.add_to_cart || 0;
  const removeCarts = counts.remove_from_cart || 0;
  const checkouts = counts.begin_checkout || 0;
  const purchasesEvt = counts.purchase || 0;
  const purchaseCount = Math.max(purchasesEvt, orders.length);
  const totalSpent = orders.reduce((s, o) => s + (o.total_cents || 0), 0);

  // --- scores ---
  const engagement = clamp(
    pageViews * 2 +
      productViews * 8 +
      addToCarts * 12 +
      checkouts * 15 +
      purchaseCount * 20 +
      (counts.search || 0) * 5 +
      Object.keys(categories).length * 3
  );

  let purchaseIntent = 10;
  if (productViews) purchaseIntent += Math.min(30, productViews * 6);
  if (addToCarts) purchaseIntent += Math.min(30, addToCarts * 12);
  if (checkouts) purchaseIntent += 20;
  if (purchaseCount) purchaseIntent += 25;
  if (removeCarts && !purchaseCount) purchaseIntent -= 10;
  purchaseIntent = clamp(purchaseIntent);

  let priceSensitivity = 20;
  if (dealViews) priceSensitivity += Math.min(40, dealViews * 10);
  if (searches.some((q) => /deal|cheap|sale|discount|budget/i.test(String(q)))) {
    priceSensitivity += 20;
  }
  if (viewPriceN) {
    const avg = totalViewPrice / viewPriceN;
    if (avg < 4000) priceSensitivity += 15;
    if (avg > 15000) priceSensitivity -= 10;
  }
  priceSensitivity = clamp(priceSensitivity);

  let loyalty = 5;
  if (purchaseCount >= 2) loyalty += 40;
  if (purchaseCount >= 3) loyalty += 20;
  if (pageViews > 15) loyalty += 15;
  if (Object.keys(brands).length === 1 && productViews > 3) loyalty += 15;
  loyalty = clamp(loyalty);

  let abandonRisk = 15;
  if (addToCarts > 0 && purchaseCount === 0) abandonRisk += 35;
  if (checkouts > 0 && purchaseCount === 0) abandonRisk += 30;
  if (removeCarts > addToCarts) abandonRisk += 15;
  if (purchaseCount > 0) abandonRisk = Math.max(5, abandonRisk - 40);
  if (productViews > 8 && addToCarts === 0) abandonRisk += 10;
  abandonRisk = clamp(abandonRisk);

  // --- persona ---
  const catKeys = Object.keys(categories);
  const topCatShare =
    catKeys.length === 0
      ? 0
      : Math.max(...Object.values(categories)) / Object.values(categories).reduce((a, b) => a + b, 0);

  let persona = 'window_shopper';
  let confidence = 0.45;

  if (purchaseCount >= 2) {
    persona = 'loyal_buyer';
    confidence = 0.82;
  } else if (purchaseCount === 1 && productViews <= 3 && addToCarts <= 2) {
    persona = 'impulse_buyer';
    confidence = 0.7;
  } else if (checkouts > 0 && purchaseCount === 0) {
    persona = 'cart_abandons';
    confidence = 0.78;
  } else if (addToCarts > 0 && purchaseCount === 0) {
    persona = 'cart_builder';
    confidence = 0.65;
  } else if (addToCarts > 0 && checkouts > 0) {
    persona = 'high_intent';
    confidence = 0.72;
  } else if (priceSensitivity >= 60 && productViews > 0) {
    persona = 'bargain_hunter';
    confidence = 0.68;
  } else if (topCatShare >= 0.7 && productViews >= 3) {
    persona = 'category_loyal';
    confidence = 0.66;
  } else if (catKeys.length >= 4) {
    persona = 'explorer';
    confidence = 0.6;
  } else if (productViews >= 2) {
    persona = 'product_browser';
    confidence = 0.62;
  }

  if (events.length < 2) confidence = Math.min(confidence, 0.35);

  // affinities
  const sortMap = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

  const topProducts = sortMap(products).map((p) => {
    const meta = productMeta(p.name);
    return {
      productId: p.name,
      title: meta?.title || p.name,
      brand: meta?.brand || null,
      views: p.count,
    };
  });

  const journey = events.map(eventToken);
  const journeyPath = journey.slice(-48).join(' ');

  // insights
  const insights = [];
  const personaMeta = PERSONAS[persona] || { label: persona, blurb: '' };
  insights.push(`Classified as ${personaMeta.label}: ${personaMeta.blurb}`);

  if (productViews) {
    insights.push(
      `Viewed ${productViews} product page${productViews === 1 ? '' : 's'} across ${catKeys.length || 0} categor${catKeys.length === 1 ? 'y' : 'ies'}.`
    );
  }
  if (addToCarts && !purchaseCount) {
    insights.push(
      `${addToCarts} add-to-cart action${addToCarts === 1 ? '' : 's'} without a completed purchase — nurture or retarget.`
    );
  }
  if (purchaseCount) {
    insights.push(
      `Completed ${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'} totaling $${(totalSpent / 100).toFixed(2)}.`
    );
  }
  if (sortMap(categories)[0]) {
    insights.push(`Strongest category interest: ${sortMap(categories)[0].name}.`);
  }
  if (sortMap(brands)[0]) {
    insights.push(`Most engaged brand: ${sortMap(brands)[0].name}.`);
  }
  if (abandonRisk >= 60) {
    insights.push('Elevated cart abandonment risk — consider recovery offer.');
  }
  if (purchaseIntent >= 70 && purchaseCount === 0) {
    insights.push('High purchase intent without conversion — prioritize in sales funnel.');
  }
  if (searches.length) {
    insights.push(`Search terms observed: ${[...new Set(searches)].slice(0, 5).join(', ')}.`);
  }

  const recommendations = [];
  if (persona === 'cart_abandons' || abandonRisk >= 60) {
    recommendations.push('Trigger cart recovery email/push with free shipping nudge.');
  }
  if (persona === 'bargain_hunter' || priceSensitivity >= 55) {
    recommendations.push('Surface markdowns and bundle discounts on next visit.');
  }
  if (persona === 'loyal_buyer') {
    recommendations.push('Invite to loyalty tier / early access drops.');
  }
  if (persona === 'product_browser' || persona === 'explorer') {
    recommendations.push('Show comparison content and social proof on PDPs.');
  }
  if (sortMap(categories)[0]) {
    recommendations.push(`Merchandize more ${sortMap(categories)[0].name} on the home rail.`);
  }
  if (!recommendations.length) {
    recommendations.push('Continue passive observation; gather more journey signals.');
  }

  return {
    persona,
    personaLabel: personaMeta.label,
    personaBlurb: personaMeta.blurb,
    confidence: Math.round(confidence * 100) / 100,
    scores: {
      engagement,
      purchaseIntent,
      priceSensitivity,
      loyalty,
      abandonRisk,
    },
    counts: {
      pageViews,
      productViews,
      addToCarts,
      removeCarts,
      checkouts,
      purchases: purchaseCount,
      searches: counts.search || 0,
      totalEvents: events.length,
    },
    categoryAffinity: sortMap(categories),
    brandAffinity: sortMap(brands),
    topProducts,
    searches: [...new Set(searches)].slice(0, 12),
    journey,
    journeyPath,
    purchaseCount,
    totalSpentCents: totalSpent,
    insights,
    recommendations,
    eventTimeline: events.slice(-100).map((e) => ({
      id: e.id,
      type: e.type,
      target: e.target,
      productId: e.product_id,
      path: e.path,
      sessionId: e.session_id,
      createdAt: e.created_at,
      payload: parsePayload(e.payload),
    })),
  };
}

function resolveDisplayName(profileKey, userId) {
  if (userId) {
    const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId);
    if (u) return `${u.name} (${u.email})`;
  }
  if (profileKey.startsWith('guest:')) return `Guest ${profileKey.slice(6, 14)}…`;
  if (profileKey.startsWith('anon:')) return `Anonymous ${profileKey.slice(5, 12)}`;
  return profileKey;
}

function upsertConsumerProfile(profileKey) {
  if (!profileKey) return null;
  const events = loadEvents(profileKey);
  if (!events.length) return null;

  let userId = null;
  let sessionId = null;
  if (profileKey.startsWith('user:')) userId = profileKey.slice(5);
  if (profileKey.startsWith('guest:')) sessionId = profileKey.slice(6);

  // Prefer real user id from events
  for (const e of events) {
    if (e.user_id && !String(e.user_id).startsWith('u_') && !String(e.user_id).startsWith('s_')) {
      userId = e.user_id;
      break;
    }
  }
  for (const e of events) {
    if (e.session_id) {
      sessionId = e.session_id;
      break;
    }
  }

  const orders = userId ? loadOrders(userId) : [];
  const analysis = analyzeEvents(events, orders);
  const displayName = resolveDisplayName(profileKey, userId);
  const lastActive = events[events.length - 1]?.created_at || null;

  db.prepare(
    `INSERT INTO consumer_profiles (
      profile_key, user_id, session_id, display_name, persona, confidence,
      engagement_score, purchase_intent, price_sensitivity, loyalty_score, abandon_risk,
      category_affinity, brand_affinity, top_products, journey_path,
      event_count, purchase_count, total_spent_cents, insights, scores_json,
      last_active, updated_at
    ) VALUES (
      @profile_key, @user_id, @session_id, @display_name, @persona, @confidence,
      @engagement_score, @purchase_intent, @price_sensitivity, @loyalty_score, @abandon_risk,
      @category_affinity, @brand_affinity, @top_products, @journey_path,
      @event_count, @purchase_count, @total_spent_cents, @insights, @scores_json,
      @last_active, datetime('now')
    )
    ON CONFLICT(profile_key) DO UPDATE SET
      user_id = excluded.user_id,
      session_id = excluded.session_id,
      display_name = excluded.display_name,
      persona = excluded.persona,
      confidence = excluded.confidence,
      engagement_score = excluded.engagement_score,
      purchase_intent = excluded.purchase_intent,
      price_sensitivity = excluded.price_sensitivity,
      loyalty_score = excluded.loyalty_score,
      abandon_risk = excluded.abandon_risk,
      category_affinity = excluded.category_affinity,
      brand_affinity = excluded.brand_affinity,
      top_products = excluded.top_products,
      journey_path = excluded.journey_path,
      event_count = excluded.event_count,
      purchase_count = excluded.purchase_count,
      total_spent_cents = excluded.total_spent_cents,
      insights = excluded.insights,
      scores_json = excluded.scores_json,
      last_active = excluded.last_active,
      updated_at = datetime('now')`
  ).run({
    profile_key: profileKey,
    user_id: userId,
    session_id: sessionId,
    display_name: displayName,
    persona: analysis.persona,
    confidence: analysis.confidence,
    engagement_score: analysis.scores.engagement,
    purchase_intent: analysis.scores.purchaseIntent,
    price_sensitivity: analysis.scores.priceSensitivity,
    loyalty_score: analysis.scores.loyalty,
    abandon_risk: analysis.scores.abandonRisk,
    category_affinity: JSON.stringify(analysis.categoryAffinity),
    brand_affinity: JSON.stringify(analysis.brandAffinity),
    top_products: JSON.stringify(analysis.topProducts),
    journey_path: analysis.journeyPath,
    event_count: analysis.counts.totalEvents,
    purchase_count: analysis.purchaseCount,
    total_spent_cents: analysis.totalSpentCents,
    insights: JSON.stringify({
      insights: analysis.insights,
      recommendations: analysis.recommendations,
      counts: analysis.counts,
      searches: analysis.searches,
    }),
    scores_json: JSON.stringify(analysis.scores),
    last_active: lastActive,
  });

  return { profileKey, ...analysis, displayName, userId, sessionId, lastActive };
}

function rebuildProfileFromEvent(row) {
  const key = profileKeyFor({
    userId: row.user_id,
    sessionId: row.session_id,
  });
  if (!key) return null;
  try {
    return upsertConsumerProfile(key);
  } catch (err) {
    console.error('Profile rebuild failed:', err.message);
    return null;
  }
}

function listProfiles({ q, persona, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (persona) {
    where.push('persona = @persona');
    params.persona = persona;
  }
  if (q) {
    where.push('(display_name LIKE @q OR profile_key LIKE @q OR user_id LIKE @q)');
    params.q = `%${q}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM consumer_profiles ${whereSql}`)
    .get(params).c;
  const rows = db
    .prepare(
      `SELECT * FROM consumer_profiles ${whereSql}
       ORDER BY last_active DESC, updated_at DESC
       LIMIT ${Math.min(100, limit)} OFFSET ${offset}`
    )
    .all(params);

  return {
    total,
    profiles: rows.map(mapProfileRow),
  };
}

function mapProfileRow(row) {
  if (!row) return null;
  const extra = parsePayload(row.insights);
  return {
    profileKey: row.profile_key,
    userId: row.user_id,
    sessionId: row.session_id,
    displayName: row.display_name,
    persona: row.persona,
    personaLabel: (PERSONAS[row.persona] || {}).label || row.persona,
    personaBlurb: (PERSONAS[row.persona] || {}).blurb || '',
    confidence: row.confidence,
    scores: {
      engagement: row.engagement_score,
      purchaseIntent: row.purchase_intent,
      priceSensitivity: row.price_sensitivity,
      loyalty: row.loyalty_score,
      abandonRisk: row.abandon_risk,
    },
    categoryAffinity: parsePayload(row.category_affinity) || [],
    brandAffinity: parsePayload(row.brand_affinity) || [],
    topProducts: parsePayload(row.top_products) || [],
    journeyPath: row.journey_path,
    eventCount: row.event_count,
    purchaseCount: row.purchase_count,
    totalSpent: {
      cents: row.total_spent_cents,
      formatted: `$${((row.total_spent_cents || 0) / 100).toFixed(2)}`,
    },
    insights: extra.insights || [],
    recommendations: extra.recommendations || [],
    counts: extra.counts || null,
    searches: extra.searches || [],
    lastActive: row.last_active,
    updatedAt: row.updated_at,
  };
}

function getProfile(profileKey) {
  let row = db
    .prepare('SELECT * FROM consumer_profiles WHERE profile_key = ?')
    .get(profileKey);
  if (!row) {
    // try rebuild
    const rebuilt = upsertConsumerProfile(profileKey);
    if (!rebuilt) return null;
    row = db
      .prepare('SELECT * FROM consumer_profiles WHERE profile_key = ?')
      .get(profileKey);
  }
  const base = mapProfileRow(row);
  const full = upsertConsumerProfile(profileKey);
  return {
    ...base,
    ...full,
    scores: full?.scores || base.scores,
    eventTimeline: full?.eventTimeline || [],
  };
}

function rebuildAllProfiles() {
  const keys = new Set();
  const rows = db
    .prepare(
      `SELECT DISTINCT user_id, session_id FROM behavior_events
       WHERE user_id IS NOT NULL OR session_id IS NOT NULL`
    )
    .all();
  for (const r of rows) {
    const key = profileKeyFor({ userId: r.user_id, sessionId: r.session_id });
    if (key) keys.add(key);
  }
  let n = 0;
  for (const key of keys) {
    if (upsertConsumerProfile(key)) n += 1;
  }
  return { rebuilt: n, profiles: keys.size };
}

function overviewStats() {
  const events = db.prepare('SELECT COUNT(*) AS c FROM behavior_events').get().c;
  const profiles = db.prepare('SELECT COUNT(*) AS c FROM consumer_profiles').get().c;
  const users = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 0').get().c;
  const orders = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS rev FROM orders').get();
  const personaDist = db
    .prepare(
      `SELECT persona, COUNT(*) AS c FROM consumer_profiles GROUP BY persona ORDER BY c DESC`
    )
    .all();
  const recentEvents = db
    .prepare(
      `SELECT id, user_id, session_id, type, target, product_id, path, created_at
       FROM behavior_events ORDER BY id DESC LIMIT 25`
    )
    .all();
  const topIntent = db
    .prepare(
      `SELECT profile_key, display_name, persona, purchase_intent, abandon_risk, event_count, last_active
       FROM consumer_profiles ORDER BY purchase_intent DESC LIMIT 8`
    )
    .all();
  const highRisk = db
    .prepare(
      `SELECT profile_key, display_name, persona, abandon_risk, purchase_intent, event_count, last_active
       FROM consumer_profiles ORDER BY abandon_risk DESC LIMIT 8`
    )
    .all();

  const byType = db
    .prepare(
      `SELECT type, COUNT(*) AS c FROM behavior_events GROUP BY type ORDER BY c DESC`
    )
    .all();

  return {
    totals: {
      events,
      profiles,
      shoppers: users,
      orders: orders.c,
      revenueCents: orders.rev,
      revenueFormatted: `$${((orders.rev || 0) / 100).toFixed(2)}`,
    },
    personaDistribution: personaDist.map((p) => ({
      persona: p.persona,
      label: (PERSONAS[p.persona] || {}).label || p.persona,
      count: p.c,
    })),
    eventTypeBreakdown: byType,
    recentEvents,
    topIntent: topIntent.map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      personaLabel: (PERSONAS[r.persona] || {}).label || r.persona,
      purchaseIntent: r.purchase_intent,
      abandonRisk: r.abandon_risk,
      eventCount: r.event_count,
      lastActive: r.last_active,
    })),
    highAbandonRisk: highRisk.map((r) => ({
      profileKey: r.profile_key,
      displayName: r.display_name,
      persona: r.persona,
      personaLabel: (PERSONAS[r.persona] || {}).label || r.persona,
      abandonRisk: r.abandon_risk,
      purchaseIntent: r.purchase_intent,
      eventCount: r.event_count,
      lastActive: r.last_active,
    })),
    personas: PERSONAS,
  };
}

module.exports = {
  PERSONAS,
  profileKeyFor,
  analyzeEvents,
  upsertConsumerProfile,
  rebuildProfileFromEvent,
  listProfiles,
  getProfile,
  rebuildAllProfiles,
  overviewStats,
  eventToken,
};
