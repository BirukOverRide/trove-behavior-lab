import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAdminLiveStream } from '../../hooks/useAdminLiveStream';
import PlayAllBotsButton from '../../components/PlayAllBotsButton';

export default function AdminActiveBotsPage() {
  const [bots, setBots] = useState([]);
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [buying, setBuying] = useState(null);

  const live = useAdminLiveStream({ enabled: true, maxEvents: 40 });

  const load = () => {
    Promise.all([
      api.adminActiveBots(72),
      api.adminFleetBuyingAnalysis().catch(() => null),
    ])
      .then(([d, buy]) => {
        setBots(d.bots || []);
        setFleet(d.fleet || null);
        setBuying(buy);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  // Refresh fleet when bots finish a live session
  useEffect(() => {
    if (!live.botRuns.length) return;
    const last = live.botRuns[0];
    if (last.status === 'session_done' || last.status === 'idle') {
      load();
    }
  }, [live.botRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  const runOne = async (id) => {
    setBusy(true);
    setError('');
    try {
      const d = await api.adminRunBot(id, 1);
      const r = d.results?.[0];
      setMsg(
        `Ran ${d.bot?.displayName}: ${r?.events || 0} events` +
          (r?.purchased ? ' · purchased' : '')
      );
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const stopOne = async (id) => {
    setBusy(true);
    setError('');
    try {
      const d = await api.adminStopBot(id);
      setMsg(`Stopped ${d.bot?.displayName || 'bot'}`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.adminStopAllBots();
      setMsg(d.message || 'Stopped active bots');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>
            <span className="ad-live-dot" />
            Active bots
          </h1>
          <p>
            {live.connected ? (
              <span className="ad-pill ok">Real-time AI stream</span>
            ) : (
              <span className="ad-pill warn">Connecting…</span>
            )}{' '}
            Hit <strong>Play</strong> to run the whole fleet ·{' '}
            <strong>Stop</strong> to halt them ·{' '}
            <Link to="/admin/live">live feed</Link>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ad-btn"
            disabled={busy}
            onClick={stopAll}
            title="Stop fleet play and clear any running bots"
            style={{
              background: 'rgba(255,107,122,0.12)',
              borderColor: 'var(--ad-danger, #ff6b7a)',
              color: 'var(--ad-danger, #ff6b7a)',
            }}
          >
            ■ Stop all bots
          </button>
          <Link to="/admin/bots" className="ad-btn">
            Manage / create
          </Link>
        </div>
      </div>

      <PlayAllBotsButton
        botCount={fleet?.total || bots.length}
        defaultSessions={1}
        onFinished={(st) => {
          setMsg(st?.stopped ? 'Fleet stopped.' : 'Fleet finished playing.');
          load();
        }}
      />

      {error && <div className="ad-alert">{error}</div>}
      {msg && (
        <div className="ad-alert" style={{ background: 'rgba(62,207,142,0.12)', color: '#3ecf8e' }}>
          {msg}
        </div>
      )}

      {fleet && (
        <div className="ad-kpi-grid">
          <div className="ad-kpi">
            <div className="label">Active now</div>
            <div className="value">{bots.length}</div>
            <div className="hint">Running or recent activity</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Fleet size</div>
            <div className="value">{fleet.total}</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Simulating</div>
            <div className="value">{fleet.running}</div>
            <div className="hint">status = running</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Have sessions</div>
            <div className="value">{fleet.withSessions}</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Never run</div>
            <div className="value">{fleet.neverRun}</div>
            <div className="hint">Created but idle</div>
          </div>
        </div>
      )}

      {live.aiUpdates.length > 0 && (
        <div className="ad-card" style={{ marginBottom: '1rem' }}>
          <h2>
            <span className="ad-live-dot" />
            Live AI on bots (this second)
          </h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Action</th>
                <th>Model label</th>
                <th>Intent</th>
              </tr>
            </thead>
            <tbody>
              {live.aiUpdates
                .filter((a) => a.isBot)
                .slice(0, 10)
                .map((a) => (
                  <tr key={a.profileKey + a.updatedAt}>
                    <td>
                      <Link to={`/admin/bots/${a.botId}`}>{a.botName}</Link>
                    </td>
                    <td className="ad-mono">{a.lastEventType}</td>
                    <td>
                      <span className="ad-pill teal">
                        {a.transformer?.label || '—'}
                      </span>{' '}
                      {a.transformer?.confidence != null &&
                        `${(a.transformer.confidence * 100).toFixed(0)}%`}
                    </td>
                    <td>{a.scores?.purchaseIntent}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {buying?.bots?.length > 0 && (
        <div className="ad-card" style={{ marginBottom: '1rem' }}>
          <h2>Buying behavior snapshot (AI)</h2>
          <p className="ad-muted" style={{ fontSize: '0.9rem' }}>
            Per-bot funnel + Tiny Transformer classification. Open a bot for full analysis, or see
            fleet-wide learning on <Link to="/admin/ai">Tiny AI</Link>.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Stage</th>
                <th>View→buy</th>
                <th>Spend</th>
                <th>Model</th>
                <th>Insight</th>
              </tr>
            </thead>
            <tbody>
              {buying.bots.slice(0, 12).map((b) => (
                <tr key={b.botId}>
                  <td>
                    <Link to={`/admin/bots/${b.botId}`}>{b.displayName}</Link>
                  </td>
                  <td>
                    <span className="ad-pill teal">{b.buyerStage}</span>
                  </td>
                  <td>{b.funnel.viewToPurchase}%</td>
                  <td>{b.commerce.totalSpent.formatted}</td>
                  <td>
                    {b.transformer?.label ? (
                      <span className="ad-pill">{b.transformer.label}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                    {b.topInsight}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ad-card">
        <h2>Active fleet</h2>
        {!bots.length && (
          <p className="ad-muted">
            No active bots yet.{' '}
            <Link to="/admin/bots">Create bots</Link> and run sessions so they appear here.
          </p>
        )}
        <table className="ad-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Bot</th>
              <th>Persona DNA</th>
              <th>Sessions</th>
              <th>Events</th>
              <th>Orders</th>
              <th>Last activity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {bots.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.isRunning ? (
                    <span className="ad-pill warn">running</span>
                  ) : (
                    <span className="ad-pill ok">active</span>
                  )}
                </td>
                <td>
                  <Link to={`/admin/bots/${b.id}`}>
                    <strong>{b.displayName}</strong>
                  </Link>
                  <div className="ad-mono ad-muted">{b.email}</div>
                </td>
                <td>
                  <span className="ad-pill">{b.personaLabel}</span>
                  <div className="ad-muted" style={{ fontSize: '0.78rem' }}>
                    buy {((b.dna?.pPurchase || 0) * 100).toFixed(0)}% · add{' '}
                    {((b.dna?.pAddToCart || 0) * 100).toFixed(0)}%
                  </div>
                </td>
                <td>{b.sessionsRun}</td>
                <td>{b.eventCount}</td>
                <td>{b.orderCount}</td>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  {b.lastEventAt || b.lastRunAt || '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {b.isRunning ? (
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={busy}
                      onClick={() => stopOne(b.id)}
                      style={{
                        background: 'rgba(255,107,122,0.12)',
                        borderColor: 'var(--ad-danger, #ff6b7a)',
                        color: 'var(--ad-danger, #ff6b7a)',
                      }}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ad-btn"
                      disabled={busy}
                      onClick={() => runOne(b.id)}
                    >
                      Run
                    </button>
                  )}{' '}
                  <Link
                    className="ad-btn ghost"
                    to={`/admin/profiles/${encodeURIComponent('user:' + b.userId)}`}
                  >
                    Profile
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fleet?.byPersona?.length > 0 && (
        <div className="ad-card" style={{ marginTop: '1rem' }}>
          <h2>Fleet by persona</h2>
          {fleet.byPersona.map((p) => (
            <div key={p.persona} className="ad-bar-row">
              <span>{p.persona}</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${Math.min(100, (p.c / Math.max(fleet.total, 1)) * 100)}%`,
                  }}
                />
              </div>
              <span>{p.c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
