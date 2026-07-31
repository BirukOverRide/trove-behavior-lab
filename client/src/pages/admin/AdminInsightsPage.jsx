import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

export default function AdminInsightsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('growth');

  const load = () => {
    api
      .adminInsights()
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  if (error && !data) return <div className="ad-alert">{error}</div>;
  if (!data) return <p className="ad-muted">Mining features…</p>;

  const { growth, catalog, botLab, modelOps } = data;

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>AI feature mine</h1>
          <p>
            All product features extracted from real-time behavior + Tiny Transformer —
            growth queues, catalog signals, bot lab, model ops.
          </p>
        </div>
        <button type="button" className="ad-btn" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="ad-filters" style={{ marginBottom: '1rem' }}>
        {[
          ['growth', 'Growth'],
          ['catalog', 'Catalog'],
          ['bots', 'Bot lab'],
          ['model', 'Model ops'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="ad-btn"
            style={{
              borderColor: tab === id ? '#7c6cf0' : undefined,
              background: tab === id ? 'rgba(124,108,240,0.2)' : undefined,
            }}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <Link to="/admin/ai" className="ad-btn primary">
          Tiny AI train
        </Link>
      </div>

      {tab === 'growth' && (
        <>
          <div className="ad-kpi-grid">
            <div className="ad-kpi">
              <div className="label">About to buy</div>
              <div className="value">{growth.aboutToBuy.length}</div>
              <div className="hint">High intent queue</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Cart at risk</div>
              <div className="value">{growth.cartAtRisk.length}</div>
              <div className="hint">Recovery candidates</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Lookalikes</div>
              <div className="value">{growth.lookalikes.length}</div>
              <div className="hint">Like loyal buyers</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Deal sensitive</div>
              <div className="value">{growth.dealSensitive.length}</div>
            </div>
          </div>

          <div className="ad-grid-2">
            <div className="ad-card">
              <h2>Who&apos;s about to buy</h2>
              <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
                Priority = intent × engagement × (low abandon) × spend potential
              </p>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Priority</th>
                    <th>Intent</th>
                    <th>Risk</th>
                    <th>Persona</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.aboutToBuy.map((p) => (
                    <tr key={p.profileKey}>
                      <td>
                        <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                          {p.displayName}
                        </Link>
                      </td>
                      <td>
                        <strong>{p.priority}</strong>
                      </td>
                      <td>{p.intent}</td>
                      <td>{p.abandonRisk}</td>
                      <td>
                        <span className="ad-pill">{p.personaLabel}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!growth.aboutToBuy.length && (
                <p className="ad-muted">No high-intent shoppers yet — run bots or browse.</p>
              )}
            </div>

            <div className="ad-card">
              <h2>Cart at risk (recovery)</h2>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Risk</th>
                    <th>Intent</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.cartAtRisk.map((p) => (
                    <tr key={p.profileKey}>
                      <td>
                        <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                          {p.displayName}
                        </Link>
                      </td>
                      <td>
                        <span className="ad-pill danger">{p.abandonRisk}</span>
                      </td>
                      <td>{p.intent}</td>
                      <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                        {p.recoveryAction}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ad-grid-2" style={{ marginTop: '1rem' }}>
            <div className="ad-card">
              <h2>Lookalikes of best buyers</h2>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Intent</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.lookalikes.map((p) => (
                    <tr key={p.profileKey}>
                      <td>{p.displayName}</td>
                      <td>{p.intent}</td>
                      <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                        {p.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ad-card">
              <h2>Deal-sensitive shoppers</h2>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Sensitivity</th>
                    <th>Playbook</th>
                  </tr>
                </thead>
                <tbody>
                  {growth.dealSensitive.map((p) => (
                    <tr key={p.profileKey}>
                      <td>{p.displayName}</td>
                      <td>{p.priceSensitivity}</td>
                      <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                        {p.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'catalog' && (
        <>
          <div className="ad-grid-2">
            <div className="ad-card">
              <h2>Product demand heat</h2>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Demand</th>
                    <th>V / C / P</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.topDemand.map((p) => (
                    <tr key={p.productId}>
                      <td>
                        <strong>{p.title}</strong>
                        <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                          {p.category} · {p.price.formatted}
                        </div>
                      </td>
                      <td>{p.demandScore}</td>
                      <td className="ad-mono" style={{ fontSize: '0.8rem' }}>
                        {p.views}/{p.carts}/{p.purchases}
                      </td>
                      <td>
                        <span className="ad-pill">{p.signal}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ad-card">
              <h2>Dead interest (reprice / bury)</h2>
              <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
                Views without carts or buys — weak product-market fit signal
              </p>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Views</th>
                    <th>Carts</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.deadStock.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.title}</td>
                      <td>{p.views}</td>
                      <td>{p.carts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!catalog.deadStock.length && (
                <p className="ad-muted">No dead-interest SKUs yet.</p>
              )}
            </div>
          </div>
          <div className="ad-card" style={{ marginTop: '1rem' }}>
            <h2>Often viewed together</h2>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Co-views</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {catalog.affinities.map((a, i) => (
                  <tr key={i}>
                    <td>
                      {a.productA.title}
                      <span className="ad-muted"> + </span>
                      {a.productB.title}
                    </td>
                    <td>{a.coViews}</td>
                    <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                      {a.suggestion}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!catalog.affinities.length && (
              <p className="ad-muted">Need more multi-product sessions for pairs.</p>
            )}
          </div>
        </>
      )}

      {tab === 'bots' && (
        <>
          <div className="ad-kpi-grid">
            <div className="ad-kpi">
              <div className="label">Purity rate</div>
              <div className="value">{botLab.purityRate}%</div>
              <div className="hint">Model matches designed persona</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Pure bots</div>
              <div className="value">{botLab.pureCount}</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Drifted</div>
              <div className="value">{botLab.driftCount}</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Bot orders</div>
              <div className="value">{botLab.fleetSummary?.totalOrders ?? 0}</div>
            </div>
          </div>
          <div className="ad-card">
            <h2>DNA vs model (persona purity)</h2>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Bot</th>
                  <th>Designed</th>
                  <th>Model</th>
                  <th>Match</th>
                  <th>View→buy</th>
                  <th>Stage</th>
                </tr>
              </thead>
              <tbody>
                {botLab.purity.map((b) => (
                  <tr key={b.botId}>
                    <td>
                      <Link to={`/admin/bots/${b.botId}`}>{b.displayName}</Link>
                    </td>
                    <td>
                      <span className="ad-pill">{b.designedPersona}</span>
                    </td>
                    <td>
                      {b.modelLabel ? (
                        <span className="ad-pill teal">{b.modelLabel}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {b.pure ? (
                        <span className="ad-pill ok">pure</span>
                      ) : b.drift ? (
                        <span className="ad-pill warn">drift</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{b.viewToBuy}%</td>
                    <td className="ad-muted">{b.buyerStage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'model' && (
        <>
          <div className="ad-kpi-grid">
            <div className="ad-kpi">
              <div className="label">Live classifications</div>
              <div className="value">{modelOps.liveClassifications}</div>
            </div>
            <div className="ad-kpi">
              <div className="label">Avg confidence</div>
              <div className="value">
                {((modelOps.avgConfidence || 0) * 100).toFixed(0)}%
              </div>
            </div>
            <div className="ad-kpi">
              <div className="label">Above gate (≥60%)</div>
              <div className="value">{modelOps.highConfidenceCount}</div>
            </div>
          </div>
          <div className="ad-grid-2">
            <div className="ad-card">
              <h2>Persona mix (drift monitor)</h2>
              {modelOps.personaMix.map((p) => (
                <div key={p.persona} className="ad-bar-row">
                  <span>{p.persona}</span>
                  <div className="ad-bar-track">
                    <div
                      className="ad-bar-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (p.c /
                            Math.max(
                              ...modelOps.personaMix.map((x) => x.c),
                              1
                            )) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                  <span>{p.c}</span>
                </div>
              ))}
            </div>
            <div className="ad-card">
              <h2>Low-confidence predictions</h2>
              <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
                {modelOps.note}
              </p>
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Label</th>
                    <th>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {modelOps.lowConfidence.map((c) => (
                    <tr key={c.profileKey}>
                      <td>{c.displayName}</td>
                      <td>{c.transformer?.label}</td>
                      <td>
                        {((c.transformer?.confidence || 0) * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!modelOps.lowConfidence.length && (
                <p className="ad-muted">No low-confidence live scores right now.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
