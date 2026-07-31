/**
 * Load secrets into process.env (no dotenv package).
 *   - server/.env  (XAI_API_KEY=..., GEMINI_API_KEY=..., CHAT_PROVIDER=...)
 *   - server/XAI_API_KEY.txt / GEMINI_API_KEY.txt (one line raw key, visible)
 */
(function loadEnvFile() {
  const fs = require('fs');
  const path = require('path');

  function applyEnvText(raw) {
    for (const line of String(raw).split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!key) continue;
      const prev = process.env[key];
      const prevIsPlaceholder =
        !prev ||
        /paste-your-key|your-key-here|changeme|PASTE|REPLACE/i.test(prev) ||
        prev.length < 16;
      if (prev === undefined || prevIsPlaceholder) process.env[key] = val;
    }
  }

  function loadKeyFile(filename, envName) {
    try {
      const keyFile = path.join(__dirname, filename);
      if (!fs.existsSync(keyFile)) return;
      let k = fs.readFileSync(keyFile, 'utf8').trim();
      if (!k) return;
      if (k.includes('=')) k = k.split('=').slice(1).join('=').trim();
      k = k.replace(/^["']|["']$/g, '').trim();
      if (!k || /paste|replace|EVERYTHING|changeme/i.test(k)) return;
      const prev = process.env[envName] || '';
      const prevBad =
        !prev ||
        /paste|replace|changeme/i.test(prev) ||
        prev.length < 16;
      if (prevBad) process.env[envName] = k;
    } catch {
      /* ignore */
    }
  }

  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) applyEnvText(fs.readFileSync(envPath, 'utf8'));
  } catch {
    /* ignore */
  }

  loadKeyFile('XAI_API_KEY.txt', 'XAI_API_KEY');
  loadKeyFile('GEMINI_API_KEY.txt', 'GEMINI_API_KEY');
  // alias
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
  }
})();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { db, mapProduct, money } = require('./db');
const {
  signToken,
  authOptional,
  authRequired,
  adminRequired,
} = require('./middleware/auth');
const {
  getOrCreateCart,
  mergeSessionCartIntoUser,
  getCartDetail,
} = require('./lib/cart');
const {
  listProfiles,
  getProfile,
  rebuildAllProfiles,
  overviewStats,
  eventToken,
} = require('./lib/behaviorEngine');
const { migrate } = require('./lib/migrate');
const bots = require('./lib/bots');
const mlTrain = require('./lib/mlTrain');
const { analyzeBotBuying, analyzeAllBotsBuying } = require('./lib/buyAnalysis');
const { processEventRealtime, getLiveSnapshot, getInferenceCache } = require('./lib/realtimeAi');
const liveBus = require('./lib/liveBus');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');
const featureMine = require('./lib/featureMine');
const { getRealtimeAnalysis } = require('./lib/marketPulse');
const personaAnalysis = require('./lib/personaAnalysis');
const buyerBehavior = require('./lib/buyerBehavior');
const futurePredict = require('./lib/futurePredict');
const knowledge = require('./lib/knowledge');
const troveChat = require('./lib/troveChat');

// Ensure seed + schema migrations
require('./db/seed');
migrate();

// Continuous self-training loop (AI trains on new data automatically)
mlTrain.startAutoTrainLoop();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(authOptional);

function insertBehaviorEvent({
  userId,
  sessionId: sid,
  type,
  target,
  productId,
  path,
  payload,
  ip,
}) {
  const info = db
    .prepare(
      `INSERT INTO behavior_events (user_id, session_id, type, target, product_id, path, payload, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId || null,
      sid || null,
      type || 'event',
      target || null,
      productId || null,
      path || null,
      typeof payload === 'string' ? payload : JSON.stringify(payload || {}),
      ip || null
    );

  const row = {
    id: info.lastInsertRowid,
    user_id: userId || null,
    session_id: sid || null,
    type: type || 'event',
    target: target || null,
    product_id: productId || null,
    path: path || null,
    created_at: new Date().toISOString(),
  };
  // Real-time AI: rebuild profile, classify, push to admin SSE
  try {
    processEventRealtime(row);
  } catch (err) {
    console.error('realtime AI:', err.message);
  }
  return row;
}

function sessionId(req) {
  return (
    req.headers['x-session-id'] ||
    req.body?.sessionId ||
    req.query.sessionId ||
    null
  );
}

function cartOwner(req) {
  return {
    userId: req.user?.sub || null,
    sessionId: sessionId(req),
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  const products = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  res.json({ ok: true, service: 'trove-shop', products, db: 'sqlite' });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'name, email, and password required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)'
  ).run(id, String(email).toLowerCase(), hash, String(name).trim());

  const user = {
    id,
    email: String(email).toLowerCase(),
    name: String(name).trim(),
    isAdmin: false,
  };
  const sid = sessionId(req);

  // Cart merge + tracking must never block account creation
  try {
    if (sid) mergeSessionCartIntoUser(sid, id);
  } catch (err) {
    console.error('register cart merge:', err.message);
  }
  try {
    insertBehaviorEvent({
      userId: id,
      sessionId: sid,
      type: 'register',
      target: 'auth',
      path: '/login',
      payload: { email: user.email },
      ip: req.ip,
    });
  } catch (err) {
    console.error('register track:', err.message);
  }

  res.status(201).json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, isAdmin: false },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const row = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(String(email || '').toLowerCase());
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: !!row.is_admin,
  };
  const sid = sessionId(req);

  try {
    if (sid) mergeSessionCartIntoUser(sid, user.id);
  } catch (err) {
    console.error('login cart merge:', err.message);
  }
  try {
    insertBehaviorEvent({
      userId: user.id,
      sessionId: sid,
      type: 'login',
      target: 'auth',
      path: '/login',
      payload: { email: user.email, isAdmin: user.isAdmin },
      ip: req.ip,
    });
  } catch (err) {
    console.error('login track:', err.message);
  }

  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
    },
  });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const row = db
    .prepare('SELECT id, email, name, created_at, is_admin FROM users WHERE id = ?')
    .get(req.user.sub);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      isAdmin: !!row.is_admin,
    },
  });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
app.get('/api/categories', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY sort_order, name`
    )
    .all();
  res.json({
    categories: rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parent_id,
      productCount: c.product_count,
    })),
  });
});

app.get('/api/products', (req, res) => {
  const {
    q,
    category,
    brand,
    minPrice,
    maxPrice,
    prime,
    sort = 'featured',
    page = '1',
    limit = '24',
  } = req.query;

  const where = [];
  const params = {};

  if (q) {
    where.push(`(p.title LIKE @q OR p.brand LIKE @q OR p.description LIKE @q)`);
    params.q = `%${q}%`;
  }
  if (category) {
    where.push(`(c.slug = @category OR c.id = @category)`);
    params.category = category;
  }
  if (brand) {
    where.push(`p.brand = @brand`);
    params.brand = brand;
  }
  if (minPrice) {
    where.push(`p.price_cents >= @minPrice`);
    params.minPrice = Math.round(Number(minPrice) * 100);
  }
  if (maxPrice) {
    where.push(`p.price_cents <= @maxPrice`);
    params.maxPrice = Math.round(Number(maxPrice) * 100);
  }
  if (prime === '1' || prime === 'true') {
    where.push(`p.is_prime = 1`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  let orderBy = 'p.rating_count DESC, p.rating_avg DESC';
  if (sort === 'price_asc') orderBy = 'p.price_cents ASC';
  if (sort === 'price_desc') orderBy = 'p.price_cents DESC';
  if (sort === 'rating') orderBy = 'p.rating_avg DESC, p.rating_count DESC';
  if (sort === 'newest') orderBy = 'p.created_at DESC';
  if (sort === 'bestseller') orderBy = 'p.is_bestseller DESC, p.rating_count DESC';

  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const limitN = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
  const offset = (pageN - 1) * limitN;

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products p JOIN categories c ON c.id = p.category_id ${whereSql}`
    )
    .get(params).c;

  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ${limitN} OFFSET ${offset}`
    )
    .all(params);

  const brands = db
    .prepare(
      `SELECT DISTINCT p.brand FROM products p
       JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ORDER BY p.brand`
    )
    .all(params)
    .map((r) => r.brand);

  res.json({
    products: rows.map(mapProduct),
    page: pageN,
    limit: limitN,
    total,
    totalPages: Math.ceil(total / limitN) || 1,
    brands,
  });
});

app.get('/api/products/:id', (req, res) => {
  const row = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? OR p.sku = ?`
    )
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found' });

  const product = mapProduct(row);
  const reviews = db
    .prepare(
      `SELECT r.*, u.name AS user_name FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ?
       ORDER BY r.helpful DESC, r.created_at DESC
       LIMIT 50`
    )
    .all(product.id)
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      verified: !!r.verified,
      helpful: r.helpful,
      userName: r.user_name,
      createdAt: r.created_at,
    }));

  const related = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.category_id = ? AND p.id != ?
       ORDER BY p.rating_count DESC LIMIT 8`
    )
    .all(row.category_id, product.id)
    .map(mapProduct);

  res.json({ product, reviews, related });
});

app.get('/api/deals', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.list_price_cents IS NOT NULL AND p.list_price_cents > p.price_cents
       ORDER BY (1.0 * (p.list_price_cents - p.price_cents) / p.list_price_cents) DESC
       LIMIT 12`
    )
    .all();
  res.json({ products: rows.map(mapProduct) });
});

// ---------------------------------------------------------------------------
// Mined AI features — consumer score + personalization (shop + API)
// ---------------------------------------------------------------------------
app.get('/api/ai/me', (req, res) => {
  try {
    const result = featureMine.getConsumerFeatures({
      userId: req.user?.sub || null,
      sessionId: sessionId(req),
    });
    res.json(result);
  } catch (err) {
    console.error('ai/me:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/consumer/:userId', adminRequired, (req, res) => {
  try {
    res.json(featureMine.getConsumerFeatures({ userId: req.params.userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/personalize', (req, res) => {
  try {
    const result = featureMine.getConsumerFeatures({
      userId: req.user?.sub || null,
      sessionId: sessionId(req),
    });
    res.json({
      ok: true,
      headline: result.personalization?.headline,
      urgency: result.personalization?.urgency,
      stage: result.features?.buyer_stage,
      persona: result.personaLabel || result.persona,
      forYou: result.personalization?.forYou || [],
      dealsForYou: result.personalization?.dealsForYou || [],
      showDealRail: result.personalization?.showDealRail,
      features: result.features,
      insights: (result.insights || []).slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bestsellers', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.is_bestseller = 1
       ORDER BY p.rating_count DESC LIMIT 12`
    )
    .all();
  res.json({ products: rows.map(mapProduct) });
});

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
app.get('/api/cart', (req, res) => {
  const owner = cartOwner(req);
  if (!owner.userId && !owner.sessionId) {
    return res.json({ items: [], itemCount: 0, subtotal: money(0) });
  }
  const cart = getOrCreateCart(owner);
  res.json(getCartDetail(cart.id));
});

app.post('/api/cart/items', (req, res) => {
  const { productId, qty = 1 } = req.body || {};
  const owner = cartOwner(req);
  if (!owner.userId && !owner.sessionId) {
    return res.status(400).json({ error: 'sessionId header required for guests' });
  }
  const product = db.prepare('SELECT id, stock FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock < 1) return res.status(400).json({ error: 'Out of stock' });

  const cart = getOrCreateCart(owner);
  const addQty = Math.max(1, Math.min(99, Number(qty) || 1));

  db.prepare(
    `INSERT INTO cart_items (id, cart_id, product_id, qty) VALUES (?, ?, ?, ?)
     ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = MIN(99, qty + excluded.qty)`
  ).run(uuid(), cart.id, productId, addQty);

  db.prepare(`UPDATE carts SET updated_at = datetime('now') WHERE id = ?`).run(cart.id);
  res.status(201).json(getCartDetail(cart.id));
});

app.patch('/api/cart/items/:productId', (req, res) => {
  const owner = cartOwner(req);
  const cart = getOrCreateCart(owner);
  if (!cart) return res.status(400).json({ error: 'No cart' });

  const qty = Math.max(0, Math.min(99, Number(req.body?.qty) || 0));
  if (qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(
      cart.id,
      req.params.productId
    );
  } else {
    db.prepare(
      'UPDATE cart_items SET qty = ? WHERE cart_id = ? AND product_id = ?'
    ).run(qty, cart.id, req.params.productId);
  }
  res.json(getCartDetail(cart.id));
});

app.delete('/api/cart/items/:productId', (req, res) => {
  const owner = cartOwner(req);
  const cart = getOrCreateCart(owner);
  if (!cart) return res.status(400).json({ error: 'No cart' });
  db.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').run(
    cart.id,
    req.params.productId
  );
  res.json(getCartDetail(cart.id));
});

// ---------------------------------------------------------------------------
// Addresses & Orders
// ---------------------------------------------------------------------------
app.get('/api/addresses', authRequired, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at')
    .all(req.user.sub);
  res.json({
    addresses: rows.map((a) => ({
      id: a.id,
      label: a.label,
      fullName: a.full_name,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      postalCode: a.postal_code,
      country: a.country,
      phone: a.phone,
      isDefault: !!a.is_default,
    })),
  });
});

app.post('/api/addresses', authRequired, (req, res) => {
  const b = req.body || {};
  if (!b.fullName || !b.line1 || !b.city || !b.state || !b.postalCode) {
    return res.status(400).json({ error: 'Missing address fields' });
  }
  const id = uuid();
  if (b.isDefault) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.sub);
  }
  db.prepare(
    `INSERT INTO addresses (id, user_id, label, full_name, line1, line2, city, state, postal_code, country, phone, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.sub,
    b.label || 'Home',
    b.fullName,
    b.line1,
    b.line2 || null,
    b.city,
    b.state,
    b.postalCode,
    b.country || 'US',
    b.phone || null,
    b.isDefault ? 1 : 0
  );
  res.status(201).json({ id });
});

app.post('/api/orders', authRequired, (req, res) => {
  const owner = { userId: req.user.sub, sessionId: sessionId(req) };
  const cart = getOrCreateCart(owner);
  const detail = getCartDetail(cart.id);
  if (!detail.items.length) return res.status(400).json({ error: 'Cart is empty' });

  const ship = req.body?.shipping || {};
  if (!ship.fullName || !ship.line1 || !ship.city || !ship.state || !ship.postalCode) {
    return res.status(400).json({ error: 'Complete shipping address required' });
  }

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
        ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country, ship_phone,
        payment_method
      ) VALUES (?, ?, 'placed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      req.user.sub,
      subtotal,
      shipping,
      tax,
      total,
      ship.fullName,
      ship.line1,
      ship.line2 || null,
      ship.city,
      ship.state,
      ship.postalCode,
      ship.country || 'US',
      ship.phone || null,
      req.body?.paymentMethod || 'card_demo'
    );

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, title, brand, image_url, unit_price_cents, qty, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

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
      decStock.run(item.qty, item.productId);
    }

    db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
  });

  try {
    place();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  insertBehaviorEvent({
    userId: req.user.sub,
    sessionId: sessionId(req),
    type: 'purchase',
    target: orderId,
    path: '/checkout',
    payload: {
      orderId,
      total_cents: total,
      productIds: detail.items.map((i) => i.productId),
    },
    ip: req.ip,
  });

  const order = getOrder(orderId, req.user.sub);
  res.status(201).json({ order });
});

function getOrder(orderId, userId) {
  const o = db
    .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
    .get(orderId, userId);
  if (!o) return null;
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .all(orderId)
    .map((i) => ({
      productId: i.product_id,
      title: i.title,
      brand: i.brand,
      imageUrl: i.image_url,
      unitPrice: money(i.unit_price_cents),
      qty: i.qty,
      lineTotal: money(i.line_total_cents),
    }));
  return {
    id: o.id,
    status: o.status,
    subtotal: money(o.subtotal_cents),
    shipping: money(o.shipping_cents),
    tax: money(o.tax_cents),
    total: money(o.total_cents),
    shippingAddress: {
      fullName: o.ship_name,
      line1: o.ship_line1,
      line2: o.ship_line2,
      city: o.ship_city,
      state: o.ship_state,
      postalCode: o.ship_postal,
      country: o.ship_country,
      phone: o.ship_phone,
    },
    paymentMethod: o.payment_method,
    placedAt: o.placed_at,
    items,
  };
}

app.get('/api/orders', authRequired, (req, res) => {
  const rows = db
    .prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT 50')
    .all(req.user.sub);
  res.json({ orders: rows.map((r) => getOrder(r.id, req.user.sub)) });
});

app.get('/api/orders/:id', authRequired, (req, res) => {
  const order = getOrder(req.params.id, req.user.sub);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------
app.post('/api/products/:id/reviews', authRequired, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { rating, title, body } = req.body || {};
  const r = Number(rating);
  if (!r || r < 1 || r > 5 || !title || !body) {
    return res.status(400).json({ error: 'rating (1-5), title, and body required' });
  }

  try {
    db.prepare(
      `INSERT INTO reviews (id, product_id, user_id, rating, title, body, verified)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(uuid(), product.id, req.user.sub, r, title, body);
  } catch {
    return res.status(409).json({ error: 'You already reviewed this product' });
  }

  const stats = db
    .prepare(
      'SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE product_id = ?'
    )
    .get(product.id);
  db.prepare(
    'UPDATE products SET rating_avg = ?, rating_count = ? WHERE id = ?'
  ).run(Number(stats.avg.toFixed(2)), stats.c, product.id);

  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Behavior events → SQLite + live consumer profiles
// ---------------------------------------------------------------------------
app.post('/log_event', (req, res) => {
  const data = req.body || {};
  // Prefer authenticated user id over client-supplied tracker id
  const uid = req.user?.sub || data.userId || null;
  const sid = data.sessionId || sessionId(req);
  insertBehaviorEvent({
    userId: uid,
    sessionId: sid,
    type: data.type || 'event',
    target: data.target || null,
    productId: data.productId || null,
    path: data.path || null,
    payload: data,
    ip: req.ip,
  });
  res.json({ ok: true });
});

app.post('/api/events', (req, res) => {
  const data = req.body || {};
  const uid = req.user?.sub || data.userId || null;
  const sid = data.sessionId || sessionId(req);
  insertBehaviorEvent({
    userId: uid,
    sessionId: sid,
    type: data.type || 'event',
    target: data.target || null,
    productId: data.productId || null,
    path: data.path || null,
    payload: data,
    ip: req.ip,
  });
  res.json({ ok: true });
});

app.get('/api/export/train.json', adminRequired, (_req, res) => {
  const events = db
    .prepare('SELECT * FROM behavior_events ORDER BY created_at ASC, id ASC')
    .all();
  const byKey = {};
  for (const e of events) {
    const key = e.user_id || e.session_id || 'anon';
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(e);
  }
  const examples = [];
  for (const list of Object.values(byKey)) {
    if (list.length < 2) continue;
    const profile = list;
    const purchased = profile.some((e) => e.type === 'purchase');
    const addedCart = profile.some((e) => e.type === 'add_to_cart');
    let label = 'window_shopper';
    if (purchased) label = 'loyal_buyer';
    else if (addedCart) label = 'cart_abandons';
    else if (profile.some((e) => e.type === 'view_product')) label = 'product_browser';
    examples.push({ text: profile.map(eventToken).join(' '), label });
  }
  res.json({ examples });
});

// ---------------------------------------------------------------------------
// Admin — consumer behavior intelligence
// ---------------------------------------------------------------------------
app.get('/api/admin/overview', adminRequired, (_req, res) => {
  res.json(overviewStats());
});

app.get('/api/admin/profiles', adminRequired, (req, res) => {
  const { q, persona, page = '1', limit = '40' } = req.query;
  const limitN = Math.min(100, Math.max(1, parseInt(limit, 10) || 40));
  const pageN = Math.max(1, parseInt(page, 10) || 1);
  const result = listProfiles({
    q,
    persona,
    limit: limitN,
    offset: (pageN - 1) * limitN,
  });
  res.json({ ...result, page: pageN, limit: limitN });
});

app.get('/api/admin/profiles/:key', adminRequired, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const profile = getProfile(key);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json({ profile });
});

app.post('/api/admin/profiles/:key/analyze', adminRequired, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const profile = getProfile(key);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json({ profile, analyzedAt: new Date().toISOString() });
});

app.post('/api/admin/rebuild', adminRequired, (_req, res) => {
  const result = rebuildAllProfiles();
  res.json({ ok: true, ...result });
});

app.get('/api/admin/events', adminRequired, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const type = req.query.type;
  let rows;
  if (type) {
    rows = db
      .prepare(
        `SELECT * FROM behavior_events WHERE type = ? ORDER BY id DESC LIMIT ?`
      )
      .all(type, limit);
  } else {
    rows = db
      .prepare(`SELECT * FROM behavior_events ORDER BY id DESC LIMIT ?`)
      .all(limit);
  }
  res.json({ count: rows.length, events: rows });
});

app.get('/api/admin/events/stream-snapshot', adminRequired, (_req, res) => {
  // Lightweight polling snapshot for live admin feed
  const events = db
    .prepare(
      `SELECT id, user_id, session_id, type, target, product_id, path, created_at
       FROM behavior_events ORDER BY id DESC LIMIT 40`
    )
    .all();
  const profiles = db
    .prepare(
      `SELECT profile_key, display_name, persona, purchase_intent, abandon_risk, last_active
       FROM consumer_profiles ORDER BY updated_at DESC LIMIT 10`
    )
    .all();
  res.json({ events, profiles, serverTime: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Admin — synthetic bots (login / search / purchase with unique DNA)
// ---------------------------------------------------------------------------
app.get('/api/admin/bots', adminRequired, (_req, res) => {
  res.json({
    bots: bots.listBots(),
    botPassword: bots.BOT_PASSWORD,
    fleet: bots.fleetStats(),
  });
});

app.get('/api/admin/bots/active', adminRequired, (req, res) => {
  const withinHours = Number(req.query.withinHours) || 48;
  res.json({
    bots: bots.listActiveBots({ withinHours }),
    fleet: bots.fleetStats(),
    withinHours,
  });
});

app.get('/api/admin/bots/personas', adminRequired, (_req, res) => {
  res.json({
    personas: bots.listPersonas(),
    categories: bots.categorySlugs(),
  });
});

app.get('/api/admin/bots/fleet-run', adminRequired, (_req, res) => {
  res.json({ fleetRun: bots.getFleetRunStatus() });
});

app.get('/api/admin/bots/:id', adminRequired, (req, res) => {
  const bot = bots.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  res.json({ bot });
});

app.post('/api/admin/bots', adminRequired, (req, res) => {
  try {
    const body = req.body || {};
    if (body.batch || body.count > 1) {
      const created = bots.createBotBatch({
        count: body.count || 5,
        persona: body.persona || null,
        personaMix: body.personaMix || null,
        diversity: body.diversity ?? 0.55,
        runSessions: body.runSessions || 0,
      });
      return res.status(201).json({ bots: created, count: created.length });
    }
    const bot = bots.createBot({
      persona: body.persona,
      diversity: body.diversity ?? 0.55,
      name: body.name || body.displayName,
      email: body.email,
      preferredCategories: body.preferredCategories,
      dna: body.dna,
      notes: body.notes,
    });
    if (body.runSessions > 0) {
      const ran = bots.runBot(bot.id, body.runSessions);
      return res.status(201).json(ran);
    }
    res.status(201).json({ bot });
  } catch (err) {
    console.error('create bot:', err);
    res.status(400).json({ error: err.message || 'Could not create bot' });
  }
});

app.patch('/api/admin/bots/:id', adminRequired, (req, res) => {
  try {
    const bot = bots.updateBot(req.params.id, req.body || {});
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({ bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/bots/:id', adminRequired, (req, res) => {
  const ok = bots.deleteBot(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Bot not found' });
  res.json({ ok: true });
});

app.post('/api/admin/bots/:id/run', adminRequired, (req, res) => {
  try {
    const sessions = req.body?.sessions || 1;
    const result = bots.runBot(req.params.id, sessions);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/bots/:id/analysis', adminRequired, (req, res) => {
  try {
    const analysis = analyzeBotBuying(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Bot not found' });
    res.json({ analysis });
  } catch (err) {
    console.error('bot analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/bots-buying-analysis', adminRequired, (req, res) => {
  try {
    // Default: all active bots (high cap). Pass ?limit=N to cap if needed.
    res.json(
      analyzeAllBotsBuying({
        limit: req.query.limit != null ? Number(req.query.limit) : 5000,
      })
    );
  } catch (err) {
    console.error('fleet buying analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/bots/run-all', adminRequired, (req, res) => {
  try {
    const sessions = req.body?.sessions || 1;
    // Background play — returns immediately; watch SSE / fleet-run status
    const status = bots.startFleetRun(sessions);
    res.status(202).json({
      ok: true,
      started: true,
      message: `Playing all ${status.total} bots (${status.sessions} session(s) each)`,
      fleetRun: status,
    });
  } catch (err) {
    const code = err.code === 'FLEET_BUSY' ? 409 : 400;
    res.status(code).json({ error: err.message });
  }
});

app.post('/api/admin/bots/stop-all', adminRequired, (_req, res) => {
  try {
    const status = bots.stopFleetRun();
    res.json({
      ok: true,
      stopped: true,
      message: status.wasRunning
        ? `Stopping fleet after ${status.completed}/${status.total} bots`
        : status.clearedRunning
          ? `Stopped ${status.clearedRunning} running bot(s)`
          : 'No fleet was playing; cleared stuck runners if any',
      fleetRun: status,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/bots/:id/stop', adminRequired, (req, res) => {
  try {
    const bot = bots.stopBot(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    res.json({ ok: true, stopped: true, bot });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin — real-time SSE stream (AI + events)
// EventSource cannot set Authorization headers → token query param
// ---------------------------------------------------------------------------
app.get('/api/admin/stream', (req, res) => {
  const token =
    req.query.token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Admin token required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!payload.isAdmin) {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(payload.sub);
    if (!row || !row.is_admin) {
      return res.status(403).json({ error: 'Admin access only' });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (envelope) => {
    res.write(`event: ${envelope.type}\n`);
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
  };

  // Snapshot for immediate UI
  send({
    type: 'hello',
    data: getLiveSnapshot(),
    ts: new Date().toISOString(),
  });

  for (const msg of liveBus.getRecent(25)) {
    send(msg);
  }

  const onMsg = (envelope) => {
    try {
      send(envelope);
    } catch {
      /* client gone */
    }
  };
  const unsub = liveBus.subscribe(onMsg);

  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});

app.get('/api/admin/live/snapshot', adminRequired, (_req, res) => {
  res.json(getLiveSnapshot());
});

app.get('/api/admin/live/ai-cache', adminRequired, (_req, res) => {
  res.json({ classifications: getInferenceCache().slice(0, 50) });
});

// ---------------------------------------------------------------------------
// Admin — Tiny Transformer AI learning console
// ---------------------------------------------------------------------------
app.get('/api/admin/ai', adminRequired, (_req, res) => {
  try {
    const status = mlTrain.getLearningStatus();
    status.realtime = {
      enabled: true,
      classifications: getInferenceCache().slice(0, 25),
      dataset: getLiveSnapshot().dataset,
    };
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/ai/progress', adminRequired, (_req, res) => {
  res.json(mlTrain.getLearningStatus().live);
});

app.post('/api/admin/ai/train', adminRequired, (req, res) => {
  try {
    const epochs = Math.min(100, Math.max(1, Number(req.body?.epochs) || 20));
    const lr = Number(req.body?.lr) || 0.05;
    const result = mlTrain.startTraining({
      epochs,
      lr,
      auto: false,
      reason: 'manual',
    });
    res.status(202).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/ai/auto', adminRequired, (_req, res) => {
  res.json(mlTrain.getAutoTrainStatus());
});

app.post('/api/admin/ai/auto', adminRequired, (req, res) => {
  try {
    if (typeof req.body?.enabled === 'boolean') {
      return res.json(mlTrain.setAutoTrainEnabled(req.body.enabled));
    }
    // Kick an auto-check now
    const r = mlTrain.scheduleAutoTrain(req.body?.reason || 'api', {
      immediate: true,
    });
    res.json({ ...mlTrain.getAutoTrainStatus(), kick: r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/ai/runs', adminRequired, (_req, res) => {
  res.json({ runs: mlTrain.listRuns(30) });
});

// Mined product features for admin
app.get('/api/admin/insights', adminRequired, (_req, res) => {
  try {
    res.json(featureMine.getAllMinedFeatures());
  } catch (err) {
    console.error('insights:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/insights/growth', adminRequired, (_req, res) => {
  res.json(featureMine.getGrowthQueues());
});

app.get('/api/admin/insights/catalog', adminRequired, (_req, res) => {
  res.json(featureMine.getCatalogFeatures());
});

app.get('/api/admin/insights/bots', adminRequired, (_req, res) => {
  res.json(featureMine.getBotLabFeatures());
});

app.get('/api/admin/insights/model', adminRequired, (_req, res) => {
  res.json(featureMine.getModelOpsFeatures());
});

// General real-time AI analysis (market pulse)
app.get('/api/admin/analysis/personas', adminRequired, (req, res) => {
  try {
    res.json(
      personaAnalysis.getPersonaAnalysis({
        limitMembers: Math.min(20, Number(req.query.members) || 8),
      })
    );
  } catch (err) {
    console.error('persona analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Core commercial report: funnels, stages, drop-offs, spend, actions */
app.get('/api/admin/analysis/buyers', adminRequired, (req, res) => {
  try {
    res.json(
      buyerBehavior.getBuyerBehaviorAnalysis({
        memberLimit: Math.min(20, Number(req.query.members) || 12),
      })
    );
  } catch (err) {
    console.error('buyer behavior:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Future predictions from learned behavior */
app.get('/api/admin/analysis/predictions', adminRequired, (req, res) => {
  try {
    res.json(
      futurePredict.getFuturePredictions({
        limit: Math.min(100, Number(req.query.limit) || 60),
      })
    );
  } catch (err) {
    console.error('predictions:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Plain-English dump of what the AI currently knows */
app.get('/api/admin/analysis/knowledge', adminRequired, (_req, res) => {
  try {
    res.json(knowledge.getWhatItKnows());
  } catch (err) {
    console.error('knowledge:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trove Intel chat (Grok + grounded transformer/analytics)
// ---------------------------------------------------------------------------
app.get('/api/admin/chat/status', adminRequired, async (_req, res) => {
  try {
    res.json(await troveChat.getChatStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/chat', adminRequired, async (req, res) => {
  try {
    const result = await troveChat.chat({
      message: req.body?.message,
      sessionId: req.body?.sessionId || req.user?.id || 'admin',
      focusBotId: req.body?.botId || null,
      focusProfileKey: req.body?.profileKey || null,
      provider: req.body?.provider || null,
    });
    res.json(result);
  } catch (err) {
    console.error('chat:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/admin/chat/clear', adminRequired, (req, res) => {
  troveChat.clearSession(req.body?.sessionId || req.user?.id || 'admin');
  res.json({ ok: true });
});

/** Paste API key in the browser — Gemini or xAI; verifies then saves */
app.post('/api/admin/chat/key', adminRequired, async (req, res) => {
  try {
    const result = await troveChat.saveApiKey(
      req.body?.apiKey || req.body?.key || '',
      req.body?.provider || 'auto'
    );
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('chat key:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Use free local advisor (no cloud LLM) */
app.post('/api/admin/chat/local', adminRequired, async (_req, res) => {
  try {
    const result = await troveChat.useLocalAdvisor();
    res.json(result);
  } catch (err) {
    console.error('chat local:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/analysis/realtime', adminRequired, (req, res) => {
  try {
    const minutes = Number(req.query.minutes) || 30;
    res.json(getRealtimeAnalysis({ minutes }));
  } catch (err) {
    console.error('realtime analysis:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Production: serve built React app (Oracle / single-host deploy)
// Build with: cd client && npm run build
// ---------------------------------------------------------------------------
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api)(?!\/log_event).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'), (err) => {
      if (err) next();
    });
  });
  console.log(`  UI:          serving ${CLIENT_DIST}`);
} else {
  console.log(`  UI:          not built yet (run: cd client && npm run build)`);
}

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Trove shop API  http://${HOST}:${PORT}`);
  console.log(`  SQLite + consumer behavior engine + bots`);
  console.log(`  Shop demo:  demo@trove.shop / password123`);
  console.log(`  Admin:      admin@trove.shop / admin123`);
  console.log(`  Admin API:  /api/admin/*  (bots: /api/admin/bots)`);
});
