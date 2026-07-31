import { Link } from 'react-router-dom';
import { useAdminLiveStream } from '../../hooks/useAdminLiveStream';

export default function AdminLivePage() {
  const {
    connected,
    events,
    aiUpdates,
    profiles,
    dataset,
    botRuns,
    lastTs,
    error,
  } = useAdminLiveStream({ enabled: true, maxEvents: 100 });

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>
            <span className="ad-live-dot" />
            Live feed · real-time AI
          </h1>
          <p>
            {connected ? (
              <>
                <span className="ad-pill ok">SSE connected</span> Streaming events as they
                happen — no polling.
              </>
            ) : (
              <span className="ad-pill warn">Connecting…</span>
            )}{' '}
            {lastTs && (
              <span className="ad-muted">· last event {new Date(lastTs).toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/admin/ai" className="ad-btn">
            Tiny AI
          </Link>
          <Link to="/admin/bots/active" className="ad-btn primary">
            Active bots
          </Link>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      {dataset && (
        <div className="ad-kpi-grid">
          <div className="ad-kpi">
            <div className="label">Events (live total)</div>
            <div className="value">{dataset.behaviorEvents}</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Profiles</div>
            <div className="value">{dataset.consumerProfiles}</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Trainable journeys</div>
            <div className="value">{dataset.trainableExamples}</div>
            <div className="hint">AI dataset grows live</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Bots</div>
            <div className="value">{dataset.bots}</div>
          </div>
          <div className="ad-kpi">
            <div className="label">Stream</div>
            <div className="value" style={{ fontSize: '1.1rem' }}>
              {connected ? 'ON' : 'OFF'}
            </div>
          </div>
        </div>
      )}

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Events (real-time)</h2>
          <ul className="ad-timeline">
            {events.map((e) => (
              <li key={`${e.id}-${e.createdAt}`}>
                <div className="time">
                  {e.createdAt
                    ? new Date(e.createdAt).toLocaleTimeString()
                    : '—'}
                </div>
                <div>
                  <span className="type">{e.type}</span>
                  {e.isBot && <span className="ad-pill" style={{ marginLeft: 6 }}>BOT</span>}
                  <div className="meta">
                    {e.botName || e.userId || 'guest'} · {e.target || e.path || '—'}
                    {e.productId ? ` · ${e.productId}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!events.length && (
            <p className="ad-muted">
              Waiting for activity… Run bots or shop as a user.
            </p>
          )}
        </div>

        <div className="ad-card">
          <h2>AI classifications (live)</h2>
          <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
            Tiny Transformer re-scores journeys as new cart/view/purchase events arrive.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Rule persona</th>
                <th>Model</th>
                <th>Intent</th>
              </tr>
            </thead>
            <tbody>
              {aiUpdates.map((a) => (
                <tr key={a.profileKey + a.updatedAt}>
                  <td>
                    {a.botId ? (
                      <Link to={`/admin/bots/${a.botId}`}>
                        {a.botName || a.displayName}
                      </Link>
                    ) : (
                      <Link to={`/admin/profiles/${encodeURIComponent(a.profileKey)}`}>
                        {a.displayName}
                      </Link>
                    )}
                    {a.isBot && (
                      <div className="ad-muted" style={{ fontSize: '0.7rem' }}>
                        bot
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="ad-pill">{a.rulePersona}</span>
                  </td>
                  <td>
                    {a.transformer?.label ? (
                      <>
                        <span className="ad-pill teal">{a.transformer.label}</span>
                        <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                          {((a.transformer.confidence || 0) * 100).toFixed(0)}% · last{' '}
                          {a.lastEventType}
                        </div>
                      </>
                    ) : (
                      <span className="ad-muted">—</span>
                    )}
                  </td>
                  <td>{a.scores?.purchaseIntent ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!aiUpdates.length && (
            <p className="ad-muted">No AI updates yet. Generate events (run a bot).</p>
          )}

          <h3 style={{ marginTop: '1.25rem' }}>Bot runs</h3>
          <ul className="ad-timeline">
            {botRuns.map((b, i) => (
              <li key={`${b.botId}-${b.status}-${i}`}>
                <div className="time">{b.status}</div>
                <div>
                  <span className="type">{b.name}</span>
                  <div className="meta">
                    {b.sessionIndex
                      ? `session ${b.sessionIndex}/${b.sessions}`
                      : ''}
                    {b.result
                      ? ` · ${b.result.events} events` +
                        (b.result.purchased ? ' · purchased' : '')
                      : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <h3 style={{ marginTop: '1rem' }}>Profiles touch</h3>
          <div className="ad-chip-list">
            {profiles.slice(0, 16).map((p) => (
              <span key={p.profileKey} className="ad-chip">
                {p.displayName || p.profileKey}: {p.persona}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
