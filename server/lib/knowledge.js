/**
 * "What the AI knows" — human-readable knowledge extracted from training + behavior data.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { PERSONAS } = require('./behaviorEngine');
const { MODEL_PATH, listRuns, buildTrainingExamples } = require('./mlTrain');
const { STAGE_META } = require('./buyerBehavior');

function pct(n, d) {
  if (!d) return 0;
  return Math.round((1000 * n) / d) / 10;
}

function money(cents) {
  return {
    cents: cents || 0,
    formatted: `$${((cents || 0) / 100).toFixed(2)}`,
  };
}

/** Plain-English “if you see X, think Y” rules from token stats */
function rulesFromTokens(persona, tokens) {
  const rules = [];
  const top = (tokens || []).slice(0, 6);
  if (!top.length) return rules;
  const names = top.map((t) => t.token).join(', ');
  const meta = PERSONAS[persona] || { label: persona };
  rules.push(
    `When a journey is heavy on [${names}], it often labels the shopper as ${meta.label}.`
  );
  const hasPurchase = top.some((t) => /purchase|buy|order|checkout/i.test(t.token));
  const hasCart = top.some((t) => /cart|add/i.test(t.token));
  const hasSearch = top.some((t) => /search|cat|filter/i.test(t.token));
  if (hasPurchase) {
    rules.push('Purchase / order tokens pull toward buyer-type personas.');
  }
  if (hasCart && !hasPurchase) {
    rules.push('Cart activity without purchase pulls toward cart-builder or abandoner.');
  }
  if (hasSearch) {
    rules.push('Search / category tokens signal discovery (browser / explorer / bargain).');
  }
  return rules;
}

function plainSkill(acc) {
  if (acc == null) return 'Unknown';
  if (acc >= 0.75) return 'Strong';
  if (acc >= 0.5) return 'OK';
  if (acc >= 0.3) return 'Weak';
  return 'Poor';
}

function getWhatItKnows() {
  const runs = listRuns(5);
  const last = runs.find((r) => r.status === 'completed') || null;
  const examples = buildTrainingExamples();
  const labelDist = {};
  for (const e of examples) {
    labelDist[e.label] = (labelDist[e.label] || 0) + 1;
  }

  const modelExists = fs.existsSync(MODEL_PATH);
  let modelMeta = null;
  try {
    const base = MODEL_PATH.replace(/\.npz$/, '');
    modelMeta = JSON.parse(fs.readFileSync(`${base}.meta.json`, 'utf8'));
  } catch {
    modelMeta = null;
  }

  const tokenStats = last?.tokenStats || {};
  const journeys = last?.exampleJourneys || {};
  const perClass = last?.perClassMetrics || {};
  const baseline = last?.baselinePerClass || {};
  const evolution = last?.evolution || null;
  const mistakes = last?.mistakes || [];
  const confusion = last?.confusion || null;
  const confusionLabels = last?.confusionLabels || [];

  // Persona knowledge cards
  const personas = Object.keys(PERSONAS).map((id) => {
    const meta = PERSONAS[id];
    const n = labelDist[id] || 0;
    const m = perClass[id] || null;
    const b = baseline[id] || null;
    const toks = tokenStats[id] || [];
    const skill = m ? plainSkill(m.accuracy) : n ? 'Not measured yet' : 'No examples';
    const facts = [];
    if (n) facts.push(`Saw ${n} journey${n === 1 ? '' : 's'} of this type while training.`);
    if (m) {
      facts.push(
        `Gets this type right about ${Math.round((m.accuracy || 0) * 100)}% of the time (skill: ${skill}).`
      );
      if (m.f1 != null) {
        facts.push(`Balance of precision/recall (F1): ${Math.round(m.f1 * 100)}%.`);
      }
      if (b && b.accuracy != null) {
        const gain = (m.accuracy || 0) - (b.accuracy || 0);
        facts.push(
          gain >= 0
            ? `Improved ${Math.round(gain * 100)} pts vs cold start on this type.`
            : `Did not improve on this type vs cold start (${Math.round(gain * 100)} pts).`
        );
      }
    } else if (!n) {
      facts.push('Almost no examples — the model barely knows this type yet.');
    }
    return {
      id,
      label: meta.label,
      blurb: meta.blurb,
      examples: n,
      skill,
      accuracy: m?.accuracy ?? null,
      f1: m?.f1 ?? null,
      support: m?.support ?? n,
      topTokens: toks.slice(0, 8).map((t) => ({
        token: t.token,
        count: t.count,
        share: t.share,
      })),
      exampleJourneys: (journeys[id] || []).slice(0, 2),
      rules: rulesFromTokens(id, toks),
      facts,
    };
  });

  const known = personas.filter((p) => p.examples > 0).sort((a, b) => b.examples - a.examples);
  const unknown = personas.filter((p) => p.examples === 0);

  // Buying knowledge from live DB
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
  const aov = db.prepare(`SELECT AVG(total_cents) AS a FROM orders`).get()?.a || 0;
  const orders = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS r FROM orders`).get();

  const buyingFacts = [
    {
      title: 'View → cart',
      value: `${pct(funnel.carts, funnel.views)}%`,
      plain: `About ${pct(funnel.carts, funnel.views)}% of product views turn into a cart add.`,
    },
    {
      title: 'Cart → checkout',
      value: `${pct(funnel.checkouts, funnel.carts)}%`,
      plain: `About ${pct(funnel.checkouts, funnel.carts)}% of carts start checkout.`,
    },
    {
      title: 'Checkout → buy',
      value: `${pct(funnel.purchases, funnel.checkouts)}%`,
      plain: `About ${pct(funnel.purchases, funnel.checkouts)}% of checkouts finish as a purchase.`,
    },
    {
      title: 'View → buy overall',
      value: `${pct(funnel.purchases, funnel.views)}%`,
      plain: `Overall, ${pct(funnel.purchases, funnel.views)}% of product views become a purchase.`,
    },
    {
      title: 'Average order',
      value: money(Math.round(aov)).formatted,
      plain: `When someone buys, the typical order is about ${money(Math.round(aov)).formatted}.`,
    },
    {
      title: 'Orders seen',
      value: String(orders.c || 0),
      plain: `The system has recorded ${orders.c || 0} orders totaling ${money(orders.r || 0).formatted}.`,
    },
  ];

  // Stage priors used in predictions
  const stageKnowledge = Object.entries(STAGE_META).map(([id, meta]) => ({
    id,
    label: meta.label,
    meaning: meta.meaning,
  }));

  // Confusions in plain language
  const confusions = [];
  if (confusion && confusionLabels?.length) {
    for (let i = 0; i < confusionLabels.length; i++) {
      for (let j = 0; j < confusionLabels.length; j++) {
        if (i === j) continue;
        const n = confusion[i]?.[j] || 0;
        if (n >= 2) {
          confusions.push({
            trueLabel: confusionLabels[i],
            predicted: confusionLabels[j],
            count: n,
            plain: `Sometimes mistakes a true ${confusionLabels[i].replace(/_/g, ' ')} for ${confusionLabels[j].replace(/_/g, ' ')} (${n} times).`,
          });
        }
      }
    }
    confusions.sort((a, b) => b.count - a.count);
  }

  // Top-level "I know that…" sentences
  const iKnow = [];
  if (modelExists && last) {
    iKnow.push(
      `I can classify shopper journeys into personas with about ${Math.round((last.trainAcc || 0) * 100)}% accuracy on the ${last.samples || examples.length} journeys I trained on.`
    );
  } else if (modelExists) {
    iKnow.push('I have a model file loaded, but no completed training metrics are stored yet.');
  } else {
    iKnow.push('I do not have a trained model file yet — only rule-based scores.');
  }

  if (known[0]) {
    iKnow.push(
      `I have the most experience with ${known[0].label} (${known[0].examples} examples).`
    );
  }
  const strong = known.filter((p) => p.accuracy != null && p.accuracy >= 0.55);
  const weak = known.filter((p) => p.accuracy != null && p.accuracy < 0.35);
  if (strong.length) {
    iKnow.push(
      `I am relatively good at: ${strong.map((p) => p.label).join(', ')}.`
    );
  }
  if (weak.length) {
    iKnow.push(
      `I am still weak at: ${weak.map((p) => p.label).join(', ')}.`
    );
  }
  if (unknown.length) {
    iKnow.push(
      `I barely know: ${unknown.map((p) => p.label).join(', ')} (no training examples).`
    );
  }
  iKnow.push(
    `From store data I know the funnel: view→cart ${pct(funnel.carts, funnel.views)}%, cart→checkout ${pct(funnel.checkouts, funnel.carts)}%, checkout→buy ${pct(funnel.purchases, funnel.checkouts)}%.`
  );
  iKnow.push(
    `I use that funnel + buyer stage to predict who will buy soon and who will abandon (Future predictions).`
  );
  if (confusions[0]) {
    iKnow.push(confusions[0].plain);
  }
  if (evolution?.restored_best) {
    iKnow.push(
      `When I study, I keep my best round (best epoch ${evolution.best_epoch}) so later training slips do not wipe what I learned.`
    );
  }

  // Mistake themes
  const mistakeThemes = [];
  const pairCount = {};
  for (const m of mistakes) {
    const k = `${m.true}→${m.pred}`;
    pairCount[k] = (pairCount[k] || 0) + 1;
  }
  Object.entries(pairCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .forEach(([k, n]) => {
      const [t, p] = k.split('→');
      mistakeThemes.push({
        true: t,
        pred: p,
        count: n,
        plain: `Still confuses ${t.replace(/_/g, ' ')} with ${p.replace(/_/g, ' ')} (${n} example${n > 1 ? 's' : ''} in the last eval).`,
      });
    });

  return {
    generatedAt: new Date().toISOString(),
    headline: modelExists
      ? `What Trove AI knows right now (${Math.round((last?.trainAcc || 0) * 100)}% on last train)`
      : 'What Trove AI knows right now (model not trained)',
    iKnow,
    model: {
      exists: modelExists,
      name: modelMeta?.kind || 'TinyVisitorTransformer',
      labels: modelMeta?.labels || Object.keys(PERSONAS),
      vocabSize: modelMeta?.vocab ? Object.keys(modelMeta.vocab).length : null,
      lastTrainAcc: last?.trainAcc ?? null,
      lastSamples: last?.samples ?? examples.length,
      lastTrainAt: last?.createdAt ?? null,
      bestEpoch: evolution?.best_epoch ?? null,
    },
    personas: known,
    emptyPersonas: unknown,
    buying: buyingFacts,
    stages: stageKnowledge,
    confusions: confusions.slice(0, 10),
    mistakeThemes,
    howToRead: [
      '“I know that…” = the short list of real knowledge.',
      'Each persona card = what paths look like that type, and how good the AI is at it.',
      'Buying facts = store-wide conversion numbers used for forecasts.',
      'Confusions = where the AI still mixes people up.',
    ],
  };
}

module.exports = { getWhatItKnows };
