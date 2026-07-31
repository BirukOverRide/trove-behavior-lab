/**
 * General persona analysis — categorize all shoppers by behavior patterns.
 * Combines rule personas, activity funnels, commerce, and Tiny TF labels.
 */
const { db } = require('../db');
const { PERSONAS } = require('./behaviorEngine');

const BEHAVIOR_CATEGORIES = {
  browsers: {
    id: 'browsers',
    label: 'Browsers',
    color: '#4cc9f0',
    description: 'Look around a lot; weak or delayed purchase signal.',
    personas: ['window_shopper', 'product_browser', 'explorer'],
  },
  deal_seekers: {
    id: 'deal_seekers',
    label: 'Deal seekers',
    color: '#e9c46a',
    description: 'Price- and discount-sensitive paths.',
    personas: ['bargain_hunter'],
  },
  cart_friction: {
    id: 'cart_friction',
    label: 'Cart friction',
    color: '#f0a06a',
    description: 'Build carts or reach checkout but often stall.',
    personas: ['cart_builder', 'cart_abandons'],
  },
  converters: {
    id: 'converters',
    label: 'Converters',
    color: '#3ecf8e',
    description: 'High purchase momentum and/or repeat buying.',
    personas: ['high_intent', 'impulse_buyer', 'loyal_buyer'],
  },
  specialists: {
    id: 'specialists',
    label: 'Specialists',
    color: '#7c6cf0',
    description: 'Narrow category loyalty or focused affinity.',
    personas: ['category_loyal'],
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

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function parseJson(s, fallback) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function categoryForPersona(persona) {
  for (const cat of Object.values(BEHAVIOR_CATEGORIES)) {
    if (cat.personas.includes(persona)) return cat.id;
  }
  return 'browsers';
}

function getTfCache() {
  try {
    return require('./realtimeAi').getInferenceCache() || [];
  } catch {
    return [];
  }
}

/**
 * Full general persona analysis report.
 */
function getPersonaAnalysis({ limitMembers = 8 } = {}) {
  const profiles = db
    .prepare(
      `SELECT profile_key, user_id, session_id, display_name, persona, confidence,
              engagement_score, purchase_intent, price_sensitivity, loyalty_score,
              abandon_risk, category_affinity, brand_affinity, top_products,
              journey_path, event_count, purchase_count, total_spent_cents,
              insights, scores_json, last_active, updated_at
       FROM consumer_profiles
       ORDER BY event_count DESC`
    )
    .all();

  const botsByUser = new Map(
    db
      .prepare(`SELECT id, user_id, display_name, persona AS dna_persona FROM bots`)
      .all()
      .map((b) => [b.user_id, b])
  );

  const tfCache = getTfCache();
  const tfByKey = new Map(tfCache.map((t) => [t.profileKey, t]));

  // Event funnel counts per user (for profiles with user_id)
  const eventAgg = db
    .prepare(
      `SELECT user_id,
              SUM(CASE WHEN type = 'view_product' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN type = 'search' THEN 1 ELSE 0 END) AS searches,
              SUM(CASE WHEN type = 'add_to_cart' THEN 1 ELSE 0 END) AS carts,
              SUM(CASE WHEN type = 'begin_checkout' THEN 1 ELSE 0 END) AS checkouts,
              SUM(CASE WHEN type = 'purchase' THEN 1 ELSE 0 END) AS purchases,
              COUNT(*) AS total
       FROM behavior_events
       WHERE user_id IS NOT NULL
       GROUP BY user_id`
    )
    .all();
  const eventsByUser = new Map(eventAgg.map((r) => [r.user_id, r]));

  const byPersona = {};
  for (const key of Object.keys(PERSONAS)) {
    byPersona[key] = emptyPersonaBucket(key);
  }

  const members = [];
  let totalSpent = 0;
  let totalPurchases = 0;
  let totalEvents = 0;
  let aiAgree = 0;
  let aiCompared = 0;

  for (const row of profiles) {
    const persona = row.persona || 'window_shopper';
    if (!byPersona[persona]) byPersona[persona] = emptyPersonaBucket(persona);

    const bot = row.user_id ? botsByUser.get(row.user_id) : null;
    const ev = row.user_id ? eventsByUser.get(row.user_id) : null;
    const tf = tfByKey.get(row.profile_key);
    const tfLabel = tf?.transformer?.label || null;
    const tfConf = tf?.transformer?.confidence ?? null;

    if (tfLabel) {
      aiCompared += 1;
      if (tfLabel === persona) aiAgree += 1;
    }

    const spent = row.total_spent_cents || 0;
    const purchases = row.purchase_count || 0;
    const events = row.event_count || 0;
    totalSpent += spent;
    totalPurchases += purchases;
    totalEvents += events;

    const bucket = byPersona[persona];
    bucket.count += 1;
    bucket.bots += bot ? 1 : 0;
    bucket.humans += bot ? 0 : 1;
    bucket.eventCount += events;
    bucket.purchaseCount += purchases;
    bucket.spentCents += spent;
    bucket.scores.purchaseIntent.push(row.purchase_intent || 0);
    bucket.scores.abandonRisk.push(row.abandon_risk || 0);
    bucket.scores.engagement.push(row.engagement_score || 0);
    bucket.scores.loyalty.push(row.loyalty_score || 0);
    bucket.scores.priceSensitivity.push(row.price_sensitivity || 0);
    bucket.scores.confidence.push((row.confidence || 0) * (row.confidence <= 1 ? 100 : 1));

    if (ev) {
      bucket.funnel.views += ev.views || 0;
      bucket.funnel.searches += ev.searches || 0;
      bucket.funnel.carts += ev.carts || 0;
      bucket.funnel.checkouts += ev.checkouts || 0;
      bucket.funnel.purchases += ev.purchases || 0;
    }

    // category affinities
    const cats = parseJson(row.category_affinity, {});
    for (const [cat, n] of Object.entries(cats)) {
      bucket.topCategories[cat] = (bucket.topCategories[cat] || 0) + Number(n || 0);
    }
    const brands = parseJson(row.brand_affinity, {});
    for (const [br, n] of Object.entries(brands)) {
      bucket.topBrands[br] = (bucket.topBrands[br] || 0) + Number(n || 0);
    }

    if (tfLabel) {
      bucket.ai.labeled += 1;
      bucket.ai.labels[tfLabel] = (bucket.ai.labels[tfLabel] || 0) + 1;
      if (tfLabel === persona) bucket.ai.agree += 1;
      if (tfConf != null) bucket.ai.confidences.push(tfConf);
    }

    const member = {
      profileKey: row.profile_key,
      displayName: row.display_name || row.profile_key,
      persona,
      isBot: !!bot,
      botId: bot?.id || null,
      eventCount: events,
      purchaseCount: purchases,
      spent: money(spent),
      purchaseIntent: row.purchase_intent || 0,
      abandonRisk: row.abandon_risk || 0,
      engagement: row.engagement_score || 0,
      transformer: tfLabel
        ? { label: tfLabel, confidence: tfConf, agrees: tfLabel === persona }
        : null,
      lastActive: row.last_active,
    };
    members.push(member);
    if (bucket.members.length < limitMembers) {
      bucket.members.push(member);
    }
  }

  // Finalize persona buckets
  const personaList = Object.values(byPersona)
    .map((b) => finalizeBucket(b, profiles.length))
    .filter((b) => b.count > 0 || PERSONAS[b.persona])
    .sort((a, b) => b.count - a.count);

  // Behavior super-categories
  const categories = Object.values(BEHAVIOR_CATEGORIES).map((cat) => {
    const parts = cat.personas
      .map((p) => personaList.find((x) => x.persona === p))
      .filter(Boolean);
    const count = parts.reduce((s, p) => s + p.count, 0);
    const spentCents = parts.reduce((s, p) => s + p.spentCents, 0);
    const purchaseCount = parts.reduce((s, p) => s + p.purchaseCount, 0);
    const avgIntent = avg(parts.map((p) => p.avgScores.purchaseIntent));
    const avgAbandon = avg(parts.map((p) => p.avgScores.abandonRisk));
    return {
      id: cat.id,
      label: cat.label,
      color: cat.color,
      description: cat.description,
      personas: cat.personas,
      count,
      sharePct: pct(count, profiles.length),
      purchaseCount,
      spent: money(spentCents),
      avgPurchaseIntent: Math.round(avgIntent),
      avgAbandonRisk: Math.round(avgAbandon),
      breakdown: parts.map((p) => ({
        persona: p.persona,
        label: p.label,
        count: p.count,
        sharePct: p.sharePct,
      })),
      behaviorSignals: parts.flatMap((p) => p.behaviorSignals).slice(0, 6),
    };
  });

  // AI label distribution (what Tiny TF thinks)
  const aiDist = {};
  for (const t of tfCache) {
    const lab = t.transformer?.label;
    if (!lab) continue;
    aiDist[lab] = (aiDist[lab] || 0) + 1;
  }

  // Cross-tab: rule persona vs AI (agreement matrix keys)
  const confusionRuleAi = {};
  for (const m of members) {
    if (!m.transformer?.label) continue;
    const k = `${m.persona}→${m.transformer.label}`;
    confusionRuleAi[k] = (confusionRuleAi[k] || 0) + 1;
  }
  const topConfusions = Object.entries(confusionRuleAi)
    .map(([k, n]) => {
      const [rule, ai] = k.split('→');
      return { rule, ai, count: n, match: rule === ai };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Behavioral insights (narrative)
  const insights = buildInsights({
    profiles,
    personaList,
    categories,
    totalSpent,
    totalPurchases,
    aiAgree,
    aiCompared,
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalProfiles: profiles.length,
      totalBots: members.filter((m) => m.isBot).length,
      totalHumans: members.filter((m) => !m.isBot).length,
      totalEvents,
      totalPurchases,
      totalSpent: money(totalSpent),
      personaTypesPresent: personaList.filter((p) => p.count > 0).length,
      personaTypesDefined: Object.keys(PERSONAS).length,
      aiClassified: aiCompared,
      aiAgreementPct: pct(aiAgree, aiCompared),
      dominantPersona: personaList[0]
        ? { persona: personaList[0].persona, label: personaList[0].label, sharePct: personaList[0].sharePct }
        : null,
      dominantCategory: [...categories].sort((a, b) => b.count - a.count)[0] || null,
    },
    categories,
    personas: personaList,
    aiDistribution: Object.entries(aiDist)
      .map(([label, count]) => ({
        label,
        count,
        sharePct: pct(count, aiCompared || 1),
        meta: PERSONAS[label] || { label, blurb: '' },
      }))
      .sort((a, b) => b.count - a.count),
    ruleVsAi: {
      compared: aiCompared,
      agree: aiAgree,
      agreementPct: pct(aiAgree, aiCompared),
      topPairs: topConfusions,
    },
    insights,
    catalog: Object.entries(PERSONAS).map(([id, meta]) => ({
      persona: id,
      label: meta.label,
      blurb: meta.blurb,
      category: categoryForPersona(id),
      categoryLabel: BEHAVIOR_CATEGORIES[categoryForPersona(id)]?.label,
    })),
  };
}

function emptyPersonaBucket(persona) {
  const meta = PERSONAS[persona] || { label: persona, blurb: '' };
  return {
    persona,
    label: meta.label,
    blurb: meta.blurb,
    category: categoryForPersona(persona),
    count: 0,
    bots: 0,
    humans: 0,
    eventCount: 0,
    purchaseCount: 0,
    spentCents: 0,
    scores: {
      purchaseIntent: [],
      abandonRisk: [],
      engagement: [],
      loyalty: [],
      priceSensitivity: [],
      confidence: [],
    },
    funnel: { views: 0, searches: 0, carts: 0, checkouts: 0, purchases: 0 },
    topCategories: {},
    topBrands: {},
    ai: { labeled: 0, agree: 0, labels: {}, confidences: [] },
    members: [],
  };
}

function topEntries(obj, n = 5) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function finalizeBucket(b, totalProfiles) {
  const f = b.funnel;
  const viewToCart = pct(f.carts, f.views);
  const cartToBuy = pct(f.purchases, f.carts);
  const viewToBuy = pct(f.purchases, f.views);

  const avgScores = {
    purchaseIntent: Math.round(avg(b.scores.purchaseIntent)),
    abandonRisk: Math.round(avg(b.scores.abandonRisk)),
    engagement: Math.round(avg(b.scores.engagement)),
    loyalty: Math.round(avg(b.scores.loyalty)),
    priceSensitivity: Math.round(avg(b.scores.priceSensitivity)),
    confidence: Math.round(avg(b.scores.confidence)),
  };

  const behaviorSignals = [];
  if (viewToBuy >= 25) behaviorSignals.push('Strong view→buy conversion');
  if (viewToBuy > 0 && viewToBuy < 8 && f.views > 20) {
    behaviorSignals.push('Lots of browsing, rare purchases');
  }
  if (f.carts > f.purchases * 2 && f.carts >= 3) {
    behaviorSignals.push('Cart activity outpaces purchases (friction)');
  }
  if (avgScores.abandonRisk >= 55) behaviorSignals.push('Elevated abandon risk');
  if (avgScores.purchaseIntent >= 70) behaviorSignals.push('High purchase intent');
  if (avgScores.loyalty >= 60) behaviorSignals.push('Loyalty-leaning engagement');
  if (avgScores.priceSensitivity >= 55) behaviorSignals.push('Price-sensitive behavior');
  if (f.searches > f.views * 0.4 && f.searches >= 5) {
    behaviorSignals.push('Search-heavy discovery');
  }
  if (b.purchaseCount >= b.count && b.count > 0) {
    behaviorSignals.push('Most members have purchased');
  }
  if (!behaviorSignals.length) behaviorSignals.push('Mixed / early signals');

  const aiTop = topEntries(b.ai.labels, 3);

  return {
    persona: b.persona,
    label: b.label,
    blurb: b.blurb,
    category: b.category,
    categoryLabel: BEHAVIOR_CATEGORIES[b.category]?.label || b.category,
    count: b.count,
    sharePct: pct(b.count, totalProfiles),
    bots: b.bots,
    humans: b.humans,
    eventCount: b.eventCount,
    avgEvents: b.count ? Math.round(b.eventCount / b.count) : 0,
    purchaseCount: b.purchaseCount,
    spentCents: b.spentCents,
    spent: money(b.spentCents),
    avgSpent: money(b.count ? Math.round(b.spentCents / b.count) : 0),
    avgScores,
    funnel: {
      ...f,
      viewToCart,
      cartToBuy,
      viewToBuy,
    },
    topCategories: topEntries(b.topCategories, 5),
    topBrands: topEntries(b.topBrands, 5),
    ai: {
      labeled: b.ai.labeled,
      agree: b.ai.agree,
      agreementPct: pct(b.ai.agree, b.ai.labeled),
      meanConfidence: b.ai.confidences.length
        ? Math.round(avg(b.ai.confidences) * 1000) / 1000
        : null,
      topPredictions: aiTop,
    },
    behaviorSignals,
    members: b.members,
  };
}

function buildInsights({
  profiles,
  personaList,
  categories,
  totalSpent,
  totalPurchases,
  aiAgree,
  aiCompared,
}) {
  const out = [];
  const n = profiles.length || 1;
  const top = personaList.filter((p) => p.count > 0)[0];
  if (top) {
    out.push({
      kind: 'dominant',
      text: `Largest behavior group is ${top.label} (${top.sharePct}% of profiles, n=${top.count}). ${top.blurb}`,
    });
  }

  const converters = categories.find((c) => c.id === 'converters');
  const friction = categories.find((c) => c.id === 'cart_friction');
  const browsers = categories.find((c) => c.id === 'browsers');

  if (converters && converters.sharePct >= 30) {
    out.push({
      kind: 'positive',
      text: `Converters are ${converters.sharePct}% of the population — high-intent / loyal / impulse patterns dominate buying power (${converters.spent.formatted} spent).`,
    });
  }
  if (friction && friction.sharePct >= 20) {
    out.push({
      kind: 'risk',
      text: `Cart friction group is ${friction.sharePct}% — many shoppers add or checkout but stall. Recovery messaging and simpler checkout may lift conversion.`,
    });
  }
  if (browsers && browsers.sharePct >= 25) {
    out.push({
      kind: 'opportunity',
      text: `Browsers are ${browsers.sharePct}% — discovery-heavy traffic. Better merchandising and personalization can move them toward cart.`,
    });
  }

  const abandoners = personaList.find((p) => p.persona === 'cart_abandons');
  if (abandoners && abandoners.count >= 3) {
    out.push({
      kind: 'risk',
      text: `${abandoners.count} cart abandoners · avg abandon risk ${abandoners.avgScores.abandonRisk} · view→buy ${abandoners.funnel.viewToBuy}%.`,
    });
  }

  const loyal = personaList.find((p) => p.persona === 'loyal_buyer');
  if (loyal && loyal.count >= 2) {
    out.push({
      kind: 'positive',
      text: `Loyal buyers: ${loyal.count} profiles, ${loyal.spent.formatted} lifetime spend, avg loyalty score ${loyal.avgScores.loyalty}.`,
    });
  }

  if (aiCompared >= 5) {
    out.push({
      kind: 'model',
      text: `Tiny AI classified ${aiCompared} profiles · agrees with rule persona on ${pct(aiAgree, aiCompared)}%. Disagreements highlight journeys that look different from designed DNA.`,
    });
  }

  out.push({
    kind: 'scale',
    text: `Population: ${profiles.length} profiles · ${totalPurchases} recorded purchases · ${money(totalSpent).formatted} total spent across analyzed shoppers.`,
  });

  return out;
}

module.exports = {
  getPersonaAnalysis,
  BEHAVIOR_CATEGORIES,
  PERSONAS,
};
