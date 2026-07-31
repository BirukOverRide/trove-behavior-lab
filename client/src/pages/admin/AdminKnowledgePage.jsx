/**
 * What the AI knows — plain English knowledge dump.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

function skillClass(skill) {
  if (skill === 'Strong') return 'ok';
  if (skill === 'OK') return 'teal';
  if (skill === 'Weak') return 'warn';
  if (skill === 'Poor') return 'danger';
  return '';
}

export default function AdminKnowledgePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = () => {
    api
      .adminKnowledge()
      .then((d) => {
        setData(d);
        setError('');
        if (!openId && d.personas?.[0]) setOpenId(d.personas[0].id);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  if (!data) return <p className="ad-muted">Reading what the AI knows…</p>;

  const {
    headline,
    iKnow,
    model,
    personas,
    emptyPersonas,
    buying,
    stages,
    confusions,
    mistakeThemes,
    howToRead,
  } = data;

  const active = personas.find((p) => p.id === openId) || personas[0];

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>What the AI knows</h1>
          <p>
            Not charts — the actual knowledge. Updated{' '}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/predictions" className="ad-btn">
            Predictions
          </Link>
          <Link to="/admin/buyers" className="ad-btn">
            Buyer behavior
          </Link>
          <button type="button" className="ad-btn primary" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div className="ad-card" style={{ marginBottom: '1rem', borderColor: 'rgba(61,214,198,0.45)' }}>
        <h2 style={{ marginTop: 0 }}>{headline}</h2>
        <p className="ad-muted" style={{ fontSize: '0.88rem' }}>
          {howToRead?.join(' ')}
        </p>
        <ol style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.55 }}>
          {iKnow.map((line, i) => (
            <li key={i} style={{ marginBottom: '0.55rem' }}>
              {line}
            </li>
          ))}
        </ol>
        <div className="ad-chip-list" style={{ marginTop: '0.85rem' }}>
          <span className="ad-chip">
            model {model.exists ? 'loaded' : 'missing'}
          </span>
          {model.lastTrainAcc != null && (
            <span className="ad-chip">
              last train {Math.round(model.lastTrainAcc * 100)}% correct
            </span>
          )}
          {model.lastSamples != null && (
            <span className="ad-chip">{model.lastSamples} journeys studied</span>
          )}
          {model.vocabSize != null && (
            <span className="ad-chip">vocab {model.vocabSize} tokens</span>
          )}
          {model.bestEpoch != null && (
            <span className="ad-chip">kept best round {model.bestEpoch}</span>
          )}
        </div>
      </div>

      <div className="ad-grid-2">
        {/* Persona list */}
        <div className="ad-card">
          <h2>Shopper types it knows</h2>
          <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
            Click a type to see the paths and rules it learned for that type.
          </p>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Examples</th>
                <th>Skill</th>
                <th>Right %</th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setOpenId(p.id)}
                  style={{
                    cursor: 'pointer',
                    background: openId === p.id ? 'rgba(124,108,240,0.12)' : undefined,
                  }}
                >
                  <td>
                    <strong>{p.label}</strong>
                    <div className="ad-muted" style={{ fontSize: '0.72rem' }}>
                      {p.blurb}
                    </div>
                  </td>
                  <td>{p.examples}</td>
                  <td>
                    <span className={`ad-pill ${skillClass(p.skill)}`}>{p.skill}</span>
                  </td>
                  <td>
                    {p.accuracy != null ? `${Math.round(p.accuracy * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {emptyPersonas?.length > 0 && (
            <>
              <h3 style={{ marginTop: '1rem' }}>Barely known (no examples)</h3>
              <div className="ad-chip-list">
                {emptyPersonas.map((p) => (
                  <span key={p.id} className="ad-chip">
                    {p.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Detail card */}
        <div className="ad-card">
          {active ? (
            <>
              <h2>{active.label}</h2>
              <p className="ad-muted">{active.blurb}</p>
              <div className="ad-chip-list" style={{ marginBottom: '0.75rem' }}>
                <span className={`ad-pill ${skillClass(active.skill)}`}>{active.skill}</span>
                <span className="ad-chip">{active.examples} examples</span>
                {active.accuracy != null && (
                  <span className="ad-chip">
                    {Math.round(active.accuracy * 100)}% correct
                  </span>
                )}
                {active.f1 != null && (
                  <span className="ad-chip">F1 {Math.round(active.f1 * 100)}%</span>
                )}
              </div>

              <h3>Facts</h3>
              {active.facts.map((f, i) => (
                <div key={i} className="ad-insight" style={{ marginBottom: 6 }}>
                  {f}
                </div>
              ))}

              <h3 style={{ marginTop: '0.85rem' }}>What it looks for (path tokens)</h3>
              {active.topTokens?.length ? (
                <div className="ad-chip-list">
                  {active.topTokens.map((t) => (
                    <span key={t.token} className="ad-chip" title={`share ${((t.share || 0) * 100).toFixed(0)}%`}>
                      {t.token} · {t.count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="ad-muted">No token signature yet — retrain after more data.</p>
              )}

              <h3 style={{ marginTop: '0.85rem' }}>Rules in plain English</h3>
              {active.rules?.length ? (
                active.rules.map((r, i) => (
                  <div key={i} className="ad-insight rec" style={{ marginBottom: 6 }}>
                    {r}
                  </div>
                ))
              ) : (
                <p className="ad-muted">No rules extracted yet.</p>
              )}

              <h3 style={{ marginTop: '0.85rem' }}>Example journeys it studied</h3>
              {active.exampleJourneys?.length ? (
                active.exampleJourneys.map((j, i) => (
                  <div key={i} className="ad-journey" style={{ marginBottom: 8, fontSize: '0.72rem' }}>
                    {j}
                  </div>
                ))
              ) : (
                <p className="ad-muted">No example paths stored for this type.</p>
              )}
            </>
          ) : (
            <p className="ad-muted">No persona knowledge yet.</p>
          )}
        </div>
      </div>

      {/* Buying knowledge */}
      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>Buying numbers it uses</h2>
        <p className="ad-muted" style={{ fontSize: '0.88rem' }}>
          These conversion rates power “what happens next” forecasts.
        </p>
        <div className="ad-kpi-grid">
          {buying.map((b) => (
            <div key={b.title} className="ad-kpi">
              <div className="label">{b.title}</div>
              <div className="value" style={{ fontSize: '1.25rem' }}>
                {b.value}
              </div>
              <div className="hint">{b.plain}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ad-grid-2" style={{ marginTop: '1rem' }}>
        <div className="ad-card">
          <h2>Buyer stages it understands</h2>
          {stages.map((s) => (
            <div key={s.id} className="ad-insight" style={{ marginBottom: 6 }}>
              <strong>{s.label}.</strong> {s.meaning}
            </div>
          ))}
        </div>
        <div className="ad-card">
          <h2>Where it still gets confused</h2>
          {mistakeThemes?.length || confusions?.length ? (
            <>
              {(mistakeThemes || []).map((m, i) => (
                <div key={`m${i}`} className="ad-insight" style={{ borderLeftColor: '#ff6b7a', marginBottom: 6 }}>
                  {m.plain}
                </div>
              ))}
              {(confusions || []).slice(0, 5).map((c, i) => (
                <div key={`c${i}`} className="ad-muted" style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                  {c.plain}
                </div>
              ))}
            </>
          ) : (
            <p className="ad-muted">
              No confusion data yet — complete a training run so mistakes are stored.
            </p>
          )}
          <p className="ad-muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            To grow knowledge: run more bots of weak types, then let auto-train study again.
          </p>
        </div>
      </div>
    </div>
  );
}
