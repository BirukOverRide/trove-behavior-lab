const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
const dbPath = process.env.DB_PATH || path.join(dataDir, 'harbor.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function money(cents) {
  return {
    cents,
    amount: (cents / 100).toFixed(2),
    formatted: `$${(cents / 100).toFixed(2)}`,
  };
}

function mapProduct(row) {
  if (!row) return null;
  const discount =
    row.list_price_cents && row.list_price_cents > row.price_cents
      ? Math.round(
          ((row.list_price_cents - row.price_cents) / row.list_price_cents) * 100
        )
      : 0;
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    brand: row.brand,
    description: row.description,
    bullets: [row.bullet_1, row.bullet_2, row.bullet_3, row.bullet_4, row.bullet_5].filter(
      Boolean
    ),
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    categorySlug: row.category_slug || null,
    price: money(row.price_cents),
    listPrice: row.list_price_cents ? money(row.list_price_cents) : null,
    discountPercent: discount,
    currency: row.currency,
    stock: row.stock,
    inStock: row.stock > 0,
    ratingAvg: Number(row.rating_avg) || 0,
    ratingCount: row.rating_count || 0,
    images: [row.image_url, row.image_url_2, row.image_url_3].filter(Boolean),
    isPrime: !!row.is_prime,
    isBestseller: !!row.is_bestseller,
    isAmazonChoice: !!row.is_amazon_choice,
    weightOz: row.weight_oz,
    createdAt: row.created_at,
  };
}

module.exports = { db, dbPath, money, mapProduct };
