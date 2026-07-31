import { useEffect, useRef, useState } from 'react';

/**
 * Subscribe to admin SSE stream for real-time AI + shop events.
 * Uses token query param (EventSource cannot set Authorization headers).
 */
export function useAdminLiveStream({ enabled = true, maxEvents = 80 } = {}) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [aiUpdates, setAiUpdates] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [dataset, setDataset] = useState(null);
  const [botRuns, setBotRuns] = useState([]);
  const [trainProgress, setTrainProgress] = useState(null);
  const [autoTrain, setAutoTrain] = useState(null);
  const [fleetRun, setFleetRun] = useState(null);
  const [marketPulse, setMarketPulse] = useState(null);
  const [lastTs, setLastTs] = useState(null);
  const [error, setError] = useState('');
  const esRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const token = localStorage.getItem('shop_token');
    if (!token) {
      setError('Not signed in');
      return undefined;
    }

    const url = `/api/admin/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    const pushCap = (setter, item, cap) => {
      setter((prev) => {
        const next = [item, ...prev.filter((x) => {
          if (item.profileKey && x.profileKey) return x.profileKey !== item.profileKey;
          if (item.id != null && x.id != null) return x.id !== item.id;
          if (item.botId && x.botId) return !(x.botId === item.botId && x.status === item.status);
          return true;
        })];
        return next.slice(0, cap);
      });
    };

    es.onopen = () => {
      setConnected(true);
      setError('');
    };

    es.onerror = () => {
      setConnected(false);
      setError('Live stream disconnected — reconnecting…');
    };

    const onEnvelope = (raw) => {
      try {
        const envelope = JSON.parse(raw.data);
        setLastTs(envelope.ts || new Date().toISOString());
        const { type, data } = envelope;

        if (type === 'hello' && data) {
          if (data.dataset) setDataset(data.dataset);
          if (data.recentAi) setAiUpdates(data.recentAi);
          return;
        }
        if (type === 'event') {
          pushCap(setEvents, data, maxEvents);
          return;
        }
        if (type === 'ai') {
          pushCap(setAiUpdates, data, 40);
          return;
        }
        if (type === 'profile') {
          pushCap(setProfiles, data, 40);
          return;
        }
        if (type === 'dataset') {
          setDataset(data);
          return;
        }
        if (type === 'bot_run') {
          pushCap(setBotRuns, data, 30);
          return;
        }
        if (type === 'train') {
          setTrainProgress(data);
          return;
        }
        if (type === 'auto_train') {
          setAutoTrain(data);
          return;
        }
        if (type === 'fleet_run') {
          setFleetRun(data);
          return;
        }
        if (type === 'market_pulse') {
          setMarketPulse(data);
        }
      } catch {
        /* ignore parse */
      }
    };

    // Named events + default message
    [
      'hello',
      'event',
      'ai',
      'profile',
      'dataset',
      'bot_run',
      'fleet_run',
      'market_pulse',
      'train',
      'auto_train',
      'message',
    ].forEach((name) => {
      es.addEventListener(name, onEnvelope);
    });

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [enabled, maxEvents]);

  return {
    connected,
    events,
    aiUpdates,
    profiles,
    dataset,
    botRuns,
    trainProgress,
    autoTrain,
    fleetRun,
    marketPulse,
    lastTs,
    error,
  };
}
