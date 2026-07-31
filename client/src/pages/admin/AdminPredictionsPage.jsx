/**
 * Future predictions — plain language forecasts from learned buyer behavior.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

function ChanceBar({ pct, color = '#3ecf8e' }) {
  return (
    <div className="ad-bar-track" style={{ minWidth: 72 }}>
      <div
        className="ad-bar-fill"
        style={{ width: `${Math.min(100, pct || 0)}%`, background: color }}
      />
    </div>
  );
}

export default function AdminPredictionsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('story');

  const load = () => {
    api
      .adminPredictions()
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
  if (!data) return <p className="ad-muted">Building predictions from what the AI learned…</p>;

  const { stories, marketForecast, likelyToBuySoon, likelyToAbandon, learned, howItWorks, all } =
    data;

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>Future predictions</h1>
          <p>
            What shoppers are likely to do <strong>next</strong>, based on past buying paths — not
            magic, just learned rates.
            <span className="ad-muted"> · {new Date(data.generatedAt).toLocaleString()}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/buyers" className="ad-btn">
            Buyer behavior
          </Link>
          <button type="button" className="ad-btn primary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div className="ad-insight rec" style={{ marginBottom: '1rem' }}>
        <strong>How this works.</strong> {howItWorks}
      </div>

      {/* Market forecast KPIs */}
      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Almost-buyers to recover</div>
          <div className="value">{marketForecast.almostBuyers}</div>
          <div className="hint">in cart or checkout, no order</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Expected recoveries</div>
          <div className="value" style={{ color: '#3ecf8e' }}>
            ~{Math.round(marketForecast.expectedRecoveries)}
          </div>
          <div className="hint">if you re-engage them</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Expected recovery revenue</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {marketForecast.expectedRecoveryRevenue.formatted}
          </div>
          <div className="hint">at AOV {learned.aov.formatted}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Next 100 views → buys</div>
          <div className="value">~{marketForecast.next100Views.expectedPurchases}</div>
          <div className="hint">{marketForecast.next100Views.expectedRevenue.formatted}</div>
        </div>
      </div>

      <div className="ad-filters">
        {[
          ['story', 'The forecast'],
          ['buy', 'Likely to buy'],
          ['leave', 'Likely to leave'],
          ['all', 'Everyone'],
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

      {tab === 'story' && (
        <div className="ad-grid-2">
          <div className="ad-card">
            <h2>What we’re predicting</h2>
            {stories.map((s, i) => (
              <div
                key={i}
                className="ad-insight rec"
                style={{
                  borderLeftColor: i === 1 ? '#3ecf8e' : i === 3 ? '#ff6b7a' : '#7c6cf0',
                }}
              >
                <strong>{s.title}</strong>
                <div style={{ marginTop: 4 }}>{s.text}</div>
              </div>
            ))}
          </div>
          <div className="ad-card">
            <h2>What the system learned (used for forecasts)</h2>
            <p className="ad-muted" style={{ fontSize: '0.88rem' }}>
              Historical funnel the model trusts for “what happens next.”
            </p>
            <div className="ad-bar-row">
              <span>View → cart</span>
              <ChanceBar pct={learned.funnel.viewToCart} color="#3dd6c6" />
              <span>{learned.funnel.viewToCart}%</span>
            </div>
            <div className="ad-bar-row">
              <span>Cart → checkout</span>
              <ChanceBar pct={learned.funnel.cartToCheckout} color="#f0a06a" />
              <span>{learned.funnel.cartToCheckout}%</span>
            </div>
            <div className="ad-bar-row">
              <span>Checkout → buy</span>
              <ChanceBar pct={learned.funnel.checkoutToBuy} color="#3ecf8e" />
              <span>{learned.funnel.checkoutToBuy}%</span>
            </div>
            <div className="ad-bar-row">
              <span>View → buy overall</span>
              <ChanceBar pct={learned.funnel.viewToBuy} color="#7c6cf0" />
              <span>{learned.funnel.viewToBuy}%</span>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Buy chance by where they are now</h3>
            {Object.values(learned.buyRateByStage || {})
              .filter((s) => s.sampleSize > 0)
              .sort((a, b) => b.buyChancePct - a.buyChancePct)
              .map((s) => (
                <div className="ad-bar-row" key={s.stage}>
                  <span style={{ fontSize: '0.8rem' }}>{s.label}</span>
                  <ChanceBar pct={s.buyChancePct} />
                  <span>
                    {s.buyChancePct}% <span className="ad-muted">n={s.sampleSize}</span>
                  </span>
                </div>
              ))}

            <div className="ad-insight" style={{ marginTop: '1rem' }}>
              {marketForecast.plain}
            </div>
            <div className="ad-insight rec">{marketForecast.next100Views.plain}</div>
          </div>
        </div>
      )}

      {tab === 'buy' && (
        <div className="ad-card">
          <h2>Most likely to buy soon</h2>
          <p className="ad-muted">
            Non-buyers ranked by predicted purchase chance. Call / offer these first.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Now</th>
                <th>Buy chance</th>
                <th>Next step</th>
                <th>Expected $</th>
                <th>What to do</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {likelyToBuySoon.map((p) => (
                <tr key={p.userId}>
                  <td>
                    {p.name}
                    {p.isBot && <span className="ad-muted"> · bot</span>}
                    <div className="ad-muted" style={{ fontSize: '0.72rem' }}>
                      {p.confidence}% confidence
                    </div>
                  </td>
                  <td>
                    <span className="ad-pill">{p.currentStageLabel}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ChanceBar pct={p.willBuySoon.probability} color="#3ecf8e" />
                      <strong>{p.willBuySoon.probability}%</strong>
                    </div>
                    <span className="ad-pill ok">{p.willBuySoon.label}</span>
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>{p.nextAction.label}</td>
                  <td>{p.expectedRevenue.formatted}</td>
                  <td className="ad-muted" style={{ fontSize: '0.82rem', maxWidth: 220 }}>
                    {p.advice}
                  </td>
                  <td>
                    {p.botId ? (
                      <Link className="ad-btn" to={`/admin/bots/${p.botId}`}>
                        Open
                      </Link>
                    ) : (
                      <Link
                        className="ad-btn"
                        to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}
                      >
                        Profile
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!likelyToBuySoon.length && (
                <tr>
                  <td colSpan={7} className="ad-muted">
                    No strong “will buy” signals yet — need more cart/checkout activity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'leave' && (
        <div className="ad-card">
          <h2>Most likely to abandon</h2>
          <p className="ad-muted">
            In cart or checkout with high chance they walk away. Act before they cool off.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Stage</th>
                <th>Abandon risk</th>
                <th>Buy chance</th>
                <th>Predicted next</th>
                <th>Advice</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {likelyToAbandon.map((p) => (
                <tr key={p.userId}>
                  <td>{p.name}</td>
                  <td>
                    <span className="ad-pill warn">{p.currentStageLabel}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ChanceBar pct={p.willAbandon.probability} color="#ff6b7a" />
                      <strong style={{ color: '#ff6b7a' }}>{p.willAbandon.probability}%</strong>
                    </div>
                  </td>
                  <td>{p.willBuySoon.probability}%</td>
                  <td style={{ fontSize: '0.85rem' }}>{p.nextAction.label}</td>
                  <td className="ad-muted" style={{ fontSize: '0.82rem', maxWidth: 220 }}>
                    {p.advice}
                  </td>
                  <td>
                    {p.botId ? (
                      <Link className="ad-btn" to={`/admin/bots/${p.botId}`}>
                        Open
                      </Link>
                    ) : (
                      <Link
                        className="ad-btn"
                        to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}
                      >
                        Profile
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {!likelyToAbandon.length && (
                <tr>
                  <td colSpan={7} className="ad-muted">
                    No high abandon risks flagged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'all' && (
        <div className="ad-card">
          <h2>All forecasts</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Outlook</th>
                <th>Buy %</th>
                <th>Abandon %</th>
                <th>Next action</th>
                <th>AI type</th>
              </tr>
            </thead>
            <tbody>
              {all.map((p) => (
                <tr key={p.userId}>
                  <td>
                    {p.name}
                    <div className="ad-muted" style={{ fontSize: '0.72rem' }}>
                      {p.currentStageLabel}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`ad-pill ${
                        p.outlook.includes('Likely to buy')
                          ? 'ok'
                          : p.outlook.includes('walk')
                            ? 'warn'
                            : ''
                      }`}
                    >
                      {p.outlook}
                    </span>
                  </td>
                  <td>{p.willBuySoon.probability}%</td>
                  <td>{p.willAbandon.probability}%</td>
                  <td style={{ fontSize: '0.85rem' }}>{p.nextAction.label}</td>
                  <td className="ad-muted">
                    {p.transformer?.label || p.personaLabel || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
