/**
 * Trove Chat — high-skill conversational layer over behavior AI.
 *
 * The Tiny Transformer classifies journeys (personas). It cannot chat.
 * This module:
 *  1) Builds grounded context from knowledge / buyers / predictions / profiles
 *  2) Uses xAI Grok (SpaceXAI) for fluent, high-skill replies when XAI_API_KEY is set
 *  3) Falls back to a careful template advisor if no key
 */
const { getWhatItKnows } = require('./knowledge');
const { getBuyerBehaviorAnalysis } = require('./buyerBehavior');
const { getFuturePredictions } = require('./futurePredict');
const { getProfile } = require('./behaviorEngine');
const { analyzeBotBuying } = require('./buyAnalysis');
const { db } = require('../db');

const XAI_BASE = process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
const XAI_MODEL = process.env.XAI_CHAT_MODEL || 'grok-4.5';
const GEMINI_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE =
  process.env.GEMINI_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';

/** In-memory chat history: sessionId -> { messages, updatedAt } */
const sessions = new Map();
const MAX_HISTORY = 16;
const SESSION_TTL_MS = 1000 * 60 * 60 * 2;

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

function getSession(sessionId) {
  pruneSessions();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], updatedAt: Date.now() });
  }
  const s = sessions.get(sessionId);
  s.updatedAt = Date.now();
  return s;
}

function cleanKey(raw) {
  let key = String(raw || '').trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim();
  if (/=/.test(key) && /api[_-]?key/i.test(key.split('=')[0])) {
    key = key.split('=').slice(1).join('=').trim();
  }
  key = key.replace(/^["']|["']$/g, '').trim();
  return key;
}

function isPlaceholderKey(key) {
  return (
    !key ||
    key.length < 16 ||
    /paste|replace|EVERYTHING|your[_-]?real|your[_-]?key|changeme|example|xxxx|TODO|ON_THIS_LINE/i.test(
      key
    )
  );
}

function getXaiKey() {
  let key = cleanKey(process.env.XAI_API_KEY || process.env.xai_api_key || '');
  if (isPlaceholderKey(key)) return null;
  // Real xAI keys are usually xai-...
  if (/^xai-[A-Za-z0-9_\-]{16,}$/i.test(key)) return key;
  if (key.length >= 40) return key;
  return null;
}

function getGeminiKey() {
  let key = cleanKey(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      ''
  );
  if (isPlaceholderKey(key)) return null;
  // Gemini keys often start with AIza
  if (/^AIza[0-9A-Za-z_\-]{20,}$/.test(key)) return key;
  if (key.length >= 24) return key;
  return null;
}

function hasXaiKey() {
  return !!getXaiKey();
}

function hasGeminiKey() {
  return !!getGeminiKey();
}

function hasAnyLlmKey() {
  return hasXaiKey() || hasGeminiKey();
}

/**
 * Preferred provider:
 *  - explicit preferred / CHAT_PROVIDER
 *  - auto: Gemini, then xAI, else local advisor (null)
 */
function resolveProvider(preferred) {
  const pref = String(
    preferred || process.env.CHAT_PROVIDER || process.env.TROVE_CHAT_PROVIDER || 'auto'
  )
    .toLowerCase()
    .trim();
  const xai = hasXaiKey();
  const gem = hasGeminiKey();

  if (pref === 'off' || pref === 'local' || pref === 'none' || pref === 'template') {
    return null; // local advisor only
  }
  if (pref === 'gemini' || pref === 'google') {
    if (gem) return 'gemini';
    if (xai) return 'xai';
    return null;
  }
  if (pref === 'xai' || pref === 'grok') {
    if (xai) return 'xai';
    if (gem) return 'gemini';
    return null;
  }
  // auto
  if (gem) return 'gemini';
  if (xai) return 'xai';
  return null;
}

function hasChatLlm() {
  return hasAnyLlmKey();
}


/**
 * System prompt optimized for communication quality + grounded analytics.
 */
function buildSystemPrompt(ctx) {
  return `You are **Trove Intel**, a senior consumer-behavior strategist and trusted advisor for the Trove shopping lab.

## Voice & communication skills (non-negotiable)
- Warm, clear, and confident — like a sharp colleague, not a robot or a hype machine.
- Lead with the answer, then support with evidence.
- Use plain English. Avoid jargon unless the user uses it first; if you must, explain it in one short phrase.
- Mirror the user's energy: short questions → concise answers; deep questions → structured depth.
- Use short paragraphs and bullets for scanability. Prefer active voice.
- Empathize briefly when the user is frustrated; never condescend.
- End with one optional next step or question when helpful — not every time.
- Never invent numbers. Only use facts from GROUNDED DATA below. If data is missing, say so and suggest how to get it (run bots, open Buyer behavior, retrain).
- Distinguish clearly:
  - **Hard facts** (funnel counts, orders, stages from events)
  - **Model opinions** (Tiny Transformer persona labels ~40–50% accurate)
  - **Forecasts** (probabilistic "likely to buy/abandon")

## What the Tiny Transformer actually is
It is NOT a language model. It classifies shopper journey token sequences into personas (loyal buyer, cart abandoner, etc.). You provide the high-skill communication; the transformer + analytics provide the evidence.

## Your job
Help the user understand shoppers, funnels, leaks, predictions, and what to do next — using the grounded snapshot.

## GROUNDED DATA (authoritative for this reply)
${ctx}
`;
}

function buildGroundedContext({ focusBotId, focusProfileKey, question } = {}) {
  const parts = [];

  try {
    const know = getWhatItKnows();
    parts.push('### What the AI knows (summary)');
    parts.push((know.iKnow || []).slice(0, 10).map((x) => `- ${x}`).join('\n'));
    if (know.personas?.length) {
      parts.push('\n### Persona skills');
      for (const p of know.personas.slice(0, 8)) {
        const acc =
          p.accuracy != null ? `${Math.round(p.accuracy * 100)}%` : 'n/a';
        parts.push(
          `- ${p.label}: ${p.skill}, ${acc} correct, n=${p.examples}. Tokens: ${(p.topTokens || [])
            .slice(0, 5)
            .map((t) => t.token)
            .join(', ')}`
        );
      }
    }
    if (know.buying?.length) {
      parts.push('\n### Buying funnel facts');
      for (const b of know.buying) {
        parts.push(`- ${b.title}: ${b.value} — ${b.plain}`);
      }
    }
  } catch (e) {
    parts.push(`(knowledge unavailable: ${e.message})`);
  }

  try {
    const buy = getBuyerBehaviorAnalysis({ memberLimit: 5 });
    parts.push('\n### Buyer behavior headline');
    for (const t of (buy.takeaways || []).slice(0, 5)) {
      parts.push(`- **${t.title}**: ${t.text}`);
    }
    parts.push('\n### Recommended actions');
    for (const a of (buy.actions || []).slice(0, 4)) {
      parts.push(`- ${a.action}: ${a.why}`);
    }
    const s = buy.summary || {};
    parts.push(
      `\nSummary counts: shoppers=${s.shoppers}, buyers=${s.buyers}, almostBuyers=${s.almostBuyers}, revenue=${s.revenue?.formatted}, view→buy=${s.viewToPurchase}%`
    );
  } catch (e) {
    parts.push(`(buyer analysis unavailable: ${e.message})`);
  }

  try {
    const pred = getFuturePredictions({ limit: 8 });
    parts.push('\n### Forecast snapshot');
    for (const st of (pred.stories || []).slice(0, 4)) {
      parts.push(`- **${st.title}**: ${st.text}`);
    }
    if (pred.likelyToBuySoon?.[0]) {
      const p = pred.likelyToBuySoon[0];
      parts.push(
        `- Top near-term buyer: ${p.name} (${p.willBuySoon.probability}% buy) — ${p.advice}`
      );
    }
    if (pred.likelyToAbandon?.[0]) {
      const p = pred.likelyToAbandon[0];
      parts.push(
        `- Highest abandon risk: ${p.name} (${p.willAbandon.probability}%) — ${p.nextAction?.label}`
      );
    }
  } catch (e) {
    parts.push(`(predictions unavailable: ${e.message})`);
  }

  // Optional focus entity
  if (focusBotId) {
    try {
      const a = analyzeBotBuying(focusBotId, { allowSyncTf: true });
      if (a) {
        parts.push(`\n### Focus bot: ${a.bot.displayName}`);
        parts.push(
          `- DNA persona: ${a.bot.personaLabel || a.bot.persona}; stage: ${a.buyerStage}`
        );
        parts.push(
          `- Funnel V${a.funnel.views}→C${a.funnel.addToCart}→X${a.funnel.beginCheckout}→P${a.funnel.purchase} (view→buy ${a.funnel.viewToPurchase}%)`
        );
        parts.push(
          `- Spend ${a.commerce.totalSpent.formatted}, orders ${a.commerce.orders}, intent ${a.scores.purchaseIntent}, risk ${a.scores.abandonRisk}`
        );
        if (a.transformer?.available || a.transformer?.label) {
          parts.push(
            `- Tiny TF: ${a.transformer.label} (${Math.round((a.transformer.confidence || 0) * 100)}%)`
          );
        }
        if (a.insights?.[0]) parts.push(`- Insight: ${a.insights[0]}`);
      }
    } catch (e) {
      parts.push(`(bot focus failed: ${e.message})`);
    }
  }

  if (focusProfileKey) {
    try {
      const p = getProfile(focusProfileKey);
      if (p) {
        parts.push(`\n### Focus profile: ${p.displayName || focusProfileKey}`);
        parts.push(
          `- Persona ${p.personaLabel || p.persona}, intent ${p.scores?.purchaseIntent}, risk ${p.scores?.abandonRisk}, events ${p.eventCount}`
        );
        if (p.journeyPath) {
          parts.push(`- Journey (truncated): ${String(p.journeyPath).slice(0, 280)}`);
        }
      }
    } catch (e) {
      parts.push(`(profile focus failed: ${e.message})`);
    }
  }

  // Light bot name resolution from question
  if (question && !focusBotId) {
    const q = question.toLowerCase();
    const bots = db
      .prepare(`SELECT id, display_name FROM bots ORDER BY last_run_at DESC LIMIT 200`)
      .all();
    const hit = bots.find((b) => b.display_name && q.includes(b.display_name.toLowerCase()));
    if (hit) {
      try {
        const a = analyzeBotBuying(hit.id, { allowSyncTf: false });
        if (a) {
          parts.push(`\n### Mentioned bot: ${a.bot.displayName}`);
          parts.push(
            `stage=${a.buyerStage}, view→buy=${a.funnel.viewToPurchase}%, spend=${a.commerce.totalSpent.formatted}`
          );
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Cap context size
  let text = parts.join('\n');
  if (text.length > 14000) text = text.slice(0, 14000) + '\n…(truncated)';
  return text;
}

async function callGrok({ system, messages }) {
  const key = getXaiKey();
  if (!key) {
    const err = new Error('XAI_API_KEY not set or invalid');
    err.code = 'NO_KEY';
    throw err;
  }

  const body = {
    model: XAI_MODEL,
    temperature: 0.65,
    max_tokens: 1200,
    messages: [{ role: 'system', content: system }, ...messages],
  };

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (typeof data.error === 'string' && data.error) ||
      data.error?.message ||
      data.message ||
      data.code ||
      `xAI HTTP ${res.status}`;
    const err = new Error(String(detail));
    err.code = 'XAI_ERROR';
    err.status = res.status;
    throw err;
  }
  const content =
    data.choices?.[0]?.message?.content ||
    data.output_text ||
    data.choices?.[0]?.text ||
    '';
  return {
    content: String(content).trim(),
    model: data.model || XAI_MODEL,
    provider: 'xai',
    usage: data.usage || null,
  };
}

async function callGemini({ system, messages }) {
  const key = getGeminiKey();
  if (!key) {
    const err = new Error('GEMINI_API_KEY not set or invalid');
    err.code = 'NO_KEY';
    throw err;
  }

  // Convert OpenAI-style history to Gemini contents
  const contents = [];
  for (const m of messages) {
    if (!m?.content) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    // Gemini requires alternating user/model; merge consecutive same roles
    if (contents.length && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += '\n' + m.content;
    } else {
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  if (!contents.length) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }
  // Must start with user
  if (contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 1200,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data.error?.message ||
      data.message ||
      (typeof data.error === 'string' ? data.error : null) ||
      `Gemini HTTP ${res.status}`;
    const err = new Error(String(detail));
    err.code = 'GEMINI_ERROR';
    err.status = res.status;
    throw err;
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p) => p.text || '').join('').trim();
  if (!content) {
    const err = new Error('Gemini returned an empty reply (safety block or empty candidate).');
    err.code = 'GEMINI_EMPTY';
    throw err;
  }
  return {
    content,
    model: GEMINI_MODEL,
    provider: 'gemini',
    usage: data.usageMetadata || null,
  };
}

async function callLlm({ system, messages, preferredProvider }) {
  const provider = resolveProvider(preferredProvider);
  if (!provider) {
    const err = new Error(
      'No cloud chat model configured. Using local advisor, or set GEMINI_API_KEY / XAI_API_KEY.'
    );
    err.code = 'NO_KEY';
    throw err;
  }
  if (provider === 'gemini') return callGemini({ system, messages });
  return callGrok({ system, messages });
}

/** Skilled offline fallback when no LLM key — still useful, not dumb templates */
function localAdvisorReply(userText, ctx) {
  const q = (userText || '').toLowerCase();
  const lines = [];

  lines.push(
    "I'm Trove Intel in **local advisor mode** (no Grok/Gemini key). I still use your live analytics — just less fluid than a full LLM."
  );
  lines.push('');

  if (/know|learn|what does|what do you|smart|accuracy|train/.test(q)) {
    const knowLine = ctx
      .split('\n')
      .filter((l) => l.startsWith('- I ') || l.includes('accuracy') || l.includes('experience'))
      .slice(0, 6);
    lines.push('**What the system knows right now:**');
    if (knowLine.length) lines.push(...knowLine);
    else lines.push('- Open **What AI knows** for the full dump; auto-train keeps it fresh.');
    lines.push('');
    lines.push(
      'The Tiny Transformer labels shopper *paths* into personas. Buyer **stages** (loyal / almost-buyer / researcher) come from hard funnel events and are usually more actionable.'
    );
  } else if (/buy|funnel|abandon|leak|revenue|convert/.test(q)) {
    lines.push('**Buyer behavior focus:**');
    const buyLines = ctx
      .split('\n')
      .filter((l) => l.includes('**') || l.includes('view→') || l.includes('almost') || l.includes('revenue'))
      .slice(0, 8);
    lines.push(...(buyLines.length ? buyLines : ['- See Admin → Buyer behavior for the full funnel.']));
    lines.push('');
    lines.push(
      'Practical move: attack the worst drop-off first (often cart→checkout or checkout→buy), and work the almost-buyer list.'
    );
  } else if (/predict|future|will|likely|risk/.test(q)) {
    lines.push('**Forecasts (probabilistic):**');
    const pLines = ctx
      .split('\n')
      .filter((l) => /Forecast|near-term|abandon|recover|buy chance/i.test(l))
      .slice(0, 8);
    lines.push(...(pLines.length ? pLines : ['- See Admin → Predictions.']));
  } else if (/bot|persona|profile/.test(q)) {
    lines.push(
      'I can talk about any bot if you name them, or open their page under Active bots. For the whole market, use Buyer behavior + What AI knows.'
    );
  } else {
    lines.push(
      "Ask me things like: *Where are we leaking buyers?* · *What does the model know?* · *Who should we recover first?* · *How is high-intent doing?*"
    );
    lines.push('');
    lines.push('Quick snapshot from grounded data:');
    lines.push(
      ...ctx
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .slice(0, 6)
    );
  }

  lines.push('');
  lines.push(
    '_Fluent chat needs a cloud key (Gemini / xAI) in Trove Chat settings. Analytics above are live either way._'
  );

  return lines.join('\n');
}

/**
 * Main entry: chat with Trove Intel.
 */
async function chat({
  message,
  sessionId = 'default',
  focusBotId = null,
  focusProfileKey = null,
  provider: chatPreferredProvider = null,
} = {}) {
  const text = String(message || '').trim();
  if (!text) {
    throw Object.assign(new Error('Message is empty'), { status: 400 });
  }

  const session = getSession(sessionId);
  const grounded = buildGroundedContext({
    focusBotId,
    focusProfileKey,
    question: text,
  });
  const system = buildSystemPrompt(grounded);

  session.messages.push({ role: 'user', content: text });
  // keep last N
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  let reply;
  let provider = 'local';
  let model = 'trove-local-advisor';
  let usage = null;

  const canLlm = hasChatLlm();

  if (canLlm && resolveProvider(chatPreferredProvider)) {
    try {
      const out = await callLlm({
        system,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        preferredProvider: chatPreferredProvider,
      });
      reply = out.content;
      provider = out.provider || 'llm';
      model = out.model;
      usage = out.usage;
    } catch (e) {
      reply =
        localAdvisorReply(text, grounded) +
        `\n\n_(LLM call failed: ${e.message}. Showing local advisor instead.)_`;
      provider = 'local-fallback';
    }
  } else {
    reply = localAdvisorReply(text, grounded);
  }

  session.messages.push({ role: 'assistant', content: reply });

  const active = resolveProvider(chatPreferredProvider);
  return {
    reply,
    provider,
    model,
    usage,
    sessionId,
    groundedPreview: grounded.slice(0, 500),
    hasLlm: !!active || provider === 'gemini' || provider === 'xai',
    activeProvider: active,
    tips: !canLlm
      ? 'Using local advisor. Optional: paste a Gemini or xAI key for fluent chat.'
      : null,
  };
}

async function getChatStatus() {
  const path = require('path');
  const xai = hasXaiKey();
  const gem = hasGeminiKey();
  const active = resolveProvider(null);

  let keyHint = 'Local advisor (free, no cloud LLM)';
  if (active === 'gemini') {
    const k = getGeminiKey();
    keyHint = `Gemini connected (${k.slice(0, 6)}… len ${k.length})`;
  } else if (active === 'xai') {
    const k = getXaiKey();
    keyHint = `Grok/xAI connected (${k.slice(0, 6)}… len ${k.length})`;
  } else if (process.env.GEMINI_API_KEY || process.env.XAI_API_KEY) {
    keyHint = 'Cloud key present but invalid — local advisor is active';
  }

  return {
    hasLlm: !!active,
    provider: active,
    model:
      active === 'gemini'
        ? GEMINI_MODEL
        : active === 'xai'
          ? XAI_MODEL
          : 'trove-local-advisor',
    providers: {
      gemini: {
        configured: gem,
        model: GEMINI_MODEL,
        console: 'https://aistudio.google.com/apikey',
        free: false,
      },
      xai: {
        configured: xai,
        model: XAI_MODEL,
        console: 'https://console.x.ai',
        free: false,
      },
      local: {
        configured: true,
        model: 'trove-local-advisor',
        free: true,
        tip: 'No LLM — grounded template advisor over live analytics.',
      },
    },
    baseUrl: active === 'gemini' ? GEMINI_BASE : XAI_BASE,
    name: 'Trove Intel',
    keyHint,
    envFile: path.join(__dirname, '..', '.env'),
    keyFile: path.join(__dirname, '..', 'XAI_API_KEY.txt'),
    geminiKeyFile: path.join(__dirname, '..', 'GEMINI_API_KEY.txt'),
    description:
      'Advisor grounded in Tiny Transformer + buyer analytics. Free path: local advisor. Optional cloud keys for fluent chat.',
  };
}

function clearSession(sessionId) {
  sessions.delete(sessionId || 'default');
  return { ok: true };
}

/**
 * Save API key from admin UI into XAI_API_KEY.txt and process.env.
 * Validates with xAI /models before accepting.
 */
async function saveApiKey(rawKey, providerHint = 'auto') {
  const fs = require('fs');
  const path = require('path');
  let key = cleanKey(rawKey);
  if (!key || key.length < 16) {
    return { ok: false, error: 'Key is empty or too short.' };
  }
  if (isPlaceholderKey(key)) {
    return { ok: false, error: 'That still looks like placeholder text, not a real key.' };
  }

  // Detect provider from hint or key shape
  let provider = String(providerHint || 'auto').toLowerCase();
  if (provider === 'auto' || provider === 'detect') {
    if (/^AIza/i.test(key)) provider = 'gemini';
    else if (/^xai-/i.test(key)) provider = 'xai';
    else if (process.env.CHAT_PROVIDER) provider = process.env.CHAT_PROVIDER;
    else provider = 'gemini'; // default try gemini for non-xai shaped keys
  }
  if (provider === 'google') provider = 'gemini';
  if (provider === 'grok') provider = 'xai';

  // Verify with provider
  try {
    if (provider === 'gemini') {
      const url = `${GEMINI_BASE}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.error?.message || `HTTP ${res.status}`;
        return {
          ok: false,
          error: `Gemini rejected this key: ${detail}. Get a key at https://aistudio.google.com/apikey`,
        };
      }
      process.env.GEMINI_API_KEY = key;
      process.env.CHAT_PROVIDER = process.env.CHAT_PROVIDER || 'gemini';
      const keyFile = path.join(__dirname, '..', 'GEMINI_API_KEY.txt');
      fs.writeFileSync(keyFile, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
      upsertEnvKey('GEMINI_API_KEY', key);
      upsertEnvKey('CHAT_PROVIDER', 'gemini');
      return {
        ok: true,
        message: 'Gemini key saved and verified. Trove Chat will use Gemini.',
        provider: 'gemini',
        status: await getChatStatus(),
      };
    }

    // xAI
    const res = await fetch(`${XAI_BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        (typeof data.error === 'string' && data.error) ||
        data.error?.message ||
        `HTTP ${res.status}`;
      return {
        ok: false,
        error: `xAI rejected this key: ${detail}. Get a key at https://console.x.ai`,
      };
    }
    process.env.XAI_API_KEY = key;
    process.env.CHAT_PROVIDER = process.env.CHAT_PROVIDER || 'xai';
    const keyFile = path.join(__dirname, '..', 'XAI_API_KEY.txt');
    fs.writeFileSync(keyFile, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
    upsertEnvKey('XAI_API_KEY', key);
    upsertEnvKey('CHAT_PROVIDER', 'xai');
    return {
      ok: true,
      message: 'xAI/Grok key saved and verified. Trove Chat will use Grok.',
      provider: 'xai',
      status: await getChatStatus(),
    };
  } catch (e) {
    return { ok: false, error: `Could not verify key: ${e.message}` };
  }
}

/** Switch Trove Chat to the free local advisor (no cloud LLM). */
async function useLocalAdvisor() {
  process.env.CHAT_PROVIDER = 'local';
  try {
    upsertEnvKey('CHAT_PROVIDER', 'local');
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    message: 'Using local advisor (no cloud LLM). Grounded in your live analytics.',
    provider: null,
    status: await getChatStatus(),
  };
}

function upsertEnvKey(name, value) {
  const fs = require('fs');
  const path = require('path');
  const envFile = path.join(__dirname, '..', '.env');
  let env = '';
  try {
    env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  } catch {
    env = '';
  }
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(env)) env = env.replace(re, `${name}=${value}`);
  else env = `${env.trim()}\n${name}=${value}\n`;
  fs.writeFileSync(envFile, env, { encoding: 'utf8', mode: 0o600 });
}

module.exports = {
  chat,
  getChatStatus,
  clearSession,
  saveApiKey,
  useLocalAdvisor,
  hasXaiKey,
  hasGeminiKey,
  hasAnyLlmKey,
  resolveProvider,
  buildGroundedContext,
};
