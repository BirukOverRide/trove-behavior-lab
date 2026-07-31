const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { db } = require('../db');
const {
  generateDna,
  generateBotIdentity,
  normalizeDna,
  listPersonas,
  mulberry32,
  pick,
} = require('./botDna');
const { runBotSessions, loadCatalog } = require('./botRunner');

const BOT_PASSWORD = process.env.BOT_PASSWORD || 'botpass123';

function mapBot(row) {
  if (!row) return null;
  let dna = {};
  try {
    dna = JSON.parse(row.dna_json);
  } catch {
    dna = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    persona: row.persona,
    personaLabel: dna.personaLabel || row.persona,
    dna,
    status: row.status,
    sessionsRun: row.sessions_run,
    lastRunAt: row.last_run_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordHint: BOT_PASSWORD,
  };
}

function listBots() {
  const rows = db
    .prepare('SELECT * FROM bots ORDER BY created_at DESC')
    .all();
  return rows.map(mapBot);
}

/** Bots that are running or recently simulated (active in the marketplace). */
function listActiveBots({ withinHours = 48 } = {}) {
  const rows = db
    .prepare(
      `SELECT b.*,
         (SELECT COUNT(*) FROM behavior_events e WHERE e.user_id = b.user_id) AS event_count,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = b.user_id) AS order_count,
         (SELECT MAX(created_at) FROM behavior_events e WHERE e.user_id = b.user_id) AS last_event_at
       FROM bots b
       WHERE b.status = 'running'
          OR b.sessions_run > 0
          OR (b.last_run_at IS NOT NULL AND datetime(b.last_run_at) >= datetime('now', ?))
       ORDER BY
         CASE WHEN b.status = 'running' THEN 0 ELSE 1 END,
         COALESCE(b.last_run_at, b.created_at) DESC`
    )
    .all(`-${Math.max(1, withinHours)} hours`);

  return rows.map((row) => ({
    ...mapBot(row),
    eventCount: row.event_count || 0,
    orderCount: row.order_count || 0,
    lastEventAt: row.last_event_at,
    isRunning: row.status === 'running',
    isActive: true,
  }));
}

function fleetStats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM bots').get().c;
  const running = db.prepare(`SELECT COUNT(*) AS c FROM bots WHERE status = 'running'`).get().c;
  const withSessions = db.prepare(`SELECT COUNT(*) AS c FROM bots WHERE sessions_run > 0`).get().c;
  const active = listActiveBots({ withinHours: 48 }).length;
  const neverRun = db.prepare(`SELECT COUNT(*) AS c FROM bots WHERE sessions_run = 0`).get().c;
  const byPersona = db
    .prepare(`SELECT persona, COUNT(*) AS c FROM bots GROUP BY persona ORDER BY c DESC`)
    .all();
  return { total, running, withSessions, active, neverRun, byPersona };
}

function getBot(id) {
  return mapBot(db.prepare('SELECT * FROM bots WHERE id = ?').get(id));
}

function categorySlugs() {
  return db.prepare('SELECT slug FROM categories ORDER BY sort_order').all().map((c) => c.slug);
}

/**
 * Create one bot with unique DNA. options: persona, diversity, dna overrides, name, email
 */
function createBot(options = {}) {
  const diversity = Math.max(0, Math.min(1, Number(options.diversity) ?? 0.55));
  const seed = options.seed ?? Math.floor(Math.random() * 1e9);
  const rand = mulberry32(seed);
  const identity = options.email
    ? { name: options.name || 'Bot Shopper', email: options.email.toLowerCase() }
    : generateBotIdentity(rand);

  if (options.name) identity.name = options.name;

  const cats = categorySlugs();
  let preferred = options.preferredCategories;
  if (!preferred || !preferred.length) {
    // Each bot gets 1–3 random category biases (unique mix)
    const n = 1 + Math.floor(rand() * 3);
    const shuffled = [...cats].sort(() => rand() - 0.5);
    preferred = shuffled.slice(0, Math.min(n, shuffled.length));
  }

  const dna = normalizeDna(
    generateDna({
      persona: options.persona || 'product_browser',
      diversity,
      preferredCategories: preferred,
      seed,
      overrides: options.dna || {},
    })
  );

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(identity.email)) {
    // retry email once
    const again = generateBotIdentity(rand);
    identity.email = again.email;
    if (!options.name) identity.name = again.name;
  }

  const userId = uuid();
  const botId = uuid();
  const hash = bcrypt.hashSync(BOT_PASSWORD, 8);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, is_admin, is_bot)
       VALUES (?, ?, ?, ?, 0, 1)`
    ).run(userId, identity.email, hash, identity.name);

    db.prepare(
      `INSERT INTO bots (id, user_id, display_name, email, persona, dna_json, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'idle')`
    ).run(
      botId,
      userId,
      identity.name,
      identity.email,
      dna.persona,
      JSON.stringify(dna),
      options.notes || dna.notes || null
    );
  });
  tx();

  return getBot(botId);
}

/**
 * Bulk create with persona mix and diversity — bots will not be identical.
 */
function createBotBatch({
  count = 5,
  persona = null,
  personaMix = null,
  diversity = 0.55,
  runSessions = 0,
} = {}) {
  // No upper cap — create as many bots as requested (min 1).
  const n = Math.max(1, parseInt(count, 10) || 5);
  const personas = listPersonas().map((p) => p.id);
  const created = [];
  const mix = personaMix && typeof personaMix === 'object' ? personaMix : null;

  for (let i = 0; i < n; i++) {
    let p = persona;
    if (mix) {
      const entries = Object.entries(mix).filter(([, w]) => Number(w) > 0);
      const total = entries.reduce((s, [, w]) => s + Number(w), 0) || 1;
      let r = Math.random() * total;
      p = entries[0]?.[0] || 'product_browser';
      for (const [id, w] of entries) {
        r -= Number(w);
        if (r <= 0) {
          p = id;
          break;
        }
      }
    } else if (!p) {
      p = personas[i % personas.length];
    }

    // Slight diversity jitter per bot index
    const div = Math.max(0, Math.min(1, Number(diversity) + (Math.random() - 0.5) * 0.1));
    const bot = createBot({ persona: p, diversity: div });
    created.push(bot);

    if (runSessions > 0) {
      const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(bot.id);
      const dna = normalizeDna(bot.dna);
      runBotSessions(row, dna, runSessions);
      created[created.length - 1] = getBot(bot.id);
    }
  }
  return created;
}

function updateBot(id, patch = {}) {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  if (!row) return null;

  let dna = normalizeDna(JSON.parse(row.dna_json));
  if (patch.dna) {
    dna = normalizeDna({ ...dna, ...patch.dna, persona: patch.persona || patch.dna.persona || dna.persona });
  }
  if (patch.persona && patch.persona !== dna.persona) {
    // Keep manual knobs but switch persona label
    dna = normalizeDna({ ...dna, persona: patch.persona });
  }

  const displayName = patch.displayName || patch.name || row.display_name;
  const notes = patch.notes !== undefined ? patch.notes : row.notes;

  db.prepare(
    `UPDATE bots SET
       display_name = ?,
       persona = ?,
       dna_json = ?,
       notes = ?,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(displayName, dna.persona, JSON.stringify(dna), notes, id);

  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(displayName, row.user_id);

  return getBot(id);
}

function deleteBot(id) {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  if (!row) return false;
  // CASCADE user deletes bot if FK is set user->bot; we delete user which may need bot first
  db.prepare('DELETE FROM bots WHERE id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(row.user_id);
  return true;
}

/** Bots requested to stop mid multi-session / fleet run */
const cancelledBots = new Set();

function isBotCancelled(id) {
  return cancelledBots.has(id) || (fleetRun.running && fleetRun.stopRequested);
}

function clearBotCancel(id) {
  if (id) cancelledBots.delete(id);
}

function runBot(id, sessions = 1) {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  if (!row) throw new Error('Bot not found');
  clearBotCancel(id);
  const dna = normalizeDna(JSON.parse(row.dna_json));
  db.prepare(`UPDATE bots SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(id);
  try {
    const results = runBotSessions(row, dna, sessions, {
      shouldAbort: () => isBotCancelled(id),
    });
    return { bot: getBot(id), results, stopped: isBotCancelled(id) };
  } finally {
    db.prepare(`UPDATE bots SET status = 'idle', updated_at = datetime('now') WHERE id = ?`).run(id);
    clearBotCancel(id);
  }
}

/** In-memory fleet play state for the admin Play button */
let fleetRun = {
  running: false,
  startedAt: null,
  finishedAt: null,
  sessions: 1,
  total: 0,
  completed: 0,
  currentBotId: null,
  currentBotName: null,
  results: [],
  error: null,
  stopRequested: false,
  stopped: false,
};

function getFleetRunStatus() {
  return { ...fleetRun, results: fleetRun.results.slice(-30) };
}

function markBotsIdle(ids = null) {
  if (ids && ids.length) {
    const stmt = db.prepare(
      `UPDATE bots SET status = 'idle', updated_at = datetime('now') WHERE id = ?`
    );
    const tx = db.transaction((list) => {
      for (const id of list) stmt.run(id);
    });
    tx(ids);
    return ids.length;
  }
  return db
    .prepare(`UPDATE bots SET status = 'idle', updated_at = datetime('now') WHERE status = 'running'`)
    .run().changes;
}

/**
 * Stop a single bot (marks cancel; current session may finish, then no more sessions).
 */
function stopBot(id) {
  const row = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  if (!row) return null;
  cancelledBots.add(id);
  markBotsIdle([id]);
  let publish;
  try {
    publish = require('./liveBus').publish;
  } catch {
    publish = () => {};
  }
  publish('bot_run', {
    botId: id,
    name: row.display_name,
    status: 'stopped',
  });
  return getBot(id);
}

/**
 * Stop fleet play + force any status=running bots back to idle.
 */
function stopFleetRun() {
  let publish;
  try {
    publish = require('./liveBus').publish;
  } catch {
    publish = () => {};
  }

  const wasRunning = fleetRun.running;
  fleetRun.stopRequested = true;

  // Cancel every bot currently in the fleet queue sense
  if (fleetRun.currentBotId) {
    cancelledBots.add(fleetRun.currentBotId);
  }
  const cleared = markBotsIdle();

  if (wasRunning) {
    publish('fleet_run', { ...getFleetRunStatus(), phase: 'stopping' });
  } else {
    // No live fleet loop — still clear stuck "running" rows
    fleetRun.stopped = true;
    fleetRun.running = false;
    fleetRun.finishedAt = fleetRun.finishedAt || new Date().toISOString();
    fleetRun.currentBotId = null;
    fleetRun.currentBotName = null;
    publish('fleet_run', { ...getFleetRunStatus(), phase: 'stopped', clearedRunning: cleared });
  }

  return {
    ...getFleetRunStatus(),
    wasRunning,
    clearedRunning: cleared,
  };
}

/**
 * Run every bot (sequential, background-friendly).
 * Prefer startFleetRun() from HTTP so the request returns immediately.
 */
function runAllBots(sessions = 1) {
  const rows = db.prepare('SELECT id, display_name FROM bots ORDER BY created_at ASC').all();
  const out = [];
  for (const r of rows) {
    out.push(runBot(r.id, sessions));
  }
  return out;
}

/**
 * Start all bots in the background. Returns immediately.
 * Progress is published on the live SSE bus (bot_run / fleet_run).
 */
function startFleetRun(sessions = 1) {
  if (fleetRun.running) {
    const err = new Error('Fleet is already playing');
    err.code = 'FLEET_BUSY';
    throw err;
  }

  const rows = db.prepare('SELECT id, display_name FROM bots ORDER BY created_at ASC').all();
  if (!rows.length) {
    throw new Error('No bots to run — create some first');
  }

  const nSessions = Math.max(1, Math.min(10, parseInt(sessions, 10) || 1));

  fleetRun = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sessions: nSessions,
    total: rows.length,
    completed: 0,
    currentBotId: null,
    currentBotName: null,
    results: [],
    error: null,
    stopRequested: false,
    stopped: false,
  };

  let publish;
  try {
    publish = require('./liveBus').publish;
  } catch {
    publish = () => {};
  }

  publish('fleet_run', { ...getFleetRunStatus(), phase: 'started' });

  const finishFleet = (phase) => {
    fleetRun.running = false;
    fleetRun.finishedAt = new Date().toISOString();
    fleetRun.currentBotId = null;
    fleetRun.currentBotName = null;
    fleetRun.stopped = phase === 'stopped';
    fleetRun.stopRequested = false;
    markBotsIdle();
    publish('fleet_run', { ...getFleetRunStatus(), phase });
    if (phase === 'done') {
      try {
        require('./mlTrain').scheduleAutoTrain('fleet_done', { immediate: true });
      } catch {
        /* ignore */
      }
    }
  };

  // Yield between bots so HTTP/SSE stay responsive
  const runNext = (i) => {
    if (fleetRun.stopRequested) {
      finishFleet('stopped');
      return;
    }
    if (i >= rows.length) {
      finishFleet('done');
      return;
    }
    const r = rows[i];
    if (fleetRun.stopRequested || cancelledBots.has(r.id)) {
      finishFleet('stopped');
      return;
    }
    fleetRun.currentBotId = r.id;
    fleetRun.currentBotName = r.display_name;
    publish('fleet_run', {
      ...getFleetRunStatus(),
      phase: 'bot',
      index: i + 1,
    });
    try {
      const result = runBot(r.id, nSessions);
      fleetRun.results.push({
        botId: r.id,
        name: r.display_name,
        ok: true,
        stopped: !!result.stopped,
        events: result.results?.reduce((s, x) => s + (x.events || 0), 0) || 0,
        purchased: result.results?.some((x) => x.purchased) || false,
      });
    } catch (e) {
      fleetRun.results.push({
        botId: r.id,
        name: r.display_name,
        ok: false,
        error: e.message,
      });
    }
    fleetRun.completed = i + 1;
    publish('fleet_run', {
      ...getFleetRunStatus(),
      phase: 'progress',
      index: i + 1,
    });

    if (fleetRun.stopRequested) {
      finishFleet('stopped');
      return;
    }
    setTimeout(() => runNext(i + 1), 0);
  };

  setImmediate(() => runNext(0));

  return getFleetRunStatus();
}

module.exports = {
  listBots,
  listActiveBots,
  fleetStats,
  getBot,
  createBot,
  createBotBatch,
  updateBot,
  deleteBot,
  runBot,
  stopBot,
  runAllBots,
  startFleetRun,
  stopFleetRun,
  getFleetRunStatus,
  listPersonas,
  BOT_PASSWORD,
  categorySlugs,
};
