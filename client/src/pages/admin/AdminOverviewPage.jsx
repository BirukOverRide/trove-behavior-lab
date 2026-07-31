import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import PlayAllBotsButton from '../../components/PlayAllBotsButton';

export default function AdminOverviewPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [botCount, setBotCount] = useState(0);

  const load = () => {
    api
      .adminOverview()
      .then(setData)
      .catch((e) => setError(e.message));
    api
      .adminBots()
      .then((d) => setBotCount((d.bots || []).length))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const onRebuild = async () => {
    setRebuilding(true);
    try {
      await api.adminRebuild();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRebuilding(false);
    }
  };

  if (error && !data) {
    return <div className="ad-alert">{error}</div>;
  }
  if (!data) {
    return <p className="ad-muted">Loading intelligence overview…</p>;
  }

  const { totals, personaDistribution, eventTypeBreakdown, topIntent, highAbandonRisk, recentEvents } =
    data;

  return (
    <div>
      <PlayAllBotsButton
        botCount={botCount}
        defaultSessions={1}
        onFinished={() => load()}
      />
      <div className="ad-topbar">
        <div>
          <h1>Behavior overview</h1>
          <p>
            <span className="ad-live-dot" />
            Live models from shopper journeys · auto-refresh 15s
          </p>
        </div>
        <button type="button" className="ad-btn primary" onClick={onRebuild} disabled={rebuilding}>
          {rebuilding ? 'Rebuilding…' : 'Rebuild all profiles'}
        </button>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Events tracked</div>
          <div className="value">{totals.events.toLocaleString()}</div>
          <div className="hint">Every click, view, cart, buy</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Consumer profiles</div>
          <div className="value">{totals.profiles.toLocaleString()}</div>
          <div className="hint">AI-built personas</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Registered shoppers</div>
          <div className="value">{totals.shoppers.toLocaleString()}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Orders</div>
          <div className="value">{totals.orders.toLocaleString()}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Revenue</div>
          <div className="value">{totals.revenueFormatted}</div>
        </div>
      </div>

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Persona distribution</h2>
          {personaDistribution.length === 0 && (
            <p className="ad-muted">
              No profiles yet. Browse the shop as a customer, then rebuild.
            </p>
          )}
          {personaDistribution.map((p) => {
            const max = Math.max(...personaDistribution.map((x) => x.count), 1);
            return (
              <div key={p.persona} className="ad-bar-row">
                <span title={p.persona}>{p.label}</span>
                <div className="ad-bar-track">
                  <div
                    className="ad-bar-fill"
                    style={{ width: `${(p.count / max) * 100}%` }}
                  />
                </div>
                <span>{p.count}</span>
              </div>
            );
          })}
        </div>

        <div className="ad-card">
          <h2>Event mix</h2>
          {eventTypeBreakdown.map((e) => {
            const max = Math.max(...eventTypeBreakdown.map((x) => x.c), 1);
            return (
              <div key={e.type} className="ad-bar-row">
                <span className="ad-mono">{e.type}</span>
                <div className="ad-bar-track">
                  <div
                    className="ad-bar-fill"
                    style={{
                      width: `${(e.c / max) * 100}%`,
                      background: 'linear-gradient(90deg,#3dd6c6,#7c6cf0)',
                    }}
                  />
                </div>
                <span>{e.c}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Highest purchase intent</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Persona</th>
                <th>Intent</th>
              </tr>
            </thead>
            <tbody>
              {topIntent.map((p) => (
                <tr key={p.profileKey}>
                  <td>
                    <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                      {p.displayName || p.profileKey}
                    </Link>
                  </td>
                  <td>
                    <span className="ad-pill">{p.personaLabel}</span>
                  </td>
                  <td>{p.purchaseIntent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ad-card">
          <h2>Abandonment risk</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Persona</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {highAbandonRisk.map((p) => (
                <tr key={p.profileKey}>
                  <td>
                    <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                      {p.displayName || p.profileKey}
                    </Link>
                  </td>
                  <td>
                    <span className="ad-pill warn">{p.personaLabel}</span>
                  </td>
                  <td>{p.abandonRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ad-card">
        <h2>Recent activity</h2>
        <ul className="ad-timeline">
          {recentEvents.map((e) => (
            <li key={e.id}>
              <div className="time">{e.created_at}</div>
              <div>
                <span className="type">{e.type}</span>{' '}
                <span className="meta">
                  {e.target || e.path || '—'} · user {e.user_id || 'guest'} ·{' '}
                  {e.session_id?.slice(0, 10) || '—'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
