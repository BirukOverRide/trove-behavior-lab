import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdminLiveStream } from '../hooks/useAdminLiveStream';

/**
 * Big Play control — runs every bot in the background (login → search → buy path).
 * Progress streams over SSE + fleet-run polling.
 */
export default function PlayAllBotsButton({
  botCount = 0,
  defaultSessions = 1,
  onFinished,
  size = 'lg',
}) {
  const [sessions, setSessions] = useState(defaultSessions);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const live = useAdminLiveStream({ enabled: true, maxEvents: 20 });

  const running = status?.running || live.botRuns.some((b) => b.status === 'running');

  const refreshStatus = () => {
    api
      .adminFleetRunStatus()
      .then((d) => setStatus(d.fleetRun))
      .catch(() => {});
  };

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 2000);
    return () => clearInterval(t);
  }, []);

  // When SSE reports fleet activity, refresh
  useEffect(() => {
    if (live.botRuns[0]) refreshStatus();
  }, [live.botRuns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status && !status.running && status.finishedAt && onFinished) {
      onFinished(status);
    }
  }, [status?.finishedAt, status?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stopping, setStopping] = useState(false);

  const play = async () => {
    setStarting(true);
    setError('');
    try {
      const d = await api.adminRunAllBots(Number(sessions) || 1);
      setStatus(d.fleetRun || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setStopping(true);
    setError('');
    try {
      const d = await api.adminStopAllBots();
      setStatus(d.fleetRun || null);
      if (onFinished) onFinished(d.fleetRun);
    } catch (e) {
      setError(e.message);
    } finally {
      setStopping(false);
      refreshStatus();
    }
  };

  const pct =
    status?.total > 0
      ? Math.round((100 * (status.completed || 0)) / status.total)
      : 0;

  const big = size === 'lg';
  const stoppingFleet = running && (status?.stopRequested || stopping);

  return (
    <div
      className="ad-card"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '1rem',
        marginBottom: '1rem',
        background: running
          ? 'linear-gradient(135deg, rgba(124,108,240,0.2), rgba(61,214,198,0.12))'
          : undefined,
      }}
    >
      <button
        type="button"
        onClick={play}
        disabled={starting || running || botCount === 0}
        title={botCount === 0 ? 'Create bots first' : 'Run every bot now'}
        style={{
          width: big ? 72 : 52,
          height: big ? 72 : 52,
          borderRadius: '50%',
          border: 'none',
          cursor: starting || running || botCount === 0 ? 'not-allowed' : 'pointer',
          background: running
            ? 'linear-gradient(145deg, #3dd6c6, #2a9d8f)'
            : 'linear-gradient(145deg, #7c6cf0, #5a4fd6)',
          color: '#fff',
          fontSize: big ? '1.75rem' : '1.35rem',
          display: 'grid',
          placeItems: 'center',
          boxShadow: '0 8px 24px rgba(124,108,240,0.35)',
          flexShrink: 0,
          opacity: botCount === 0 ? 0.5 : 1,
        }}
      >
        {running ? '⏸' : '▶'}
      </button>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: big ? '1.15rem' : '1rem' }}>
          {stoppingFleet
            ? `Stopping fleet… ${status?.completed || 0}/${status?.total || botCount}`
            : running
              ? `Playing fleet… ${status?.completed || 0}/${status?.total || botCount}`
              : `Play all bots${botCount ? ` (${botCount})` : ''}`}
        </div>
        <div className="ad-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
          {running ? (
            <>
              Now: <strong>{status?.currentBotName || '…'}</strong>
              {status?.sessions > 1 && ` · ${status.sessions} sessions each`}
              {stoppingFleet && ' · finishing current bot then halt'}
            </>
          ) : (
            <>
              Each bot will login → search → view → cart/checkout path. AI scores update live.
            </>
          )}
        </div>
        {running && (
          <div className="ad-score" style={{ marginTop: 8 }}>
            <span className="name">{pct}%</span>
            <span className="num">
              {status?.completed || 0}/{status?.total || 0}
            </span>
            <div className="track">
              <div
                className="fill"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg,#7c6cf0,#3dd6c6)',
                }}
              />
            </div>
          </div>
        )}
        {!running && status?.finishedAt && (
          <div className="ad-muted" style={{ fontSize: '0.8rem', marginTop: 6 }}>
            Last run {status.stopped ? 'stopped' : 'finished'}{' '}
            {new Date(status.finishedAt).toLocaleTimeString()}
            {status.results?.length
              ? ` · ${status.results.filter((r) => r.purchased).length} bought something`
              : ''}
          </div>
        )}
        {error && <div className="ad-alert" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {running && (
        <button
          type="button"
          className="ad-btn"
          onClick={stop}
          disabled={stopping || status?.stopRequested}
          title="Stop all bots after the current one finishes"
          style={{
            background: 'rgba(255,107,122,0.15)',
            borderColor: 'var(--ad-danger, #ff6b7a)',
            color: 'var(--ad-danger, #ff6b7a)',
            fontWeight: 700,
            minWidth: 100,
          }}
        >
          {stopping || status?.stopRequested ? 'Stopping…' : '■ Stop all'}
        </button>
      )}

      <label className="ad-muted" style={{ fontSize: '0.85rem' }}>
        Sessions each
        <input
          type="number"
          min={1}
          max={5}
          value={sessions}
          disabled={running || starting}
          onChange={(e) => setSessions(e.target.value)}
          style={{ display: 'block', width: 72, marginTop: 4 }}
        />
      </label>
    </div>
  );
}
