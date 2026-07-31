/**
 * Runs bot shopping sessions against real DB: login identity, search, view, cart, purchase.
 */
const { v4: uuid } = require('uuid');
const { db, mapProduct, money } = require('../db');
const { getOrCreateCart, getCartDetail } = require('./cart');
const { mulberry32, clamp } = require('./botDna');
const { processEventRealtime } = require('./realtimeAi');
const { publish } = require('./liveBus');

function insertEvent({ userId, sessionId, type, target, productId, path, payload }) {
  const info = db
    .prepare(
      `INSERT INTO behavior_events (user_id, session_id, type, target, product_id, path, payload, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      sessionId,
      type,
      target || null,
      productId || null,
      path || null,
      JSON.stringify({ ...(payload || {}), source: 'bot' }),
      '127.0.0.1'
    );
  try {
    processEventRealtime({
      id: info.lastInsertRowid,
      user_id: userId,
      session_id: sessionId,
      type,
      target,
      product_id: productId,
      path,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('bot realtime:', err.message);
  }
}

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function chance(rand, p) {
  return rand() < p;
}

function loadCatalog() {
  return db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.stock > 0`
    )
    .all()
    .map(mapProduct);
}

function scoreProduct(product, dna, rand) {
  let score = rand() * 0.3;
  const cats = dna.preferredCategories || [];
  if (cats.length && cats.includes(product.categorySlug)) {
    score += dna.categoryFocus;
  } else if (cats.length) {
    score -= dna.categoryFocus * 0.4;
  }
  if (dna.dealSeeking > 0.5 && product.discountPercent > 0) {
    score += dna.dealSeeking * (product.discountPercent / 100);
  }
  const price = product.price.cents;
  if (dna.priceBias === 'low') score += price < 5000 ? 0.35 : -0.15;
  if (dna.priceBias === 'mid') score += price >= 3000 && price <= 15000 ? 0.3 : -0.05;
  if (dna.priceBias === 'high') score += price > 12000 ? 0.35 : -0.1;
  return score;
}

function pickProducts(catalog, dna, rand, n) {
  const ranked = catalog
    .map((p) => ({ p, s: scoreProduct(p, dna, rand) }))
    .sort((a, b) => b.s - a.s);
  // Mix top-ranked with some noise so bots diverge
  const picks = [];
  const pool = ranked.slice(0, Math.min(20, ranked.length));
  while (picks.length < n && pool.length) {
    const idx = Math.floor(rand() * Math.min(8, pool.length));
    const [item] = pool.splice(idx, 1);
    if (!picks.find((x) => x.id === item.p.id)) picks.push(item.p);
  }
  return picks;
}

function searchTermsFor(dna, catalog, rand) {
  const terms = new Set();
  const preferred = dna.preferredCategories || [];
  for (const c of preferred) terms.add(c.replace(/-/g, ' '));
  // product word fragments
  for (let i = 0; i < 6; i++) {
    const p = catalog[Math.floor(rand() * catalog.length)];
    if (!p) break;
    const word = p.title.split(/\s+/)[0];
    if (word && word.length > 2) terms.add(word.toLowerCase());
    if (p.brand) terms.add(p.brand.toLowerCase());
  }
  if (dna.dealSeeking > 0.6) {
    terms.add('deal');
    terms.add('sale');
  }
  return [...terms];
}

function placeBotOrder(userId, sessionId, shippingName) {
  const cart = getOrCreateCart({ userId, sessionId });
  const detail = getCartDetail(cart.id);
  if (!detail.items.length) return null;

  const subtotal = detail.subtotal.cents;
  const shipping = subtotal >= 3500 ? 0 : 599;
  const tax = Math.round(subtotal * 0.08);
  const total = subtotal + shipping + tax;
  const orderId = 'ord_' + uuid().replace(/-/g, '').slice(0, 16);

  const place = db.transaction(() => {
    for (const item of detail.items) {
      const stock = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.productId);
      if (!stock || stock.stock < item.qty) {
        throw new Error(`Insufficient stock for ${item.product.title}`);
      }
    }
    db.prepare(
      `INSERT INTO orders (
        id, user_id, status, subtotal_cents, shipping_cents, tax_cents, total_cents,
        ship_name, ship_line1, ship_city, ship_state, ship_postal, ship_country, payment_method
      ) VALUES (?, ?, 'placed', ?, ?, ?, ?, ?, '1 Bot Way', 'Seattle', 'WA', '98101', 'US', 'bot_sim')`
    ).run(orderId, userId, subtotal, shipping, tax, total, shippingName || 'Bot Shopper');

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, title, brand, image_url, unit_price_cents, qty, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const item of detail.items) {
      insertItem.run(
        uuid(),
        orderId,
        item.productId,
        item.product.title,
        item.product.brand,
        item.product.images[0],
        item.product.price.cents,
        item.qty,
        item.lineTotal.cents
      );
      dec.run(item.qty, item.productId);
    }
    db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  });

  place();

  insertEvent({
    userId,
    sessionId,
    type: 'purchase',
    target: orderId,
    path: '/checkout',
    payload: {
      orderId,
      total_cents: total,
      productIds: detail.items.map((i) => i.productId),
      source: 'bot',
    },
  });

  return { orderId, total: money(total), itemCount: detail.itemCount };
}

/**
 * Run one shopping session for a bot.
 */
function runBotSession(bot, dna) {
  const rand = mulberry32((dna.seed || 1) + (bot.sessions_run || 0) * 9973 + Date.now() % 10000);
  const userId = bot.user_id;
  const sessionId = 's_bot_' + bot.id.slice(0, 8) + '_' + Date.now().toString(36);
  const catalog = loadCatalog();
  if (!catalog.length) {
    return { ok: false, error: 'No in-stock products', events: 0 };
  }

  const log = [];
  const track = (type, target, extra = {}) => {
    insertEvent({
      userId,
      sessionId,
      type,
      target,
      productId: extra.productId || null,
      path: extra.path || '/',
      payload: extra,
    });
    log.push(type);
  };

  // Login signal
  track('login', 'auth', { path: '/login', botId: bot.id });
  track('page_view', '/', { path: '/' });

  // Searches
  const terms = searchTermsFor(dna, catalog, rand);
  const nSearch = randInt(rand, dna.searchCount[0], dna.searchCount[1]);
  for (let i = 0; i < nSearch; i++) {
    const q = terms[Math.floor(rand() * terms.length)] || 'shop';
    track('search', q, { query: q, path: '/s' });
    if (dna.preferredCategories?.length && chance(rand, dna.categoryFocus)) {
      const cat = dna.preferredCategories[Math.floor(rand() * dna.preferredCategories.length)];
      track('filter_category', cat, { category: cat, path: '/s' });
    }
  }

  // Product views
  const nViews = randInt(rand, dna.productViews[0], dna.productViews[1]);
  const viewed = pickProducts(catalog, dna, rand, nViews);
  const cart = getOrCreateCart({ userId, sessionId });
  let added = 0;

  for (const product of viewed) {
    track('view_product', product.id, {
      productId: product.id,
      path: `/product/${product.id}`,
      category: product.categorySlug,
      price: product.price.cents,
      brand: product.brand,
    });

    const wantCart =
      chance(rand, dna.pAddToCart) && added < (dna.maxCartItems || 2);
    if (wantCart) {
      db.prepare(
        `INSERT INTO cart_items (id, cart_id, product_id, qty) VALUES (?, ?, ?, 1)
         ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = MIN(99, qty + 1)`
      ).run(uuid(), cart.id, product.id);
      track('add_to_cart', product.id, {
        productId: product.id,
        qty: 1,
        path: `/product/${product.id}`,
      });
      added += 1;
    }
  }

  let order = null;
  const detail = getCartDetail(cart.id);
  if (detail.items.length && chance(rand, dna.pBeginCheckout)) {
    track('begin_checkout', 'checkout', {
      path: '/checkout',
      itemCount: detail.itemCount,
      subtotal: detail.subtotal.cents,
      productIds: detail.items.map((i) => i.productId),
    });

    if (chance(rand, dna.pPurchase)) {
      try {
        order = placeBotOrder(userId, sessionId, bot.display_name);
        log.push('purchase');
      } catch (err) {
        track('page_view', '/checkout', { path: '/checkout', error: err.message });
      }
    }
  }

  return {
    ok: true,
    sessionId,
    events: log.length,
    actions: log,
    addedToCart: added,
    purchased: !!order,
    order,
  };
}

/**
 * Run multiple sessions for a bot; update counters.
 * options.shouldAbort() — if true between sessions, stop early (stop button).
 */
function runBotSessions(botRow, dna, sessions = 1, options = {}) {
  const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : () => false;
  const results = [];
  const n = clamp(parseInt(sessions, 10) || 1, 1, 20);
  let aborted = false;
  publish('bot_run', {
    botId: botRow.id,
    name: botRow.display_name,
    status: 'starting',
    sessions: n,
  });
  for (let i = 0; i < n; i++) {
    if (shouldAbort()) {
      aborted = true;
      break;
    }
    db.prepare(
      `UPDATE bots SET status = 'running', updated_at = datetime('now') WHERE id = ?`
    ).run(botRow.id);
    publish('bot_run', {
      botId: botRow.id,
      name: botRow.display_name,
      status: 'running',
      sessionIndex: i + 1,
      sessions: n,
    });
    if (shouldAbort()) {
      aborted = true;
      db.prepare(
        `UPDATE bots SET status = 'idle', updated_at = datetime('now') WHERE id = ?`
      ).run(botRow.id);
      break;
    }
    const result = runBotSession(botRow, dna);
    results.push(result);
    db.prepare(
      `UPDATE bots SET
         sessions_run = sessions_run + 1,
         last_run_at = datetime('now'),
         status = 'idle',
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(botRow.id);
    botRow.sessions_run = (botRow.sessions_run || 0) + 1;
    publish('bot_run', {
      botId: botRow.id,
      name: botRow.display_name,
      status: 'session_done',
      sessionIndex: i + 1,
      sessions: n,
      result: {
        events: result.events,
        purchased: result.purchased,
        actions: result.actions,
      },
    });
  }
  db.prepare(
    `UPDATE bots SET status = 'idle', updated_at = datetime('now') WHERE id = ?`
  ).run(botRow.id);
  publish('bot_run', {
    botId: botRow.id,
    name: botRow.display_name,
    status: aborted ? 'stopped' : 'idle',
    sessionsRun: botRow.sessions_run,
    aborted,
  });
  return results;
}

module.exports = { runBotSession, runBotSessions, loadCatalog };
