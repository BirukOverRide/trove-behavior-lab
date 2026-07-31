PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL DEFAULT 'Home',
  full_name   TEXT NOT NULL,
  line1       TEXT NOT NULL,
  line2       TEXT,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'US',
  phone       TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  parent_id   TEXT REFERENCES categories(id),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  sku             TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  brand           TEXT NOT NULL,
  description     TEXT NOT NULL,
  bullet_1        TEXT,
  bullet_2        TEXT,
  bullet_3        TEXT,
  bullet_4        TEXT,
  bullet_5        TEXT,
  category_id     TEXT NOT NULL REFERENCES categories(id),
  price_cents     INTEGER NOT NULL,
  list_price_cents INTEGER,
  currency        TEXT NOT NULL DEFAULT 'USD',
  stock           INTEGER NOT NULL DEFAULT 0,
  rating_avg      REAL NOT NULL DEFAULT 0,
  rating_count    INTEGER NOT NULL DEFAULT 0,
  image_url       TEXT NOT NULL,
  image_url_2     TEXT,
  image_url_3     TEXT,
  is_prime        INTEGER NOT NULL DEFAULT 1,
  is_bestseller   INTEGER NOT NULL DEFAULT 0,
  is_amazon_choice INTEGER NOT NULL DEFAULT 0,
  weight_oz       REAL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 1,
  helpful     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

CREATE TABLE IF NOT EXISTS carts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id),
  UNIQUE(session_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id          TEXT PRIMARY KEY,
  cart_id     TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  UNIQUE(cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'placed',
  subtotal_cents  INTEGER NOT NULL,
  shipping_cents  INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  ship_name       TEXT NOT NULL,
  ship_line1      TEXT NOT NULL,
  ship_line2      TEXT,
  ship_city       TEXT NOT NULL,
  ship_state      TEXT NOT NULL,
  ship_postal      TEXT NOT NULL,
  ship_country    TEXT NOT NULL DEFAULT 'US',
  ship_phone      TEXT,
  payment_method  TEXT NOT NULL DEFAULT 'card_demo',
  placed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id),
  title           TEXT NOT NULL,
  brand           TEXT NOT NULL,
  image_url       TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  qty             INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS behavior_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  session_id  TEXT,
  type        TEXT NOT NULL,
  target      TEXT,
  product_id  TEXT,
  path        TEXT,
  payload     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user ON behavior_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON behavior_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON behavior_events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON behavior_events(created_at);
