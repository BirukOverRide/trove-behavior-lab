import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAdminLiveStream } from '../../hooks/useAdminLiveStream';
import PlayAllBotsButton from '../../components/PlayAllBotsButton';

function MoodBadge({ mood }) {
  if (!mood) return null;
  const color =
    mood.score >= 70 ? 'ok' : mood.score >= 45 ? 'teal' : mood.score >= 30 ? 'warn' : 'danger';
  return (
    <span className={`ad-pill ${color}`} title={mood.detail}>
      {mood.label} · {mood.score}
    </span>
  );
}

function FunnelBars({ funnel }) {
  if (!funnel) return null;
  const max = Math.max(funnel.views, funnel.carts, funnel.checkouts, funnel.purchases, 1);
  const row = (label, n, color) => (
    <div className="ad-bar-row" key={label}>
      <span>{label}</span>
      <div className="ad-bar-track">
        <div
          className="ad-bar-fill"
          style={{ width: `${(100 * n) / max}%`, background: color }}
        />
      </div>
      <span>{n}</span>
    </div>
  );
  return (
    <div>
      {row('Views', funnel.views, '#7c6cf0')}
      {row(`Carts (${funnel.viewToCart}%)`, funnel.carts, '#3dd6c6')}
      {row(`Checkout (${funnel.cartToCheckout}%)`, funnel.checkouts, '#f0a06a')}
      {row(`Buys (${funnel.checkoutToBuy}%)`, funnel.purchases, '#3ecf8e')}
    </div>
  );
}

export default function AdminRealtimeAnalysisPage() {
  const [pulse, setPulse] = useState(null);
  const [minutes, setMinutes] = useState(30);
  const [botCount, setBotCount] = useState(0);
  const [error, setError] = useState('');
  const live = useAdminLiveStream({ enabled: true, maxEvents: 50 });

  const load = () => {
    api
      .adminRealtimeAnalysis(minutes)
      .then(setPulse)
      .catch((e) => setError(e.message));
    api
      .adminBots()
      .then((d) => setBotCount((d.bots || []).length))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefer live SSE market_pulse when it arrives
  useEffect(() => {
    if (live.marketPulse) setPulse(live.marketPulse);
  }, [live.marketPulse]);

  // Soft refresh when events stream in (fallback if pulse throttle skipped)
  useEffect(() => {
    if (!live.events.length) return;
    const t = setTimeout(load, 1200);
    return () => clearTimeout(t);
  }, [live.events[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !pulse) return <div className="ad-alert">{error}</div>;
  if (!pulse) return <p className="ad-muted">Loading real-time AI analysis…</p>;

  const w = pulse.window || {};
  const mood = pulse.marketMood;

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>
            <span className="ad-live-dot" />
            Real-time AI analysis
          </h1>
          <p>
            {live.connected ? (
              <span className="ad-pill ok">SSE live</span>
            ) : (
              <span className="ad-pill warn">Connecting…</span>
            )}{' '}
            General market intelligence from every shopper & bot action · window{' '}
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              style={{ marginLeft: 4 }}
            >
              <option value={15}>15m</option>
              <option value={30}>30m</option>
              <option value={60}>60m</option>
              <option value={120}>2h</option>
            </select>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/admin/live" className="ad-btn">
            Raw feed
          </Link>
          <Link to="/admin/insights" className="ad-btn">
            Feature mine
          </Link>
          <button type="button" className="ad-btn primary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <PlayAllBotsButton
        botCount={botCount}
        defaultSessions={1}
        onFinished={() => load()}
      />

      {/* Mood + KPIs */}
      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Market mood</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            <MoodBadge mood={mood} />
          </div>
          <div className="hint">{mood?.detail}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Events / min</div>
          <div className="value">{w.eventsPerMinute ?? 0}</div>
          <div className="hint">{w.events} in {w.minutes}m</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Views → buy</div>
          <div className="value">{pulse.funnel?.viewToBuy ?? 0}%</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Purchases</div>
          <div className="value">{w.purchases ?? 0}</div>
          <div className="hint">{w.carts} carts · {w.checkouts} checkouts</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Model conf</div>
          <div className="value">
            {((pulse.model?.avgConfidence || 0) * 100).toFixed(0)}%
          </div>
          <div className="hint">{pulse.model?.liveClassifications || 0} live labels</div>
        </div>
      </div>

      {/* AI briefing */}
      <div className="ad-card" style={{ marginBottom: '1rem' }}>
        <h2>AI briefing (auto)</h2>
        <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
          Generated from live funnel, personas, hot SKUs, and model state · updates as traffic
          moves
        </p>
        {(pulse.briefing || []).map((line, i) => (
          <div key={i} className="ad-insight" style={{ marginBottom: 6 }}>
            {line}
          </div>
        ))}
        {(pulse.alerts || []).length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>Alerts</h3>
            {pulse.alerts.map((a) => (
              <div
                key={a.code}
                className="ad-insight"
                style={{
                  borderLeftColor:
                    a.level === 'warn'
                      ? '#f0a06a'
                      : a.level === 'ok'
                        ? '#3ecf8e'
                        : '#7c6cf0',
                }}
              >
                <strong>{a.code}</strong> — {a.message}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Live funnel ({w.minutes}m)</h2>
          <FunnelBars funnel={pulse.funnel} />
          <h3 style={{ marginTop: '1rem' }}>Event mix</h3>
          {(pulse.types || []).slice(0, 8).map((t) => (
            <div key={t.type} className="ad-bar-row">
              <span className="ad-mono" style={{ fontSize: '0.75rem' }}>
                {t.type}
              </span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      (100 * t.c) / Math.max(...(pulse.types || [{ c: 1 }]).map((x) => x.c), 1)
                    )}%`,
                  }}
                />
              </div>
              <span>{t.c}</span>
            </div>
          ))}
        </div>

        <div className="ad-card">
          <h2>Persona landscape</h2>
          {(pulse.personas || []).map((p) => (
            <div key={p.persona} className="ad-bar-row">
              <span title={`intent ${p.avgIntent} · risk ${p.avgRisk}`}>{p.label}</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      (100 * p.count) /
                        Math.max(...(pulse.personas || [{ count: 1 }]).map((x) => x.count), 1)
                    )}%`,
                  }}
                />
              </div>
              <span>{p.count}</span>
            </div>
          ))}
          {!pulse.personas?.length && (
            <p className="ad-muted">No profiles yet — play the bot fleet.</p>
          )}
        </div>
      </div>

      <div className="ad-grid-2" style={{ marginTop: '1rem' }}>
        <div className="ad-card">
          <h2>High intent now</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Intent</th>
                <th>Risk</th>
                <th>Persona</th>
              </tr>
            </thead>
            <tbody>
              {(pulse.highIntent || []).map((p) => (
                <tr key={p.profileKey}>
                  <td>
                    <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                      {p.displayName}
                    </Link>
                  </td>
                  <td>
                    <strong>{p.intent}</strong>
                  </td>
                  <td>{p.risk}</td>
                  <td>
                    <span className="ad-pill">{p.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: '1rem' }}>Cart / abandon risk</h3>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Risk</th>
                <th>Intent</th>
              </tr>
            </thead>
            <tbody>
              {(pulse.highRisk || []).map((p) => (
                <tr key={p.profileKey}>
                  <td>{p.displayName}</td>
                  <td>
                    <span className="ad-pill danger">{p.risk}</span>
                  </td>
                  <td>{p.intent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ad-card">
          <h2>Hot products (window)</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Heat</th>
                <th>V/C/P</th>
              </tr>
            </thead>
            <tbody>
              {(pulse.hotProducts || []).map((p) => (
                <tr key={p.productId}>
                  <td>
                    {p.title}
                    <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                      {p.category}
                    </div>
                  </td>
                  <td>{p.heat}</td>
                  <td className="ad-mono" style={{ fontSize: '0.8rem' }}>
                    {p.views}/{p.carts}/{p.purchases}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: '1rem' }}>Recent orders</h3>
          <ul className="ad-timeline">
            {(pulse.recentOrders || []).map((o) => (
              <li key={o.orderId}>
                <div className="time">{o.placedAt}</div>
                <div>
                  <span className="type">{o.total.formatted}</span>
                  <div className="meta">
                    {o.orderId} · {o.userId}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Live model strip */}
      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>
          <span className="ad-live-dot" />
          Model classifications (streaming)
        </h2>
        <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
          Top model label: <strong>{pulse.model?.topLabel || '—'}</strong>
          {pulse.model?.topLabelCount
            ? ` (${pulse.model.topLabelCount} recent)`
            : ''}{' '}
          · also on <Link to="/admin/ai">Tiny AI</Link>
        </p>
        <table className="ad-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Rule</th>
              <th>Model</th>
              <th>Intent</th>
            </tr>
          </thead>
          <tbody>
            {(live.aiUpdates.length
              ? live.aiUpdates
              : pulse.model?.recent || []
            )
              .slice(0, 15)
              .map((c) => (
                <tr key={(c.profileKey || '') + (c.updatedAt || '')}>
                  <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                    {c.updatedAt
                      ? new Date(c.updatedAt).toLocaleTimeString()
                      : '—'}
                  </td>
                  <td>
                    {c.botId ? (
                      <Link to={`/admin/bots/${c.botId}`}>{c.botName || c.displayName}</Link>
                    ) : (
                      c.displayName
                    )}
                    {c.isBot && (
                      <span className="ad-pill" style={{ marginLeft: 4 }}>
                        BOT
                      </span>
                    )}
                  </td>
                  <td className="ad-mono">{c.lastEventType}</td>
                  <td>
                    <span className="ad-pill">{c.rulePersona}</span>
                  </td>
                  <td>
                    {c.transformer?.label || c.modelLabel ? (
                      <span className="ad-pill teal">
                        {c.transformer?.label || c.modelLabel}
                      </span>
                    ) : (
                      '—'
                    )}{' '}
                    {c.transformer?.confidence != null || c.confidence != null
                      ? `${(((c.transformer?.confidence ?? c.confidence) || 0) * 100).toFixed(0)}%`
                      : ''}
                  </td>
                  <td>{c.scores?.purchaseIntent ?? c.intent ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Live event ticker */}
      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>Event ticker</h2>
        <ul className="ad-timeline">
          {live.events.slice(0, 20).map((e) => (
            <li key={`${e.id}-${e.createdAt}`}>
              <div className="time">
                {e.createdAt ? new Date(e.createdAt).toLocaleTimeString() : '—'}
              </div>
              <div>
                <span className="type">{e.type}</span>
                {e.isBot && (
                  <span className="ad-pill" style={{ marginLeft: 6 }}>
                    BOT
                  </span>
                )}
                <div className="meta">
                  {e.botName || e.userId || 'guest'} · {e.target || e.path || '—'}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {!live.events.length && (
          <p className="ad-muted">
            Waiting for live events — press Play above or use the shop.
          </p>
        )}
      </div>

      <p className="ad-muted" style={{ fontSize: '0.8rem', marginTop: '1rem' }}>
        Totals lifetime: {pulse.totals?.allEvents} events · {pulse.totals?.profiles} profiles ·{' '}
        {pulse.totals?.bots} bots · {pulse.totals?.orders} orders ·{' '}
        {pulse.totals?.revenue?.formatted} revenue · updated {pulse.generatedAt}
      </p>
    </div>
  );
}
