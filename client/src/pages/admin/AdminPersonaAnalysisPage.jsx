import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

function ShareBar({ pct, color = '#7c6cf0' }) {
  return (
    <div className="ad-bar-track" style={{ minWidth: 80 }}>
      <div
        className="ad-bar-fill"
        style={{ width: `${Math.min(100, pct || 0)}%`, background: color }}
      />
    </div>
  );
}

function ScoreRow({ label, value, color }) {
  return (
    <div className="ad-bar-row">
      <span>{label}</span>
      <div className="ad-bar-track">
        <div
          className="ad-bar-fill"
          style={{ width: `${Math.min(100, value || 0)}%`, background: color || undefined }}
        />
      </div>
      <span>{value ?? 0}</span>
    </div>
  );
}

export default function AdminPersonaAnalysisPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('categories');

  const load = () => {
    api
      .adminPersonaAnalysis()
      .then((d) => {
        setData(d);
        setError('');
        if (!selected && d.personas?.length) {
          setSelected(d.personas.find((p) => p.count > 0)?.persona || d.personas[0].persona);
        }
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activePersona = useMemo(() => {
    if (!data?.personas) return null;
    return data.personas.find((p) => p.persona === selected) || data.personas[0];
  }, [data, selected]);

  if (error && !data) return <div className="ad-alert">{error}</div>;
  if (!data) return <p className="ad-muted">Building persona analysis…</p>;

  const { summary, categories, personas, aiDistribution, ruleVsAi, insights, catalog } = data;
  const present = personas.filter((p) => p.count > 0);

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>Persona analysis</h1>
          <p>
            All shoppers grouped by <strong>behavior</strong> — rule personas, funnels, spend, and
            Tiny AI labels. Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <button type="button" className="ad-btn primary" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      {/* Summary KPIs */}
      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Profiles analyzed</div>
          <div className="value">{summary.totalProfiles}</div>
          <div className="hint">
            {summary.totalBots} bots · {summary.totalHumans} human
          </div>
        </div>
        <div className="ad-kpi">
          <div className="label">Dominant persona</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {summary.dominantPersona?.label || '—'}
          </div>
          <div className="hint">{summary.dominantPersona?.sharePct ?? 0}% of population</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Behavior category</div>
          <div className="value" style={{ fontSize: '1.1rem' }}>
            {summary.dominantCategory?.label || '—'}
          </div>
          <div className="hint">{summary.dominantCategory?.sharePct ?? 0}% share</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Total spent</div>
          <div className="value" style={{ fontSize: '1.15rem' }}>
            {summary.totalSpent?.formatted}
          </div>
          <div className="hint">{summary.totalPurchases} purchases</div>
        </div>
        <div className="ad-kpi">
          <div className="label">AI vs rules</div>
          <div className="value">{summary.aiAgreementPct}%</div>
          <div className="hint">agree on {summary.aiClassified} classified</div>
        </div>
      </div>

      {/* Narrative insights */}
      <div className="ad-card" style={{ marginBottom: '1rem' }}>
        <h2>Behavior conclusions</h2>
        {insights.map((ins, i) => (
          <div
            key={i}
            className={`ad-insight ${
              ins.kind === 'risk' ? '' : ins.kind === 'positive' ? 'rec' : ''
            }`}
            style={
              ins.kind === 'risk'
                ? { borderLeftColor: '#ff6b7a' }
                : ins.kind === 'model'
                  ? { borderLeftColor: '#7c6cf0' }
                  : undefined
            }
          >
            {ins.text}
          </div>
        ))}
      </div>

      <div className="ad-filters" style={{ marginBottom: '0.75rem' }}>
        {[
          ['categories', 'Behavior categories'],
          ['personas', 'All personas'],
          ['ai', 'Tiny AI view'],
          ['catalog', 'Persona catalog'],
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

      {/* ——— CATEGORIES ——— */}
      {tab === 'categories' && (
        <div className="ad-grid-2">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="ad-card"
              style={{ borderTop: `3px solid ${cat.color}` }}
            >
              <div className="ad-topbar" style={{ marginBottom: '0.5rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{cat.label}</h2>
                  <p className="ad-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
                    {cat.description}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{cat.count}</div>
                  <div className="ad-muted" style={{ fontSize: '0.8rem' }}>
                    {cat.sharePct}%
                  </div>
                </div>
              </div>
              <ShareBar pct={cat.sharePct} color={cat.color} />
              <div className="ad-chip-list" style={{ marginTop: 10 }}>
                <span className="ad-chip">spent {cat.spent.formatted}</span>
                <span className="ad-chip">purchases {cat.purchaseCount}</span>
                <span className="ad-chip">intent ~{cat.avgPurchaseIntent}</span>
                <span className="ad-chip">abandon ~{cat.avgAbandonRisk}</span>
              </div>
              <h3 style={{ marginTop: '0.85rem', fontSize: '0.9rem' }}>Personas in this group</h3>
              {cat.breakdown.length ? (
                cat.breakdown.map((b) => (
                  <div
                    key={b.persona}
                    className="ad-bar-row"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelected(b.persona);
                      setTab('personas');
                    }}
                  >
                    <span className="ad-mono" style={{ fontSize: '0.75rem' }}>
                      {b.label}
                    </span>
                    <ShareBar pct={b.sharePct} color={cat.color} />
                    <span>
                      {b.count} ({b.sharePct}%)
                    </span>
                  </div>
                ))
              ) : (
                <p className="ad-muted">No profiles in this category yet.</p>
              )}
              {cat.behaviorSignals?.length > 0 && (
                <>
                  <h3 style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>Signals</h3>
                  <div className="ad-chip-list">
                    {cat.behaviorSignals.map((s) => (
                      <span key={s} className="ad-chip">
                        {s}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ——— PERSONAS ——— */}
      {tab === 'personas' && (
        <div className="ad-grid-2">
          <div className="ad-card">
            <h2>Population by persona</h2>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Click a row for deep dive. Share = % of all profiles.
            </p>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>n</th>
                  <th>Share</th>
                  <th>Intent</th>
                  <th>Abandon</th>
                  <th>View→buy</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {present.map((p) => (
                  <tr
                    key={p.persona}
                    onClick={() => setSelected(p.persona)}
                    style={{
                      cursor: 'pointer',
                      background:
                        selected === p.persona ? 'rgba(124,108,240,0.12)' : undefined,
                    }}
                  >
                    <td>
                      <strong>{p.label}</strong>
                      <div className="ad-muted" style={{ fontSize: '0.72rem' }}>
                        {p.categoryLabel}
                      </div>
                    </td>
                    <td>{p.count}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShareBar pct={p.sharePct} />
                        <span>{p.sharePct}%</span>
                      </div>
                    </td>
                    <td>{p.avgScores.purchaseIntent}</td>
                    <td
                      style={{
                        color: p.avgScores.abandonRisk >= 55 ? '#ff6b7a' : undefined,
                      }}
                    >
                      {p.avgScores.abandonRisk}
                    </td>
                    <td>{p.funnel.viewToBuy}%</td>
                    <td>{p.spent.formatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {catalog.filter((c) => !present.find((p) => p.persona === c.persona)).length >
              0 && (
              <>
                <h3 style={{ marginTop: '1rem' }}>Defined but empty</h3>
                <div className="ad-chip-list">
                  {catalog
                    .filter((c) => !present.find((p) => p.persona === c.persona))
                    .map((c) => (
                      <span key={c.persona} className="ad-chip">
                        {c.label}
                      </span>
                    ))}
                </div>
              </>
            )}
          </div>

          <div className="ad-card">
            {activePersona ? (
              <>
                <h2>{activePersona.label}</h2>
                <p className="ad-muted">{activePersona.blurb}</p>
                <div className="ad-chip-list" style={{ marginBottom: '0.75rem' }}>
                  <span className="ad-pill">{activePersona.categoryLabel}</span>
                  <span className="ad-chip">{activePersona.count} profiles</span>
                  <span className="ad-chip">
                    {activePersona.bots} bots · {activePersona.humans} human
                  </span>
                  <span className="ad-chip">{activePersona.sharePct}% of all</span>
                </div>

                <h3>Average scores</h3>
                <ScoreRow
                  label="Purchase intent"
                  value={activePersona.avgScores.purchaseIntent}
                  color="#3ecf8e"
                />
                <ScoreRow
                  label="Abandon risk"
                  value={activePersona.avgScores.abandonRisk}
                  color="#ff6b7a"
                />
                <ScoreRow
                  label="Engagement"
                  value={activePersona.avgScores.engagement}
                  color="#3dd6c6"
                />
                <ScoreRow
                  label="Loyalty"
                  value={activePersona.avgScores.loyalty}
                  color="#7c6cf0"
                />
                <ScoreRow
                  label="Price sensitivity"
                  value={activePersona.avgScores.priceSensitivity}
                  color="#e9c46a"
                />

                <h3 style={{ marginTop: '0.85rem' }}>Funnel (aggregate)</h3>
                <div className="ad-chip-list">
                  <span className="ad-chip">views {activePersona.funnel.views}</span>
                  <span className="ad-chip">searches {activePersona.funnel.searches}</span>
                  <span className="ad-chip">carts {activePersona.funnel.carts}</span>
                  <span className="ad-chip">checkouts {activePersona.funnel.checkouts}</span>
                  <span className="ad-chip">purchases {activePersona.funnel.purchases}</span>
                </div>
                <p className="ad-muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
                  view→cart {activePersona.funnel.viewToCart}% · cart→buy{' '}
                  {activePersona.funnel.cartToBuy}% · view→buy {activePersona.funnel.viewToBuy}%
                </p>

                <h3 style={{ marginTop: '0.85rem' }}>Behavior signals</h3>
                <div className="ad-chip-list">
                  {activePersona.behaviorSignals.map((s) => (
                    <span key={s} className="ad-pill teal">
                      {s}
                    </span>
                  ))}
                </div>

                <h3 style={{ marginTop: '0.85rem' }}>Commerce</h3>
                <div className="ad-chip-list">
                  <span className="ad-chip">orders {activePersona.purchaseCount}</span>
                  <span className="ad-chip">spent {activePersona.spent.formatted}</span>
                  <span className="ad-chip">avg / profile {activePersona.avgSpent.formatted}</span>
                  <span className="ad-chip">avg events {activePersona.avgEvents}</span>
                </div>

                {activePersona.topCategories?.length > 0 && (
                  <>
                    <h3 style={{ marginTop: '0.85rem' }}>Top categories</h3>
                    <div className="ad-chip-list">
                      {activePersona.topCategories.map((c) => (
                        <span key={c.name} className="ad-chip">
                          {c.name} · {c.count}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                <h3 style={{ marginTop: '0.85rem' }}>Tiny AI on this persona</h3>
                <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
                  {activePersona.ai.labeled
                    ? `Labeled ${activePersona.ai.labeled} · agrees with rules ${activePersona.ai.agreementPct}%`
                    : 'No live AI labels for these profiles yet — run bots or wait for warm cache.'}
                </p>
                {activePersona.ai.topPredictions?.length > 0 && (
                  <div className="ad-chip-list">
                    {activePersona.ai.topPredictions.map((t) => (
                      <span key={t.name} className="ad-chip">
                        AI says {t.name} ×{t.count}
                      </span>
                    ))}
                  </div>
                )}

                <h3 style={{ marginTop: '0.85rem' }}>Sample members</h3>
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Events</th>
                      <th>Intent</th>
                      <th>AI</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePersona.members.map((m) => (
                      <tr key={m.profileKey}>
                        <td>
                          {m.displayName}
                          {m.isBot && (
                            <span className="ad-muted" style={{ fontSize: '0.72rem' }}>
                              {' '}
                              · bot
                            </span>
                          )}
                        </td>
                        <td>{m.eventCount}</td>
                        <td>{m.purchaseIntent}</td>
                        <td>
                          {m.transformer ? (
                            <span
                              className={`ad-pill ${m.transformer.agrees ? 'ok' : 'warn'}`}
                            >
                              {m.transformer.label}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {m.botId ? (
                            <Link className="ad-btn" to={`/admin/bots/${m.botId}`}>
                              Bot
                            </Link>
                          ) : (
                            <Link
                              className="ad-btn"
                              to={`/admin/profiles/${encodeURIComponent(m.profileKey)}`}
                            >
                              Profile
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="ad-muted">Select a persona.</p>
            )}
          </div>
        </div>
      )}

      {/* ——— AI VIEW ——— */}
      {tab === 'ai' && (
        <div className="ad-grid-2">
          <div className="ad-card">
            <h2>How Tiny AI categorizes them</h2>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Distribution of live transformer labels (not the same as rule persona).
            </p>
            {aiDistribution?.length ? (
              aiDistribution.map((a) => (
                <div key={a.label} className="ad-bar-row">
                  <span className="ad-mono" style={{ fontSize: '0.75rem' }}>
                    {a.meta?.label || a.label}
                  </span>
                  <ShareBar pct={a.sharePct} color="#3dd6c6" />
                  <span>
                    {a.count} ({a.sharePct}%)
                  </span>
                </div>
              ))
            ) : (
              <p className="ad-muted">
                No AI classifications in cache yet. Play bots or open Tiny AI to warm labels.
              </p>
            )}
            <div className="ad-chip-list" style={{ marginTop: 12 }}>
              <span className="ad-chip">compared {ruleVsAi.compared}</span>
              <span className="ad-chip">agree {ruleVsAi.agree}</span>
              <span className="ad-pill ok">{ruleVsAi.agreementPct}% agreement</span>
            </div>
          </div>
          <div className="ad-card">
            <h2>Rule persona vs Tiny AI</h2>
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Top pairs — matches and mismatches between behavior rules and the model.
            </p>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>AI</th>
                  <th>n</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(ruleVsAi.topPairs || []).map((p, i) => (
                  <tr key={i}>
                    <td className="ad-mono">{p.rule}</td>
                    <td className="ad-mono">{p.ai}</td>
                    <td>{p.count}</td>
                    <td>
                      <span className={`ad-pill ${p.match ? 'ok' : 'warn'}`}>
                        {p.match ? 'match' : 'disagree'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ——— CATALOG ——— */}
      {tab === 'catalog' && (
        <div className="ad-card">
          <h2>Persona catalog (behavior definitions)</h2>
          <p className="ad-muted" style={{ fontSize: '0.88rem' }}>
            Every persona the system can assign from shopping behavior.
          </p>
          <div className="ad-grid-2">
            {catalog.map((c) => {
              const live = personas.find((p) => p.persona === c.persona);
              return (
                <div
                  key={c.persona}
                  className="ad-insight"
                  style={{ cursor: live?.count ? 'pointer' : undefined }}
                  onClick={() => {
                    if (live?.count) {
                      setSelected(c.persona);
                      setTab('personas');
                    }
                  }}
                >
                  <strong>{c.label}</strong>
                  <span className="ad-pill" style={{ marginLeft: 8 }}>
                    {c.categoryLabel}
                  </span>
                  {live?.count ? (
                    <span className="ad-chip" style={{ marginLeft: 6 }}>
                      {live.count} live
                    </span>
                  ) : (
                    <span className="ad-muted" style={{ marginLeft: 6, fontSize: '0.8rem' }}>
                      none yet
                    </span>
                  )}
                  <div className="ad-muted" style={{ marginTop: 6, fontSize: '0.88rem' }}>
                    {c.blurb}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
