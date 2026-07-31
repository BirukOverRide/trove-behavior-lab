/**
 * Bot DNA — persona templates + per-bot variance so bots are never identical.
 */

const PERSONA_TEMPLATES = {
  window_shopper: {
    label: 'Window Shopper',
    description: 'Browses and searches; rarely carts or buys.',
    defaults: {
      pAddToCart: 0.08,
      pBeginCheckout: 0.02,
      pPurchase: 0.01,
      searchCount: [1, 3],
      productViews: [1, 4],
      dealSeeking: 0.3,
      priceBias: 'any',
      categoryFocus: 0.3,
    },
  },
  product_browser: {
    label: 'Product Researcher',
    description: 'Many product views, careful, low conversion.',
    defaults: {
      pAddToCart: 0.25,
      pBeginCheckout: 0.1,
      pPurchase: 0.08,
      searchCount: [1, 4],
      productViews: [3, 8],
      dealSeeking: 0.35,
      priceBias: 'mid',
      categoryFocus: 0.45,
    },
  },
  bargain_hunter: {
    label: 'Bargain Hunter',
    description: 'Chases deals and lower prices; buys when discounted.',
    defaults: {
      pAddToCart: 0.55,
      pBeginCheckout: 0.4,
      pPurchase: 0.35,
      searchCount: [2, 5],
      productViews: [2, 6],
      dealSeeking: 0.9,
      priceBias: 'low',
      categoryFocus: 0.4,
    },
  },
  cart_builder: {
    label: 'Cart Builder',
    description: 'Adds often; sometimes checks out; mixed purchase rate.',
    defaults: {
      pAddToCart: 0.85,
      pBeginCheckout: 0.35,
      pPurchase: 0.2,
      searchCount: [1, 3],
      productViews: [2, 5],
      dealSeeking: 0.4,
      priceBias: 'any',
      categoryFocus: 0.5,
    },
  },
  cart_abandons: {
    label: 'Cart Abandoner',
    description: 'High cart/checkout intent, almost never completes purchase.',
    defaults: {
      pAddToCart: 0.9,
      pBeginCheckout: 0.7,
      pPurchase: 0.05,
      searchCount: [1, 3],
      productViews: [2, 5],
      dealSeeking: 0.45,
      priceBias: 'mid',
      categoryFocus: 0.5,
    },
  },
  high_intent: {
    label: 'High Intent Buyer',
    description: 'Short path from search/view to purchase.',
    defaults: {
      pAddToCart: 0.85,
      pBeginCheckout: 0.8,
      pPurchase: 0.75,
      searchCount: [0, 2],
      productViews: [1, 3],
      dealSeeking: 0.35,
      priceBias: 'any',
      categoryFocus: 0.55,
    },
  },
  loyal_buyer: {
    label: 'Loyal Buyer',
    description: 'Repeat purchases in preferred categories/brands.',
    defaults: {
      pAddToCart: 0.7,
      pBeginCheckout: 0.65,
      pPurchase: 0.7,
      searchCount: [0, 2],
      productViews: [1, 3],
      dealSeeking: 0.25,
      priceBias: 'mid',
      categoryFocus: 0.85,
    },
  },
  impulse_buyer: {
    label: 'Impulse Buyer',
    description: 'Few views, fast add-to-cart and buy.',
    defaults: {
      pAddToCart: 0.95,
      pBeginCheckout: 0.9,
      pPurchase: 0.85,
      searchCount: [0, 1],
      productViews: [1, 2],
      dealSeeking: 0.4,
      priceBias: 'any',
      categoryFocus: 0.35,
    },
  },
  category_loyal: {
    label: 'Category Loyalist',
    description: 'Stays in 1–2 categories; moderate conversion.',
    defaults: {
      pAddToCart: 0.55,
      pBeginCheckout: 0.4,
      pPurchase: 0.35,
      searchCount: [1, 3],
      productViews: [2, 5],
      dealSeeking: 0.35,
      priceBias: 'mid',
      categoryFocus: 0.95,
    },
  },
  explorer: {
    label: 'Category Explorer',
    description: 'Wide category hopping; lower conversion.',
    defaults: {
      pAddToCart: 0.35,
      pBeginCheckout: 0.15,
      pPurchase: 0.1,
      searchCount: [2, 5],
      productViews: [3, 7],
      dealSeeking: 0.4,
      priceBias: 'any',
      categoryFocus: 0.15,
    },
  },
};

const FIRST = [
  'Mira', 'Jordan', 'Sam', 'Avery', 'Riley', 'Casey', 'Quinn', 'Noah', 'Lena', 'Omar',
  'Priya', 'Diego', 'Hana', 'Eli', 'Zoe', 'Marcus', 'Ivy', 'Kai', 'Nina', 'Theo',
];
const LAST = [
  'Cole', 'Nguyen', 'Patel', 'Brooks', 'Singh', 'Rivera', 'Kim', 'Walsh', 'Okada', 'Diaz',
  'Berg', 'Shah', 'Moss', 'Chen', 'Ali', 'Park', 'Reed', 'Costa', 'Hart', 'Vogel',
];

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function jitter(rand, value, spread = 0.15) {
  const delta = (rand() * 2 - 1) * spread;
  return clamp(value * (1 + delta), 0, 1);
}

function jitterRange(rand, [min, max], diversity = 0.5) {
  const span = max - min;
  const pad = span * 0.25 * diversity;
  let a = min - pad + rand() * (span + 2 * pad);
  let b = min - pad + rand() * (span + 2 * pad);
  a = Math.max(0, Math.round(a));
  b = Math.max(a, Math.round(b));
  return [a, Math.max(a, b)];
}

/**
 * Build unique DNA for a bot from persona + diversity (0–1).
 */
function generateDna({
  persona = 'product_browser',
  diversity = 0.55,
  preferredCategories = null,
  overrides = {},
  seed = null,
} = {}) {
  const template = PERSONA_TEMPLATES[persona] || PERSONA_TEMPLATES.product_browser;
  const s = seed ?? Math.floor(Math.random() * 1e9);
  const rand = mulberry32(s);
  const d = template.defaults;

  const dna = {
    seed: s,
    persona,
    personaLabel: template.label,
    pAddToCart: jitter(rand, d.pAddToCart, 0.12 + diversity * 0.2),
    pBeginCheckout: jitter(rand, d.pBeginCheckout, 0.12 + diversity * 0.2),
    pPurchase: jitter(rand, d.pPurchase, 0.12 + diversity * 0.2),
    searchCount: jitterRange(rand, d.searchCount, diversity),
    productViews: jitterRange(rand, d.productViews, diversity),
    dealSeeking: jitter(rand, d.dealSeeking, 0.2 * diversity + 0.05),
    priceBias: d.priceBias,
    categoryFocus: jitter(rand, d.categoryFocus, 0.15 + diversity * 0.15),
    preferredCategories: preferredCategories || [],
    maxCartItems: 1 + Math.floor(rand() * (2 + diversity * 2)),
    sessionsStyle: rand() > 0.5 ? 'focused' : 'wandering',
    notes: template.description,
  };

  // Occasionally flip price bias for diversity
  if (diversity > 0.4 && rand() < diversity * 0.35) {
    dna.priceBias = pick(rand, ['low', 'mid', 'high', 'any']);
  }

  // Enforce funnel sanity: purchase ≤ checkout ≤ add roughly
  if (dna.pBeginCheckout > dna.pAddToCart + 0.15) {
    dna.pBeginCheckout = dna.pAddToCart * 0.9;
  }
  if (dna.pPurchase > dna.pBeginCheckout + 0.15) {
    dna.pPurchase = dna.pBeginCheckout * 0.95;
  }

  return { ...dna, ...overrides, persona, personaLabel: template.label };
}

function generateBotIdentity(rand = Math.random) {
  const r = typeof rand === 'function' ? rand : () => Math.random();
  const first = pick(r, FIRST);
  const last = pick(r, LAST);
  const n = Math.floor(r() * 9000 + 1000);
  return {
    name: `${first} ${last}`,
    email: `bot.${first.toLowerCase()}.${last.toLowerCase()}.${n}@trove.bots`,
  };
}

function normalizeDna(input = {}) {
  const persona = input.persona || 'product_browser';
  const template = PERSONA_TEMPLATES[persona] || PERSONA_TEMPLATES.product_browser;
  const base = generateDna({ persona, diversity: 0, seed: input.seed || 1 });
  const dna = {
    ...base,
    ...input,
    persona,
    personaLabel: template.label,
    pAddToCart: clamp(Number(input.pAddToCart ?? base.pAddToCart), 0, 1),
    pBeginCheckout: clamp(Number(input.pBeginCheckout ?? base.pBeginCheckout), 0, 1),
    pPurchase: clamp(Number(input.pPurchase ?? base.pPurchase), 0, 1),
    dealSeeking: clamp(Number(input.dealSeeking ?? base.dealSeeking), 0, 1),
    categoryFocus: clamp(Number(input.categoryFocus ?? base.categoryFocus), 0, 1),
    maxCartItems: clamp(parseInt(input.maxCartItems ?? base.maxCartItems, 10) || 2, 1, 8),
    priceBias: ['low', 'mid', 'high', 'any'].includes(input.priceBias)
      ? input.priceBias
      : base.priceBias,
    preferredCategories: Array.isArray(input.preferredCategories)
      ? input.preferredCategories
      : base.preferredCategories,
    searchCount: Array.isArray(input.searchCount)
      ? input.searchCount.map((n) => clamp(parseInt(n, 10) || 0, 0, 12))
      : base.searchCount,
    productViews: Array.isArray(input.productViews)
      ? input.productViews.map((n) => clamp(parseInt(n, 10) || 1, 1, 15))
      : base.productViews,
  };
  if (dna.searchCount[1] < dna.searchCount[0]) {
    dna.searchCount = [dna.searchCount[1], dna.searchCount[0]];
  }
  if (dna.productViews[1] < dna.productViews[0]) {
    dna.productViews = [dna.productViews[1], dna.productViews[0]];
  }
  return dna;
}

function listPersonas() {
  return Object.entries(PERSONA_TEMPLATES).map(([id, t]) => ({
    id,
    label: t.label,
    description: t.description,
    defaults: t.defaults,
  }));
}

module.exports = {
  PERSONA_TEMPLATES,
  generateDna,
  generateBotIdentity,
  normalizeDna,
  listPersonas,
  mulberry32,
  pick,
  clamp,
};
