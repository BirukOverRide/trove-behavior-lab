/**
 * Buyer behavior analysis — commercial funnel, stages, leaks, actions.
 * This is the main "what am I learning" report for buying behavior.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

function Bar({ value, max = 100, color = '#7c6cf0' }) {
  const pct = Math.min(100, max ? (100 * value) / max : 0);
  return (
    <div className="ad-bar-track">
      <div className="ad-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function severityClass(sev) {
  if (sev === 'high') return 'danger';
  if (sev === 'medium') return 'warn';
  return 'ok';
}

export default function AdminBuyerBehaviorPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');

  const load = () => {
    api
      .adminBuyerBehavior()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  if (error && !data) {
    return (
      <div>
        <div className="ad-alert">{error}</div>
        <button type="button" className="ad-btn primary" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <p className="ad-muted">Analyzing buyer behavior…</p>;

  const {
    summary,
    takeaways,
    actions,
    funnel,
    dropOffs,
    stages,
    segments,
    categories,
    topProducts,
    leakProducts,
    topSpenders,
    topAtRisk,
    shoppers,
  } = data;

  const funnelMax = Math.max(funnel.views, funnel.carts, funnel.checkouts, funnel.purchases, 1);

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>Buyer behavior analysis</h1>
          <p>
            Who buys, who almost buys, where money leaks, what to do next — grounded in real
            carts, checkouts, and orders.
            <span className="ad-muted"> · {new Date(data.generatedAt).toLocaleString()}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/bots/active" className="ad-btn">
            Run bots
          </Link>
          <button type="button" className="ad-btn primary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      {/* KPIs */}
      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Shoppers analyzed</div>
          <div className="value">{summary.shoppers}</div>
          <div className="hint">{summary.buyerPct}% bought</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Buyers</div>
          <div className="value">{summary.buyers}</div>
          <div className="hint">{summary.orders} orders</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Almost buyers</div>
          <div className="value" style={{ color: '#f0a06a' }}>
            {summary.almostBuyers}
          </div>
          <div className="hint">{summary.almostBuyerPct}% cart/checkout no order</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Revenue</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {summary.revenue.formatted}
          </div>
          <div className="hint">AOV {summary.aov.formatted}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">View → buy</div>
          <div className="value">{summary.viewToPurchase}%</div>
          <div className="hint">checkout→buy {summary.checkoutToPurchase}%</div>
        </div>
      </div>

      {/* THE LEARNING — plain English */}
      <div className="ad-card" style={{ marginBottom: '1rem', borderColor: 'rgba(62,207,142,0.4)' }}>
        <h2 style={{ marginTop: 0 }}>What you’re learning (buyer behavior)</h2>
        <p className="ad-muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
          Read this first. Charts below only support these points.
        </p>
        {takeaways.map((t) => (
          <div
            key={t.id}
            className="ad-insight rec"
            style={{
              borderLeftColor:
                t.id === 'leak' || t.id === 'recover'
                  ? '#ff6b7a'
                  : t.id === 'headline'
                    ? '#3ecf8e'
                    : '#7c6cf0',
            }}
          >
            <strong>{t.title}.</strong> {t.text}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="ad-card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>What to do next</h2>
        <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
          {actions.map((a, i) => (
            <li key={i} style={{ marginBottom: '0.65rem' }}>
              <strong>{a.action}</strong>
              <div className="ad-muted" style={{ fontSize: '0.88rem' }}>
                {a.why}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="ad-filters">
        {[
          ['overview', 'Funnel & stages'],
          ['risk', 'Almost buyers'],
          ['money', 'Who spends'],
          ['catalog', 'Products & categories'],
          ['people', 'All shoppers'],
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
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="ad-grid-2">
          <div className="ad-card">
            <h2>Purchase funnel</h2>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Every step from product view to paid order (all shoppers).
            </p>
            {[
              ['Product views', funnel.views, '#7c6cf0'],
              [`Add to cart (${funnel.viewToCart}%)`, funnel.carts, '#3dd6c6'],
              [`Begin checkout (${funnel.cartToCheckout}%)`, funnel.checkouts, '#f0a06a'],
              [`Purchases (${funnel.checkoutToPurchase}% of checkout)`, funnel.purchases, '#3ecf8e'],
            ].map(([label, n, color]) => (
              <div className="ad-bar-row" key={label}>
                <span style={{ fontSize: '0.82rem' }}>{label}</span>
                <Bar value={n} max={funnelMax} color={color} />
                <span>{n}</span>
              </div>
            ))}
            <div className="ad-chip-list" style={{ marginTop: 12 }}>
              <span className="ad-chip">view→buy {funnel.viewToPurchase}%</span>
              <span className="ad-chip">searches {funnel.searches}</span>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Where buyers drop off</h3>
            {dropOffs.map((d) => (
              <div key={d.step} className="ad-insight" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{d.step}</strong>
                  <span className={`ad-pill ${severityClass(d.severity)}`}>
                    {d.convertPct}% convert · {d.lostPct}% lost
                  </span>
                </div>
                <div className="ad-muted" style={{ fontSize: '0.88rem', marginTop: 4 }}>
                  {d.plain}
                </div>
              </div>
            ))}
          </div>

          <div className="ad-card">
            <h2>Buyer stages</h2>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Every shopper lands in one stage based on what they actually did.
            </p>
            {stages
              .filter((s) => s.count > 0)
              .map((s) => (
                <div key={s.id} style={{ marginBottom: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: s.color }}>{s.label}</strong>
                    <span>
                      {s.count} · {s.sharePct}%
                    </span>
                  </div>
                  <Bar value={s.sharePct} max={100} color={s.color} />
                  <div className="ad-muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                    {s.meaning}
                  </div>
                  <div className="ad-chip-list" style={{ marginTop: 4 }}>
                    <span className="ad-chip">orders {s.orders}</span>
                    <span className="ad-chip">{s.revenue.formatted}</span>
                    {s.avgAbandonRisk > 0 && (
                      <span className="ad-chip">risk ~{s.avgAbandonRisk}</span>
                    )}
                  </div>
                </div>
              ))}

            <h3 style={{ marginTop: '1rem' }}>Segments</h3>
            <div className="ad-grid-2" style={{ gap: '0.5rem' }}>
              {Object.values(segments).map((seg) => (
                <div key={seg.label} className="ad-insight" style={{ margin: 0 }}>
                  <strong>
                    {seg.label}: {seg.count}
                  </strong>
                  {seg.sharePct != null && (
                    <span className="ad-muted"> ({seg.sharePct}%)</span>
                  )}
                  {seg.revenue && (
                    <div className="ad-muted" style={{ fontSize: '0.82rem' }}>
                      {seg.revenue.formatted}
                    </div>
                  )}
                  <div className="ad-muted" style={{ fontSize: '0.8rem' }}>
                    {seg.meaning}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ALMOST BUYERS */}
      {tab === 'risk' && (
        <div className="ad-card">
          <h2>Almost buyers — recovery list</h2>
          <p className="ad-muted">
            Carted or started checkout but never ordered. These are your highest-intent non-buyers.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Stage</th>
                <th>Views</th>
                <th>Carts</th>
                <th>Checkouts</th>
                <th>Intent</th>
                <th>Abandon risk</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topAtRisk.map((s) => (
                <tr key={s.userId}>
                  <td>
                    {s.name}
                    {s.isBot && (
                      <span className="ad-muted" style={{ fontSize: '0.72rem' }}>
                        {' '}
                        · bot
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="ad-pill warn">{s.stageLabel}</span>
                  </td>
                  <td>{s.views}</td>
                  <td>{s.carts}</td>
                  <td>{s.checkouts}</td>
                  <td>{s.purchaseIntent ?? '—'}</td>
                  <td style={{ color: (s.abandonRisk || 0) >= 55 ? '#ff6b7a' : undefined }}>
                    {s.abandonRisk ?? '—'}
                  </td>
                  <td>
                    {s.botId ? (
                      <Link className="ad-btn" to={`/admin/bots/${s.botId}`}>
                        Open
                      </Link>
                    ) : (
                      <Link
                        className="ad-btn"
                        to={`/admin/profiles/${encodeURIComponent(s.profileKey)}`}
                      >
                        Profile
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!topAtRisk.length && (
                <tr>
                  <td colSpan={8} className="ad-muted">
                    No almost-buyers yet — run bots that cart without buying.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MONEY */}
      {tab === 'money' && (
        <div className="ad-card">
          <h2>Who spends</h2>
          <p className="ad-muted">Top shoppers by order revenue.</p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Stage</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>View→buy</th>
                <th>Persona</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {topSpenders.map((s) => (
                <tr key={s.userId}>
                  <td>{s.name}</td>
                  <td>
                    <span className="ad-pill ok">{s.stageLabel}</span>
                  </td>
                  <td>{s.orders}</td>
                  <td>
                    <strong>{s.revenue.formatted}</strong>
                  </td>
                  <td>{s.viewToBuy}%</td>
                  <td className="ad-muted">{s.personaLabel || '—'}</td>
                  <td>
                    {s.botId ? (
                      <Link className="ad-btn" to={`/admin/bots/${s.botId}`}>
                        Open
                      </Link>
                    ) : (
                      <Link
                        className="ad-btn"
                        to={`/admin/profiles/${encodeURIComponent(s.profileKey)}`}
                      >
                        Profile
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!topSpenders.length && (
                <tr>
                  <td colSpan={7} className="ad-muted">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* CATALOG */}
      {tab === 'catalog' && (
        <div className="ad-grid-2">
          <div className="ad-card">
            <h2>Categories — what converts</h2>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Views</th>
                  <th>Carts</th>
                  <th>Buys</th>
                  <th>View→buy</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td>{c.views}</td>
                    <td>{c.carts}</td>
                    <td>{c.purchases}</td>
                    <td
                      style={{
                        color: c.viewToBuy >= 10 ? '#3ecf8e' : c.viewToBuy < 3 ? '#ff6b7a' : undefined,
                      }}
                    >
                      {c.viewToBuy}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ad-card">
            <h2>Products that sell</h2>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Views</th>
                  <th>Buys</th>
                  <th>V→B</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p) => (
                  <tr key={p.productId}>
                    <td>
                      <div style={{ maxWidth: 200 }}>{p.title}</div>
                      <div className="ad-muted" style={{ fontSize: '0.72rem' }}>
                        {p.brand} · {p.category}
                      </div>
                    </td>
                    <td>{p.views}</td>
                    <td>{p.purchases}</td>
                    <td>{p.viewToBuy}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 style={{ marginTop: '1rem' }}>Viewed a lot, never bought</h3>
            <p className="ad-muted" style={{ fontSize: '0.82rem' }}>
              Interest without conversion — price, trust, or fit issues.
            </p>
            <div className="ad-chip-list">
              {leakProducts.map((p) => (
                <span key={p.productId} className="ad-chip">
                  {p.title?.slice(0, 28)} · {p.views} views · {p.carts} carts
                </span>
              ))}
              {!leakProducts.length && <span className="ad-muted">None flagged</span>}
            </div>
          </div>
        </div>
      )}

      {/* ALL PEOPLE */}
      {tab === 'people' && (
        <div className="ad-card">
          <h2>All shoppers by buying behavior</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Stage</th>
                <th>V</th>
                <th>C</th>
                <th>X</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>Intent</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shoppers.map((s) => (
                <tr key={s.userId}>
                  <td>
                    {s.name}
                    {s.isBot && <span className="ad-muted"> · bot</span>}
                  </td>
                  <td>
                    <span className="ad-pill">{s.stageLabel}</span>
                  </td>
                  <td>{s.views}</td>
                  <td>{s.carts}</td>
                  <td>{s.checkouts}</td>
                  <td>{s.orders}</td>
                  <td>{s.revenue.formatted}</td>
                  <td>{s.purchaseIntent ?? '—'}</td>
                  <td>
                    {s.botId ? (
                      <Link className="ad-btn" to={`/admin/bots/${s.botId}`}>
                        Bot
                      </Link>
                    ) : (
                      <Link
                        className="ad-btn"
                        to={`/admin/profiles/${encodeURIComponent(s.profileKey)}`}
                      >
                        Profile
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="ad-muted" style={{ marginTop: '1.25rem', fontSize: '0.85rem' }}>
        Personas and Tiny AI label <em>types of people</em>. This page answers the buying
        question: <strong>who pays, who almost pays, and where the funnel breaks</strong>.
      </p>
    </div>
  );
}
