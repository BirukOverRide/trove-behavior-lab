import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAdminLiveStream } from '../../hooks/useAdminLiveStream';
import AdminLearningDashboard from '../../components/AdminLearningDashboard';

// epochs used only for optional manual study

function ScoreBar({ label, value, max = 100, color = '#7c6cf0' }) {
  const pct = Math.min(100, (100 * value) / (max || 1));
  return (
    <div className="ad-bar-row">
      <span>{label}</span>
      <div className="ad-bar-track">
        <div className="ad-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span>{typeof value === 'number' && value <= 1 && max === 1 ? `${(value * 100).toFixed(0)}%` : value}</span>
    </div>
  );
}

export default function AdminAiPage() {
  const [data, setData] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [epochs] = useState(15);
  const [seedAi, setSeedAi] = useState([]);

  const liveStream = useAdminLiveStream({ enabled: true, maxEvents: 60 });

  const loadAi = () =>
    api
      .adminAi()
      .then((ai) => {
        setData(ai);
        setError('');
        if (ai?.realtime?.classifications?.length) {
          setSeedAi(ai.realtime.classifications);
        }
      })
      .catch((e) => setError(e.message));

  const loadFleet = () =>
    api
      .adminFleetBuyingAnalysis()
      .then((buy) => setFleet(buy))
      .catch(() => setFleet(null));

  const load = () => {
    // AI status first (fast) so the lab is never blocked by fleet analysis
    loadAi().then(() => loadFleet());
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!liveStream.dataset || !data) return;
    setData((d) =>
      d
        ? {
            ...d,
            dataset: {
              ...d.dataset,
              trainableExamples: liveStream.dataset.trainableExamples,
              behaviorEvents: liveStream.dataset.behaviorEvents,
              consumerProfiles: liveStream.dataset.consumerProfiles,
              bots: liveStream.dataset.bots,
              ready: liveStream.dataset.trainableExamples >= 3,
            },
          }
        : d
    );
  }, [liveStream.dataset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveStream.trainProgress) return;
    const p = liveStream.trainProgress;
    if (p.status === 'completed') {
      loadAi();
      loadFleet();
      setMsg(
        `${p.auto ? 'Auto-train' : 'Training'} finished · acc ${
          p.train_acc != null ? `${(p.train_acc * 100).toFixed(1)}%` : '—'
        }${p.reason ? ` · ${p.reason}` : ''}`
      );
    } else if (p.status === 'training' || p.status === 'starting') {
      if (p.auto) {
        setMsg(
          `Auto-training… epoch ${p.epoch || 0}/${p.epochs || '?'} · ${
            p.reason || 'new data'
          }`
        );
      }
    }
  }, [liveStream.trainProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!liveStream.autoTrain?.message) return;
    setMsg(liveStream.autoTrain.message);
    if (
      liveStream.autoTrain.status === 'completed' ||
      liveStream.autoTrain.status === 'started'
    ) {
      loadAi();
    }
  }, [liveStream.autoTrain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge SSE AI updates into seed so classifications never look empty after refresh
  useEffect(() => {
    if (!liveStream.aiUpdates?.length) return;
    setSeedAi((prev) => {
      const map = new Map();
      for (const a of [...liveStream.aiUpdates, ...prev]) {
        const k = a.profileKey || a.botId;
        if (k && !map.has(k)) map.set(k, a);
      }
      return [...map.values()].slice(0, 40);
    });
  }, [liveStream.aiUpdates]);

  const startTrain = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await api.adminAiTrain({ epochs: Number(epochs) || 20 });
      setMsg(
        `Manual retrain started · ${r.samples} journey examples · ${r.epochs} epochs`
      );
      loadAi();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = async (enabled) => {
    try {
      await api.adminAiAutoSet({ enabled });
      loadAi();
      setMsg(enabled ? 'Auto-train ON — model trains itself on new data' : 'Auto-train OFF');
    } catch (e) {
      setError(e.message);
    }
  };

  const history = useMemo(() => {
    if (!data) return [];
    const tp = liveStream.trainProgress;
    if (tp?.history?.length) return tp.history;
    const progress = data.live?.progress || {};
    if (progress.history?.length) return progress.history;
    if (data.lastCompleted?.history?.length) return data.lastCompleted.history;
    return [];
  }, [data, liveStream.trainProgress]);

  if (error && !data) {
    return (
      <div>
        <div className="ad-alert">{error}</div>
        <p className="ad-muted">
          API must be running on port 8000. Sign in as{' '}
          <code>admin@trove.shop</code> / <code>admin123</code>.
        </p>
        <button type="button" className="ad-btn primary" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return <p className="ad-muted">Loading Tiny AI console…</p>;

  const { model, dataset, live, lastCompleted, runs, evolutionAcrossRuns, autoTrain } = data;
  const auto = liveStream.autoTrain || autoTrain || {};
  const progress = liveStream.trainProgress || live?.progress || {};
  const training =
    live?.running ||
    progress.status === 'training' ||
    progress.status === 'starting' ||
    (liveStream.trainProgress &&
      ['training', 'starting'].includes(liveStream.trainProgress.status));

  // SSE updates preferred; seed from API/cache so table is never empty after load
  const liveClassified =
    liveStream.aiUpdates?.length > 0 ? liveStream.aiUpdates : seedAi;

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>AI training</h1>
          <p>
            {liveStream.connected ? (
              <span className="ad-pill ok">Live</span>
            ) : (
              <span className="ad-pill warn">Connecting…</span>
            )}{' '}
            {(auto.enabled ?? autoTrain?.enabled) !== false ? (
              <span className="ad-pill ok">Auto-study ON</span>
            ) : (
              <span className="ad-pill warn">Auto-study OFF</span>
            )}{' '}
            The model studies shopper paths by itself. For the future, open{' '}
            <Link to="/admin/predictions">Future predictions</Link>
            {' · '}
            <Link to="/admin/buyers">Buyer behavior</Link>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link to="/admin/predictions" className="ad-btn primary">
            See predictions
          </Link>
          <button
            type="button"
            className="ad-btn"
            onClick={() => toggleAuto(!(auto.enabled ?? autoTrain?.enabled !== false))}
          >
            {(auto.enabled ?? autoTrain?.enabled) !== false ? 'Pause auto-study' : 'Enable auto-study'}
          </button>
          <button
            type="button"
            className="ad-btn"
            onClick={startTrain}
            disabled={busy || training || !dataset.ready}
            title="Optional"
          >
            {training ? 'Studying…' : 'Study now'}
          </button>
        </div>
      </div>

      <div
        className="ad-card"
        style={{
          marginBottom: '1rem',
          borderColor: training ? 'rgba(124,108,240,0.5)' : 'rgba(62,207,142,0.35)',
        }}
      >
        <div className="ad-topbar" style={{ marginBottom: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
              <span className="ad-live-dot" />
              Status
            </h2>
            <p className="ad-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.88rem' }}>
              {training
                ? 'Studying shopper journeys right now…'
                : autoTrain?.nextHint ||
                  auto.nextHint ||
                  'Waiting for new journeys — then it studies again by itself.'}
            </p>
          </div>
          <div className="ad-chip-list">
            {training && <span className="ad-pill warn">Busy</span>}
            {!training && (auto.enabled ?? true) && (
              <span className="ad-pill ok">Ready</span>
            )}
            {autoTrain?.lastResult?.trainAcc != null && (
              <span className="ad-chip">
                last score {(autoTrain.lastResult.trainAcc * 100).toFixed(0)}% correct
              </span>
            )}
            <span className="ad-chip">
              {autoTrain?.currentExamples ?? dataset.trainableExamples} journeys in memory
            </span>
          </div>
        </div>
      </div>

      {error && <div className="ad-alert">{error}</div>}
      {msg && (
        <div className="ad-alert" style={{ background: 'rgba(62,207,142,0.12)', color: '#3ecf8e' }}>
          {msg}
        </div>
      )}

      <div className="ad-kpi-grid">
        <div className="ad-kpi">
          <div className="label">Trainable journeys</div>
          <div className="value">{dataset.trainableExamples}</div>
          <div className="hint">{dataset.ready ? 'Ready to train' : 'Need ≥ 3 journeys'}</div>
        </div>
        <div className="ad-kpi">
          <div className="label">Last accuracy</div>
          <div className="value">
            {lastCompleted?.trainAcc != null
              ? `${(lastCompleted.trainAcc * 100).toFixed(0)}%`
              : '—'}
          </div>
          <div className="hint">
            {lastCompleted
              ? `loss ${Number(lastCompleted.finalLoss || 0).toFixed(3)}`
              : 'No completed run'}
          </div>
        </div>
        <div className="ad-kpi">
          <div className="label">Model file</div>
          <div className="value" style={{ fontSize: '1.05rem' }}>
            {model.file?.exists ? 'Loaded' : 'Missing'}
          </div>
        </div>
        <div className="ad-kpi">
          <div className="label">Journeys in training</div>
          <div className="value">{dataset.trainableExamples}</div>
          <div className="hint">
            {dataset.coverage
              ? `${dataset.coverage.fromBots ?? '—'} from bots · ${dataset.coverage.fromHumans ?? '—'} human`
              : 'All profiles with paths'}
          </div>
        </div>
        <div className="ad-kpi">
          <div className="label">Bots learned from</div>
          <div className="value">
            {dataset.coverage?.fromBots ?? fleet?.fleet?.botsAnalyzed ?? '—'}
          </div>
          <div className="hint">
            {dataset.coverage
              ? `of ${dataset.coverage.botsWithActivity ?? '—'} active / ${dataset.coverage.botsInDb ?? dataset.bots} total`
              : fleet?.fleet?.coveredAllActive
                ? `all ${fleet.fleet.totalActiveBots} active`
                : fleet?.fleet
                  ? `${fleet.fleet.botsAnalyzed} in fleet report`
                  : '—'}
          </div>
        </div>
        <div className="ad-kpi">
          <div className="label">Fleet report</div>
          <div className="value">{fleet?.fleet?.botsAnalyzed ?? '—'}</div>
          <div className="hint">
            buying table · {fleet?.fleet?.totalSpent?.formatted || '$0'} sim revenue
          </div>
        </div>
      </div>

      <AdminLearningDashboard
        history={history}
        liveProgress={progress}
        lastCompleted={lastCompleted}
        runs={runs || []}
        evolutionAcrossRuns={evolutionAcrossRuns || []}
        dataset={dataset}
      />

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Dataset labels</h2>
          {Object.entries(dataset.labelDistribution || {})
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => {
              const max = Math.max(...Object.values(dataset.labelDistribution || { x: 1 }), 1);
              return (
                <ScoreBar key={label} label={label} value={count} max={max} color="#3dd6c6" />
              );
            })}
          {!Object.keys(dataset.labelDistribution || {}).length && (
            <p className="ad-muted">
              No journeys yet. <Link to="/admin/bots/active">Run active bots</Link> first.
            </p>
          )}
        </div>
        <div className="ad-card">
          <h2>Architecture</h2>
          <div className="ad-chip-list">
            <span className="ad-chip">{model.architecture.type}</span>
            <span className="ad-chip">d={model.architecture.d_model}</span>
            <span className="ad-chip">{model.architecture.n_heads} heads</span>
            <span className="ad-chip">{model.architecture.n_layers} layers</span>
          </div>
          <p className="ad-muted" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
            {model.description} Each bot journey is tokenized and classified into a consumer
            persona; buying funnels are scored separately in high detail.
          </p>
        </div>
      </div>

      {/* Real-time classifications strip */}
      <div className="ad-card" style={{ marginBottom: '1rem' }}>
        <h2>
          <span className="ad-live-dot" />
          Who the AI thinks people are (live)
        </h2>
        <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
          Updates when bots or shoppers act. For “will they buy?”, go to{' '}
          <Link to="/admin/predictions">Future predictions</Link>.
        </p>
        {!liveClassified.length && (
          <p className="ad-muted">
            Waiting for events…{' '}
            <Link to="/admin/bots/active">Run an active bot</Link> to feed the AI.
          </p>
        )}
        <table className="ad-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Bot / shopper</th>
              <th>Last action</th>
              <th>Rules say</th>
              <th>AI says</th>
              <th>Intent</th>
            </tr>
          </thead>
          <tbody>
            {liveClassified.slice(0, 15).map((a) => (
              <tr key={a.profileKey + a.updatedAt}>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  {a.updatedAt
                    ? new Date(a.updatedAt).toLocaleTimeString()
                    : '—'}
                </td>
                <td>
                  {a.botId ? (
                    <Link to={`/admin/bots/${a.botId}`}>{a.botName || a.displayName}</Link>
                  ) : (
                    a.displayName
                  )}
                </td>
                <td className="ad-mono">{a.lastEventType}</td>
                <td>
                  <span className="ad-pill">{a.rulePersona}</span>
                </td>
                <td>
                  {a.transformer?.label ? (
                    <>
                      <span className="ad-pill teal">{a.transformer.label}</span>{' '}
                      {((a.transformer.confidence || 0) * 100).toFixed(0)}%
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{a.scores?.purchaseIntent ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-bot buying + AI */}
      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <div className="ad-topbar" style={{ marginBottom: '0.75rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Buying behavior deep dive (fleet)</h2>
            <p className="ad-muted" style={{ margin: '0.35rem 0 0' }}>
              Funnel conversion, spend, abandon risk · open a bot for session-level analysis
            </p>
          </div>
          <Link to="/admin/bots/active" className="ad-btn">
            Active bots
          </Link>
        </div>

        {fleet?.fleet && (
          <div className="ad-chip-list" style={{ marginBottom: '0.75rem' }}>
            <span className="ad-chip">
              Orders {fleet.fleet.totalOrders}
            </span>
            <span className="ad-chip">
              Avg view→buy {fleet.fleet.avgConversion}%
            </span>
            {Object.entries(fleet.fleet.stageCounts || {}).map(([k, v]) => (
              <span key={k} className="ad-pill">
                {k}: {v}
              </span>
            ))}
          </div>
        )}

        <table className="ad-table">
          <thead>
            <tr>
              <th>Bot</th>
              <th>Buyer stage</th>
              <th>Funnel</th>
              <th>Spend</th>
              <th>Intent / risk</th>
              <th>Tiny TF</th>
              <th>Top insight</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(fleet?.bots || []).map((b) => (
              <tr key={b.botId}>
                <td>
                  <Link to={`/admin/bots/${b.botId}`}>
                    <strong>{b.displayName}</strong>
                  </Link>
                  <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                    DNA: {b.personaLabel}
                  </div>
                </td>
                <td>
                  <span className="ad-pill teal">{b.buyerStage}</span>
                </td>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  V{b.funnel.views} → C{b.funnel.addToCart} → X{b.funnel.beginCheckout} → P
                  {b.funnel.purchase}
                  <br />
                  view→buy <strong>{b.funnel.viewToPurchase}%</strong>
                </td>
                <td>
                  {b.commerce.totalSpent.formatted}
                  <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                    {b.commerce.orders} orders · AOV {b.commerce.aov.formatted}
                  </div>
                </td>
                <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
                  intent {b.scores.purchaseIntent}
                  <br />
                  risk {b.scores.abandonRisk}
                </td>
                <td>
                  {b.transformer?.label ? (
                    <>
                      <span className="ad-pill">{b.transformer.label}</span>
                      <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                        {((b.transformer.confidence || 0) * 100).toFixed(0)}% conf
                      </div>
                    </>
                  ) : (
                    <span className="ad-muted">not trained</span>
                  )}
                </td>
                <td className="ad-muted" style={{ fontSize: '0.8rem', maxWidth: 220 }}>
                  {b.topInsight}
                </td>
                <td>
                  <Link className="ad-btn" to={`/admin/bots/${b.botId}`}>
                    Full analysis
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!fleet?.bots?.length && (
          <p className="ad-muted">
            No bot activity to analyze. Create bots and run sessions first.
          </p>
        )}
      </div>

      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>Training run history</h2>
        <table className="ad-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Status</th>
              <th>Samples</th>
              <th>Epochs</th>
              <th>Accuracy</th>
              <th>Final loss</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {(runs || []).map((r) => (
              <tr key={r.id}>
                <td className="ad-muted" style={{ fontSize: '0.82rem' }}>
                  {r.createdAt}
                </td>
                <td>
                  <span
                    className={
                      r.status === 'completed'
                        ? 'ad-pill ok'
                        : r.status === 'failed'
                          ? 'ad-pill danger'
                          : 'ad-pill warn'
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td>{r.samples ?? '—'}</td>
                <td>{r.epochs ?? '—'}</td>
                <td>
                  {r.trainAcc != null ? `${(r.trainAcc * 100).toFixed(1)}%` : '—'}
                </td>
                <td>{r.finalLoss != null ? Number(r.finalLoss).toFixed(4) : '—'}</td>
                <td>{r.seconds != null ? `${Number(r.seconds).toFixed(1)}s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
