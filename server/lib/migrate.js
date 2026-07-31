/**
 * Lightweight schema migrations for existing SQLite DBs.
 */
const { db } = require('../db');

function columnExists(table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

function migrate() {
  if (!columnExists('users', 'is_admin')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists('users', 'is_bot')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name    TEXT NOT NULL,
      email           TEXT NOT NULL UNIQUE,
      persona         TEXT NOT NULL,
      dna_json        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'idle',
      sessions_run    INTEGER NOT NULL DEFAULT 0,
      last_run_at     TEXT,
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bots_persona ON bots(persona);
    CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);

    CREATE TABLE IF NOT EXISTS ml_training_runs (
      id                TEXT PRIMARY KEY,
      status            TEXT NOT NULL DEFAULT 'pending',
      epochs            INTEGER,
      samples           INTEGER,
      train_acc         REAL,
      final_loss        REAL,
      vocab_size        INTEGER,
      seconds           REAL,
      history_json      TEXT,
      label_counts_json TEXT,
      metrics_json      TEXT,
      model_path        TEXT,
      error             TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS consumer_profiles (
      profile_key        TEXT PRIMARY KEY,
      user_id            TEXT,
      session_id         TEXT,
      display_name       TEXT,
      persona            TEXT NOT NULL DEFAULT 'unknown',
      confidence         REAL NOT NULL DEFAULT 0,
      engagement_score   REAL NOT NULL DEFAULT 0,
      purchase_intent    REAL NOT NULL DEFAULT 0,
      price_sensitivity  REAL NOT NULL DEFAULT 0,
      loyalty_score      REAL NOT NULL DEFAULT 0,
      abandon_risk       REAL NOT NULL DEFAULT 0,
      category_affinity  TEXT,
      brand_affinity     TEXT,
      top_products       TEXT,
      journey_path       TEXT,
      event_count        INTEGER NOT NULL DEFAULT 0,
      purchase_count     INTEGER NOT NULL DEFAULT 0,
      total_spent_cents  INTEGER NOT NULL DEFAULT 0,
      insights           TEXT,
      scores_json        TEXT,
      last_active        TEXT,
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_consumer_user ON consumer_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_consumer_persona ON consumer_profiles(persona);
    CREATE INDEX IF NOT EXISTS idx_consumer_updated ON consumer_profiles(updated_at);
  `);

  if (!columnExists('ml_training_runs', 'metrics_json')) {
    try {
      db.exec(`ALTER TABLE ml_training_runs ADD COLUMN metrics_json TEXT`);
    } catch {
      /* already exists or table new */
    }
  }

  const bcrypt = require('bcryptjs');
  const adminEmail = 'admin@trove.shop';
  const existing = db
    .prepare('SELECT id, is_admin FROM users WHERE email = ?')
    .get(adminEmail);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, is_admin)
       VALUES (?, ?, ?, ?, 1)`
    ).run(
      'user-admin',
      adminEmail,
      bcrypt.hashSync('admin123', 10),
      'Trove Admin'
    );
    console.log('Created admin@trove.shop / admin123');
  } else if (!existing.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(adminEmail);
  }
}

module.exports = { migrate };
