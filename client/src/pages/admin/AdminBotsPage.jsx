import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import PlayAllBotsButton from '../../components/PlayAllBotsButton';

const EMPTY_MIX = {
  window_shopper: 1,
  product_browser: 1,
  bargain_hunter: 1,
  cart_abandons: 1,
  high_intent: 1,
  loyal_buyer: 1,
  impulse_buyer: 1,
  explorer: 1,
};

export default function AdminBotsPage() {
  const [bots, setBots] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [botPassword, setBotPassword] = useState('botpass123');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    mode: 'batch',
    count: 8,
    persona: 'high_intent',
    diversity: 0.6,
    runSessions: 2,
    useMix: true,
    name: '',
    preferredCategories: [],
  });

  const load = () => {
    Promise.all([api.adminBots(), api.adminBotPersonas()])
      .then(([b, p]) => {
        setBots(b.bots || []);
        setBotPassword(b.botPassword || 'botpass123');
        setPersonas(p.personas || []);
        setCategories(p.categories || []);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      if (form.mode === 'batch') {
        const body = {
          batch: true,
          count: Number(form.count) || 5,
          diversity: Number(form.diversity),
          runSessions: Number(form.runSessions) || 0,
        };
        if (form.useMix) body.personaMix = EMPTY_MIX;
        else body.persona = form.persona;
        const d = await api.adminCreateBot(body);
        setMsg(`Created ${d.count || d.bots?.length || 0} bots with unique DNA.`);
      } else {
        const d = await api.adminCreateBot({
          persona: form.persona,
          diversity: Number(form.diversity),
          name: form.name || undefined,
          preferredCategories: form.preferredCategories,
          runSessions: Number(form.runSessions) || 0,
        });
        setMsg(`Created bot ${d.bot?.displayName || d.bot?.email || ''}`);
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runOne = async (id) => {
    setBusy(true);
    setError('');
    try {
      const d = await api.adminRunBot(id, 1);
      const r = d.results?.[0];
      setMsg(
        `Ran session: ${r?.events || 0} events` +
          (r?.purchased ? `, purchased ${r.order?.orderId}` : ', no purchase')
      );
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this bot and its user account?')) return;
    setBusy(true);
    try {
      await api.adminDeleteBot(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCat = (slug) => {
    setForm((f) => {
      const has = f.preferredCategories.includes(slug);
      return {
        ...f,
        preferredCategories: has
          ? f.preferredCategories.filter((c) => c !== slug)
          : [...f.preferredCategories, slug],
      };
    });
  };

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>Manage bots</h1>
          <p>
            Create synthetic shoppers and edit DNA. See who is live under{' '}
            <Link to="/admin/bots/active">Active bots</Link>
            {' · '}
            train the model on <Link to="/admin/ai">Tiny AI</Link>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/admin/bots/active" className="ad-btn">
            Active fleet
          </Link>
          <Link to="/admin/live" className="ad-btn">
            Live feed
          </Link>
        </div>
      </div>

      <PlayAllBotsButton
        botCount={bots.length}
        defaultSessions={1}
        onFinished={() => {
          setMsg('Fleet play finished — profiles and AI updated.');
          load();
        }}
      />

      {error && <div className="ad-alert">{error}</div>}
      {msg && (
        <div className="ad-alert" style={{ background: 'rgba(62,207,142,0.12)', color: '#3ecf8e' }}>
          {msg}
        </div>
      )}

      <div className="ad-grid-2">
        <form className="ad-card" onSubmit={create}>
          <h2>Add bots</h2>

          <div className="ad-filters" style={{ marginBottom: '0.75rem' }}>
            <label className="ad-muted" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="radio"
                checked={form.mode === 'batch'}
                onChange={() => setForm((f) => ({ ...f, mode: 'batch' }))}
              />
              Batch factory
            </label>
            <label className="ad-muted" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="radio"
                checked={form.mode === 'single'}
                onChange={() => setForm((f) => ({ ...f, mode: 'single' }))}
              />
              Single bot
            </label>
          </div>

          {form.mode === 'batch' ? (
            <>
              <label className="ad-muted" style={{ display: 'block', marginBottom: '0.65rem' }}>
                How many
                <input
                  type="number"
                  min={1}
                  value={form.count}
                  onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                />
              </label>
              <label className="ad-muted" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem' }}>
                <input
                  type="checkbox"
                  checked={form.useMix}
                  onChange={(e) => setForm((f) => ({ ...f, useMix: e.target.checked }))}
                />
                Balanced persona mix (recommended — not identical)
              </label>
              {!form.useMix && (
                <label className="ad-muted" style={{ display: 'block', marginBottom: '0.65rem' }}>
                  Persona
                  <select
                    value={form.persona}
                    onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                    style={{ display: 'block', width: '100%', marginTop: 4 }}
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <label className="ad-muted" style={{ display: 'block', marginBottom: '0.65rem' }}>
                Display name (optional)
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Auto-generated if empty"
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                />
              </label>
              <label className="ad-muted" style={{ display: 'block', marginBottom: '0.65rem' }}>
                Persona
                <select
                  value={form.persona}
                  onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: 4 }}
                >
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ marginBottom: '0.65rem' }}>
                <div className="ad-muted" style={{ marginBottom: 6 }}>
                  Preferred categories (optional)
                </div>
                <div className="ad-chip-list">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="ad-chip"
                      style={{
                        cursor: 'pointer',
                        borderColor: form.preferredCategories.includes(c)
                          ? '#7c6cf0'
                          : undefined,
                        color: form.preferredCategories.includes(c) ? '#c4bcff' : undefined,
                      }}
                      onClick={() => toggleCat(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <label className="ad-muted" style={{ display: 'block', marginBottom: '0.65rem' }}>
            Diversity {Number(form.diversity).toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.diversity}
              onChange={(e) => setForm((f) => ({ ...f, diversity: e.target.value }))}
              style={{ display: 'block', width: '100%' }}
            />
            <span style={{ fontSize: '0.8rem' }}>
              Higher = more unique DNA within the same persona
            </span>
          </label>

          <label className="ad-muted" style={{ display: 'block', marginBottom: '0.85rem' }}>
            Auto-run sessions after create
            <input
              type="number"
              min={0}
              max={10}
              value={form.runSessions}
              onChange={(e) => setForm((f) => ({ ...f, runSessions: e.target.value }))}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>

          <button type="submit" className="ad-btn primary" disabled={busy}>
            {busy ? 'Working…' : form.mode === 'batch' ? 'Create bot batch' : 'Create bot'}
          </button>
          <p className="ad-muted" style={{ fontSize: '0.8rem', marginTop: '0.75rem' }}>
            Bot login password: <code>{botPassword}</code>
          </p>
        </form>

        <div className="ad-card">
          <h2>How behavior works</h2>
          <p className="ad-muted" style={{ fontSize: '0.9rem' }}>
            Each bot is a real user account with a <strong>DNA profile</strong>: cart/checkout/purchase
            probabilities, search depth, category bias, price preference, and a unique seed.
          </p>
          <p className="ad-muted" style={{ fontSize: '0.9rem' }}>
            When you run a session, the bot: <strong>login → search → view products → maybe cart → maybe purchase</strong>.
            Events feed the consumer intelligence engine.
          </p>
          <p className="ad-muted" style={{ fontSize: '0.9rem' }}>
            Edit any bot to tune its funnel probabilities without making the fleet identical.
          </p>
          <h3 style={{ marginTop: '1rem' }}>Personas</h3>
          <div className="ad-chip-list">
            {personas.map((p) => (
              <span key={p.id} className="ad-chip" title={p.description}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>
          Fleet ({bots.length})
        </h2>
        <table className="ad-table">
          <thead>
            <tr>
              <th>Bot</th>
              <th>Persona</th>
              <th>DNA snapshot</th>
              <th>Sessions</th>
              <th>Last run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bots.map((b) => (
              <tr key={b.id}>
                <td>
                  <Link to={`/admin/bots/${b.id}`}>
                    <strong>{b.displayName}</strong>
                  </Link>
                  <div className="ad-mono ad-muted">{b.email}</div>
                </td>
                <td>
                  <span className="ad-pill">{b.personaLabel || b.persona}</span>
                </td>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  add {(b.dna.pAddToCart * 100).toFixed(0)}% · chk{' '}
                  {(b.dna.pBeginCheckout * 100).toFixed(0)}% · buy{' '}
                  {(b.dna.pPurchase * 100).toFixed(0)}%
                  <br />
                  views {b.dna.productViews?.[0]}–{b.dna.productViews?.[1]} ·{' '}
                  {b.dna.priceBias} price
                </td>
                <td>{b.sessionsRun}</td>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  {b.lastRunAt || '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    className="ad-btn"
                    disabled={busy}
                    onClick={() => runOne(b.id)}
                  >
                    Run
                  </button>{' '}
                  <Link className="ad-btn" to={`/admin/bots/${b.id}`}>
                    Edit
                  </Link>{' '}
                  <button
                    type="button"
                    className="ad-btn ghost"
                    disabled={busy}
                    onClick={() => remove(b.id)}
                  >
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!bots.length && (
          <p className="ad-muted">No bots yet. Create a batch to seed the marketplace with shoppers.</p>
        )}
      </div>
    </div>
  );
}
