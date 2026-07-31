import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, hint }) {
  return (
    <label className="ad-muted" style={{ display: 'block', marginBottom: '0.85rem' }}>
      {label}: <strong style={{ color: '#e8eaf2' }}>{Number(value).toFixed(2)}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ display: 'block', width: '100%' }}
      />
      {hint && <span style={{ fontSize: '0.78rem' }}>{hint}</span>}
    </label>
  );
}

export default function AdminBotDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bot, setBot] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dna, setDna] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState(1);
  const [lastRun, setLastRun] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const load = () => {
    Promise.all([
      api.adminBot(id),
      api.adminBotPersonas(),
      api.adminBotAnalysis(id).catch(() => null),
    ])
      .then(([b, p, a]) => {
        setBot(b.bot);
        setDna({ ...b.bot.dna });
        setName(b.bot.displayName);
        setPersonas(p.personas || []);
        setCategories(p.categories || []);
        setAnalysis(a?.analysis || null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (key, value) => setDna((d) => ({ ...d, [key]: value }));

  const toggleCat = (slug) => {
    setDna((d) => {
      const cur = d.preferredCategories || [];
      const has = cur.includes(slug);
      return {
        ...d,
        preferredCategories: has ? cur.filter((c) => c !== slug) : [...cur, slug],
      };
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const d = await api.adminUpdateBot(id, {
        displayName: name,
        persona: dna.persona,
        dna,
      });
      setBot(d.bot);
      setDna({ ...d.bot.dna });
      setMsg('Behavior saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const d = await api.adminRunBot(id, sessions);
      setLastRun(d.results);
      setBot(d.bot);
      setMsg(`Completed ${d.results?.length || 0} session(s).`);
      const a = await api.adminBotAnalysis(id).catch(() => null);
      setAnalysis(a?.analysis || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !bot) return <div className="ad-alert">{error}</div>;
  if (!bot || !dna) return <p className="ad-muted">Loading bot…</p>;

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <p className="ad-muted" style={{ margin: 0 }}>
            <Link to="/admin/bots">Bots</Link> / edit
          </p>
          <h1>{bot.displayName}</h1>
          <p>
            <span className="ad-pill teal">BOT</span>{' '}
            <span className="ad-pill">{bot.personaLabel}</span>
            <span className="ad-mono"> · {bot.email}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="number"
            min={1}
            max={10}
            value={sessions}
            onChange={(e) => setSessions(e.target.value)}
            style={{ width: 64 }}
          />
          <button type="button" className="ad-btn primary" onClick={run} disabled={busy}>
            Run sessions
          </button>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}
      {msg && (
        <div className="ad-alert" style={{ background: 'rgba(62,207,142,0.12)', color: '#3ecf8e' }}>
          {msg}
        </div>
      )}

      <div className="ad-grid-2">
        <form className="ad-card" onSubmit={save}>
          <h2>Identity</h2>
          <label className="ad-muted" style={{ display: 'block', marginBottom: '0.75rem' }}>
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>
          <label className="ad-muted" style={{ display: 'block', marginBottom: '0.75rem' }}>
            Persona template
            <select
              value={dna.persona}
              onChange={(e) => setField('persona', e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
            Login password for this bot account: <code>{bot.passwordHint}</code>
            <br />
            Sessions run: {bot.sessionsRun} · Last: {bot.lastRunAt || 'never'}
          </p>

          <h2 style={{ marginTop: '1.25rem' }}>Funnel behavior</h2>
          <Slider
            label="P(add to cart | product view)"
            value={dna.pAddToCart}
            onChange={(v) => setField('pAddToCart', v)}
          />
          <Slider
            label="P(begin checkout | has cart)"
            value={dna.pBeginCheckout}
            onChange={(v) => setField('pBeginCheckout', v)}
          />
          <Slider
            label="P(purchase | checkout)"
            value={dna.pPurchase}
            onChange={(v) => setField('pPurchase', v)}
          />
          <Slider
            label="Deal seeking"
            value={dna.dealSeeking}
            onChange={(v) => setField('dealSeeking', v)}
          />
          <Slider
            label="Category focus"
            value={dna.categoryFocus}
            onChange={(v) => setField('categoryFocus', v)}
            hint="Higher = stick to preferred categories"
          />

          <h2 style={{ marginTop: '1rem' }}>Session shape</h2>
          <div className="ad-filters">
            <label className="ad-muted">
              Searches min
              <input
                type="number"
                min={0}
                max={12}
                value={dna.searchCount?.[0] ?? 0}
                onChange={(e) =>
                  setField('searchCount', [Number(e.target.value), dna.searchCount?.[1] ?? 2])
                }
                style={{ display: 'block', width: 80 }}
              />
            </label>
            <label className="ad-muted">
              Searches max
              <input
                type="number"
                min={0}
                max={12}
                value={dna.searchCount?.[1] ?? 2}
                onChange={(e) =>
                  setField('searchCount', [dna.searchCount?.[0] ?? 0, Number(e.target.value)])
                }
                style={{ display: 'block', width: 80 }}
              />
            </label>
            <label className="ad-muted">
              Views min
              <input
                type="number"
                min={1}
                max={15}
                value={dna.productViews?.[0] ?? 1}
                onChange={(e) =>
                  setField('productViews', [Number(e.target.value), dna.productViews?.[1] ?? 3])
                }
                style={{ display: 'block', width: 80 }}
              />
            </label>
            <label className="ad-muted">
              Views max
              <input
                type="number"
                min={1}
                max={15}
                value={dna.productViews?.[1] ?? 3}
                onChange={(e) =>
                  setField('productViews', [dna.productViews?.[0] ?? 1, Number(e.target.value)])
                }
                style={{ display: 'block', width: 80 }}
              />
            </label>
            <label className="ad-muted">
              Max cart items
              <input
                type="number"
                min={1}
                max={8}
                value={dna.maxCartItems ?? 2}
                onChange={(e) => setField('maxCartItems', Number(e.target.value))}
                style={{ display: 'block', width: 80 }}
              />
            </label>
            <label className="ad-muted">
              Price bias
              <select
                value={dna.priceBias || 'any'}
                onChange={(e) => setField('priceBias', e.target.value)}
                style={{ display: 'block' }}
              >
                <option value="any">Any</option>
                <option value="low">Low</option>
                <option value="mid">Mid</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <h2 style={{ marginTop: '1rem' }}>Preferred categories</h2>
          <div className="ad-chip-list">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className="ad-chip"
                style={{
                  cursor: 'pointer',
                  borderColor: (dna.preferredCategories || []).includes(c) ? '#7c6cf0' : undefined,
                }}
                onClick={() => toggleCat(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="ad-btn primary" disabled={busy}>
              Save behavior
            </button>
            <Link to="/admin/bots" className="ad-btn ghost">
              Back
            </Link>
            <button
              type="button"
              className="ad-btn ghost"
              onClick={async () => {
                if (!confirm('Delete bot?')) return;
                await api.adminDeleteBot(id);
                navigate('/admin/bots');
              }}
            >
              Delete
            </button>
          </div>
        </form>

        <div>
          <div className="ad-card">
            <h2>Consumer profile</h2>
            <p className="ad-muted">
              After runs, open this bot in Profiles as{' '}
              <Link to={`/admin/profiles/${encodeURIComponent('user:' + bot.userId)}`}>
                user:{bot.userId}
              </Link>
            </p>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Seed <code>{dna.seed}</code> keeps this bot’s randomness distinct from others.
            </p>
          </div>

          {lastRun && (
            <div className="ad-card" style={{ marginTop: '1rem' }}>
              <h2>Last run results</h2>
              {lastRun.map((r, i) => (
                <div key={i} className="ad-insight" style={{ marginBottom: '0.5rem' }}>
                  Session {i + 1}: {r.events} events
                  {r.purchased
                    ? ` · purchased ${r.order?.orderId} (${r.order?.total?.formatted})`
                    : ' · no purchase'}
                  <div className="ad-mono" style={{ marginTop: 4, fontSize: '0.75rem' }}>
                    {(r.actions || []).join(' → ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="ad-card" style={{ marginTop: '1rem' }}>
            <h2>DNA JSON</h2>
            <pre
              className="ad-journey"
              style={{ whiteSpace: 'pre-wrap', maxHeight: 200 }}
            >
              {JSON.stringify(dna, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* High-detail buying behavior analysis */}
      {analysis && (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="ad-card">
            <h2>AI buying-behavior analysis</h2>
            <p className="ad-muted">
              Stage:{' '}
              <span className="ad-pill teal">{analysis.buyerStage}</span>
              {analysis.transformer?.available && (
                <>
                  {' '}
                  · Tiny TF:{' '}
                  <span className="ad-pill">
                    {analysis.transformer.label} (
                    {((analysis.transformer.confidence || 0) * 100).toFixed(0)}%)
                  </span>
                </>
              )}
            </p>

            <div className="ad-kpi-grid" style={{ marginTop: '0.75rem' }}>
              <div className="ad-kpi">
                <div className="label">Purchase intent</div>
                <div className="value">{analysis.scores.purchaseIntent}</div>
              </div>
              <div className="ad-kpi">
                <div className="label">Abandon risk</div>
                <div className="value">{analysis.scores.abandonRisk}</div>
              </div>
              <div className="ad-kpi">
                <div className="label">Value score</div>
                <div className="value">{analysis.scores.valueScore}</div>
              </div>
              <div className="ad-kpi">
                <div className="label">Lifetime spent</div>
                <div className="value" style={{ fontSize: '1.15rem' }}>
                  {analysis.commerce.totalSpent.formatted}
                </div>
                <div className="hint">
                  {analysis.commerce.orders} orders · AOV {analysis.commerce.aov.formatted}
                </div>
              </div>
              <div className="ad-kpi">
                <div className="label">View → buy</div>
                <div className="value">{analysis.funnel.viewToPurchase}%</div>
              </div>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Conversion funnel</h3>
            <div className="ad-bar-row">
              <span>Views</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${Math.min(100, analysis.funnel.views * 5)}%`,
                    background: '#7c6cf0',
                  }}
                />
              </div>
              <span>{analysis.funnel.views}</span>
            </div>
            <div className="ad-bar-row">
              <span>Add cart ({analysis.funnel.viewToCart}%)</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${analysis.funnel.viewToCart}%`,
                    background: '#3dd6c6',
                  }}
                />
              </div>
              <span>{analysis.funnel.addToCart}</span>
            </div>
            <div className="ad-bar-row">
              <span>Checkout ({analysis.funnel.cartToCheckout}%)</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${analysis.funnel.cartToCheckout}%`,
                    background: '#f0a06a',
                  }}
                />
              </div>
              <span>{analysis.funnel.beginCheckout}</span>
            </div>
            <div className="ad-bar-row">
              <span>Purchase ({analysis.funnel.checkoutToPurchase}%)</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${analysis.funnel.checkoutToPurchase}%`,
                    background: '#3ecf8e',
                  }}
                />
              </div>
              <span>{analysis.funnel.purchase}</span>
            </div>

            <div className="ad-grid-2" style={{ marginTop: '1rem' }}>
              <div>
                <h3>Insights</h3>
                {(analysis.insights || []).map((t) => (
                  <div key={t} className="ad-insight">
                    {t}
                  </div>
                ))}
                <h3 style={{ marginTop: '0.75rem' }}>Recommendations</h3>
                {(analysis.recommendations || []).map((t) => (
                  <div key={t} className="ad-insight rec">
                    {t}
                  </div>
                ))}
              </div>
              <div>
                <h3>DNA vs observed</h3>
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Designed</th>
                      <th>Observed</th>
                      <th>Drift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['pAddToCart', 'pBeginCheckout', 'pPurchase'].map((k) => (
                      <tr key={k}>
                        <td className="ad-mono">{k}</td>
                        <td>
                          {(
                            (analysis.dnaAlignment.designed[k] || 0) * 100
                          ).toFixed(0)}
                          %
                        </td>
                        <td>
                          {(
                            (analysis.dnaAlignment.observed[k] || 0) * 100
                          ).toFixed(0)}
                          %
                        </td>
                        <td>
                          {(
                            (analysis.dnaAlignment.drift[
                              k === 'pAddToCart'
                                ? 'addToCart'
                                : k === 'pBeginCheckout'
                                  ? 'checkout'
                                  : 'purchase'
                            ] || 0) * 100
                          ).toFixed(0)}
                          pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3 style={{ marginTop: '0.75rem' }}>Tiny Transformer probs</h3>
                {analysis.transformer?.available ? (
                  (analysis.transformer.probs || []).map((p) => (
                    <div key={p.label} className="ad-bar-row">
                      <span className="ad-mono" style={{ fontSize: '0.75rem' }}>
                        {p.label}
                      </span>
                      <div className="ad-bar-track">
                        <div
                          className="ad-bar-fill"
                          style={{ width: `${(p.prob || 0) * 100}%` }}
                        />
                      </div>
                      <span>{((p.prob || 0) * 100).toFixed(0)}%</span>
                    </div>
                  ))
                ) : (
                  <p className="ad-muted">
                    {analysis.transformer?.reason || 'Train model on Tiny AI page'}
                  </p>
                )}
              </div>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Categories viewed</h3>
            <div className="ad-chip-list">
              {(analysis.taste.viewCategories || []).map((c) => (
                <span key={c.name} className="ad-chip">
                  {c.name} · {c.count}
                </span>
              ))}
            </div>

            <h3 style={{ marginTop: '1rem' }}>Purchased items</h3>
            {(analysis.taste.boughtProducts || []).length === 0 ? (
              <p className="ad-muted">No purchases yet.</p>
            ) : (
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Total</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.taste.boughtProducts.map((p, i) => (
                    <tr key={`${p.productId}-${i}`}>
                      <td>
                        {p.title}
                        <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                          {p.brand}
                        </div>
                      </td>
                      <td>{p.qty}</td>
                      <td>{p.lineTotal.formatted}</td>
                      <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                        {p.placedAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ marginTop: '1rem' }}>Recent sessions</h3>
            <ul className="ad-timeline">
              {(analysis.sessions || []).map((s) => (
                <li key={s.sessionId}>
                  <div className="time">{s.startedAt}</div>
                  <div>
                    <span className="type">
                      {s.purchased
                        ? 'purchase'
                        : s.addedCart
                          ? 'cart'
                          : 'browse'}
                    </span>
                    <div className="meta">
                      {s.events} events · {s.productViews} views · {s.searches}{' '}
                      searches
                      {s.purchased ? ' · bought' : ''}
                    </div>
                    <div className="ad-mono" style={{ fontSize: '0.7rem', opacity: 0.7 }}>
                      {s.path?.slice(0, 120)}
                      {(s.path?.length || 0) > 120 ? '…' : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
