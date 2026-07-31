/**
 * Friendly learning status — plain language first, details optional.
 */
import { useMemo, useState } from 'react';

function SimpleLine({ history, keyName, color = '#7c6cf0', better = 'down' }) {
  if (!history?.length) {
    return (
      <p className="ad-muted" style={{ fontSize: '0.9rem' }}>
        No training run yet. Auto-train will fill this when it studies journeys.
      </p>
    );
  }
  const vals = history.map((h) => h[keyName]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals, min + 0.01);
  const w = 520;
  const h = 120;
  const pad = 16;
  const pts = vals
    .map((v, i) => {
      const x = pad + (i / Math.max(vals.length - 1, 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');
  const first = vals[0];
  const last = vals[vals.length - 1];
  const improved =
    better === 'down' ? last < first : last > first;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        <rect width={w} height={h} fill="#0b0d14" rx="10" />
        <polyline fill="none" stroke={color} strokeWidth="2.5" points={pts} />
      </svg>
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem' }}>
        Start → now:{' '}
        <strong>
          {keyName.includes('acc') || keyName.includes('conf')
            ? `${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%`
            : `${first.toFixed(3)} → ${last.toFixed(3)}`}
        </strong>{' '}
        <span className={`ad-pill ${improved ? 'ok' : 'warn'}`}>
          {improved ? 'Getting better' : 'Not improving yet'}
        </span>
      </p>
    </div>
  );
}

/**
 * @param {{ history, liveProgress, lastCompleted, runs, evolutionAcrossRuns, dataset }} props
 */
export default function AdminLearningDashboard({
  history = [],
  liveProgress = {},
  lastCompleted = null,
  runs = [],
  evolutionAcrossRuns = [],
  dataset = {},
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const completed = lastCompleted || {};
  const evolution = completed.evolution || liveProgress.evolution || null;
  const diary = completed.diary || liveProgress.diary || [];
  const mistakes = completed.mistakes || liveProgress.mistakes || [];
  const isLive =
    liveProgress.status === 'training' || liveProgress.status === 'starting';

  const plainStory = useMemo(() => {
    if (isLive) {
      return `Studying journeys right now — step ${liveProgress.epoch || 0} of ${liveProgress.epochs || '?'}. ${
        liveProgress.train_acc != null
          ? `Currently correct about ${(liveProgress.train_acc * 100).toFixed(0)}% of the time.`
          : ''
      }`;
    }
    if (evolution) {
      const from = ((evolution.baseline_acc || 0) * 100).toFixed(0);
      const to = ((evolution.final_acc || 0) * 100).toFixed(0);
      const gain = ((evolution.acc_gain || 0) * 100).toFixed(0);
      const best = evolution.best_epoch
        ? ` Kept the best round (round ${evolution.best_epoch}) so late slips don’t ruin the model.`
        : '';
      return `Last study session: went from ${from}% → ${to}% correct (${Number(gain) >= 0 ? '+' : ''}${gain} points) on ${(completed.samples || dataset.trainableExamples || 'your')} journeys.${best}`;
    }
    if (history.length) {
      const a0 = history[0].train_acc ?? history[0].trainAcc;
      const a1 = history[history.length - 1].train_acc ?? history[history.length - 1].trainAcc;
      return `Last run had ${history.length} practice rounds. Accuracy ${(a0 != null ? (a0 * 100).toFixed(0) : '?')}% → ${(a1 != null ? (a1 * 100).toFixed(0) : '?')}%.`;
    }
    return 'The AI has not finished a study session yet. Run bots or wait for auto-train — then this story fills in.';
  }, [isLive, liveProgress, evolution, history, completed, dataset]);

  const whatItLearns = useMemo(() => {
    const labels = dataset.labelDistribution || completed.labelCounts || {};
    const entries = Object.entries(labels).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      return 'It learns to tell shopper types apart from their click paths (loyal buyer, cart abandoner, etc.).';
    }
    const top = entries
      .slice(0, 4)
      .map(([k, n]) => `${k.replace(/_/g, ' ')} (${n})`)
      .join(', ');
    return `It practices labeling journeys into types. Right now most data is: ${top}.`;
  }, [dataset, completed]);

  return (
    <div className="ad-card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Is the AI getting smarter?</h2>
      <p className="ad-muted" style={{ fontSize: '0.9rem', marginTop: 0 }}>
        Simple view of training. For <em>who will buy next</em>, use{' '}
        <strong>Future predictions</strong>. For <em>who pays today</em>, use{' '}
        <strong>Buyer behavior</strong>.
      </p>

      {/* Live banner */}
      {isLive && (
        <div
          className="ad-learning-live"
          style={{
            marginBottom: '1rem',
            padding: '0.85rem 1rem',
            borderRadius: 12,
            border: '1px solid rgba(124,108,240,0.4)',
            background: 'rgba(124,108,240,0.08)',
          }}
        >
          <div className="ad-score">
            <span className="name">
              <span className="ad-live-dot" />
              Studying… round {liveProgress.epoch || 0}/{liveProgress.epochs || '?'}
              {liveProgress.train_acc != null &&
                ` · ${((liveProgress.train_acc || 0) * 100).toFixed(0)}% correct`}
              {liveProgress.eta_sec != null && ` · ~${Math.round(liveProgress.eta_sec)}s left`}
            </span>
            <span className="num">{liveProgress.pct ?? 0}%</span>
            <div className="track">
              <div
                className="fill"
                style={{
                  width: `${liveProgress.pct || 0}%`,
                  background: 'linear-gradient(90deg,#7c6cf0,#3dd6c6)',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Three plain cards */}
      <div className="ad-grid-2" style={{ marginBottom: '0.75rem' }}>
        <div className="ad-insight rec">
          <strong>In plain English</strong>
          <div style={{ marginTop: 6 }}>{plainStory}</div>
        </div>
        <div className="ad-insight">
          <strong>What it’s learning</strong>
          <div style={{ marginTop: 6 }}>{whatItLearns}</div>
        </div>
      </div>

      {evolution && (
        <div className="ad-chip-list" style={{ marginBottom: '0.75rem' }}>
          <span className="ad-chip">
            Before: <strong>{((evolution.baseline_acc || 0) * 100).toFixed(0)}%</strong>
          </span>
          <span className="ad-chip">
            After: <strong>{((evolution.final_acc || 0) * 100).toFixed(0)}%</strong>
          </span>
          <span className={`ad-pill ${(evolution.acc_gain || 0) > 0 ? 'ok' : 'warn'}`}>
            {(evolution.acc_gain || 0) >= 0 ? '+' : ''}
            {((evolution.acc_gain || 0) * 100).toFixed(0)} pts
          </span>
          {evolution.classes_improved?.length > 0 && (
            <span className="ad-pill ok">
              Improved: {evolution.classes_improved.map((c) => c.label).slice(0, 3).join(', ')}
            </span>
          )}
          {evolution.classes_struggled?.length > 0 && (
            <span className="ad-pill warn">
              Still weak: {evolution.classes_struggled.map((c) => c.label).slice(0, 3).join(', ')}
            </span>
          )}
        </div>
      )}

      <div className="ad-grid-2">
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Mistakes over time (lower is better)</h3>
          <SimpleLine history={history} keyName="loss" color="#7c6cf0" better="down" />
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem' }}>Correct guesses (higher is better)</h3>
          <SimpleLine
            history={history.map((h) => ({
              ...h,
              train_acc: h.train_acc ?? h.trainAcc,
            }))}
            keyName="train_acc"
            color="#3dd6c6"
            better="up"
          />
        </div>
      </div>

      {/* Recent diary in human words */}
      {(diary.length > 0 || history.length > 0) && (
        <>
          <h3 style={{ marginTop: '1rem', fontSize: '0.95rem' }}>Latest study notes</h3>
          <ul className="ad-timeline" style={{ maxHeight: 200 }}>
            {(diary.length
              ? diary
              : history.map((h) => ({
                  epoch: h.epoch,
                  kind: 'epoch',
                  message: `Round ${h.epoch}: loss ${Number(h.loss).toFixed(3)}, accuracy ${
                    (h.train_acc ?? h.trainAcc) != null
                      ? `${(((h.train_acc ?? h.trainAcc) || 0) * 100).toFixed(0)}%`
                      : '—'
                  }`,
                }))
            )
              .slice(-6)
              .reverse()
              .map((d, i) => (
                <li key={i}>
                  <div className="time">
                    {d.kind === 'baseline' ? 'start' : d.kind === 'summary' ? 'done' : `r${d.epoch}`}
                  </div>
                  <div style={{ fontSize: '0.88rem' }}>{d.message}</div>
                </li>
              ))}
          </ul>
        </>
      )}

      {mistakes.length > 0 && (
        <>
          <h3 style={{ marginTop: '0.75rem', fontSize: '0.95rem' }}>
            Where it still gets people wrong
          </h3>
          <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
            True type vs what the model guessed — useful to know what to train more of.
          </p>
          <div className="ad-chip-list">
            {mistakes.slice(0, 8).map((m, i) => (
              <span key={i} className="ad-chip">
                {m.true} → said {m.pred} ({((m.confidence || 0) * 100).toFixed(0)}%)
              </span>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        className="ad-btn"
        style={{ marginTop: '1rem' }}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? 'Hide technical details' : 'Show technical details'}
      </button>

      {showAdvanced && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3>Recent training runs</h3>
          <table className="ad-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Journeys</th>
                <th>Accuracy</th>
                <th>Loss</th>
              </tr>
            </thead>
            <tbody>
              {(runs || []).slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td className="ad-muted" style={{ fontSize: '0.8rem' }}>
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
                  <td>
                    {r.trainAcc != null ? `${(r.trainAcc * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td>
                    {r.finalLoss != null ? Number(r.finalLoss).toFixed(3) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {evolutionAcrossRuns?.length > 1 && (
            <p className="ad-muted" style={{ fontSize: '0.85rem' }}>
              Across {evolutionAcrossRuns.length} completed runs, accuracy went from{' '}
              {evolutionAcrossRuns[0].trainAcc != null
                ? `${(evolutionAcrossRuns[0].trainAcc * 100).toFixed(0)}%`
                : '?'}{' '}
              to{' '}
              {evolutionAcrossRuns[evolutionAcrossRuns.length - 1].trainAcc != null
                ? `${(evolutionAcrossRuns[evolutionAcrossRuns.length - 1].trainAcc * 100).toFixed(0)}%`
                : '?'}
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
