/**
 * Trove Intel chat — high-skill conversation grounded in behavior AI.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

const STARTERS = [
  'What do you know about our shoppers right now?',
  'Where are we leaking buyers, and what should we do first?',
  'Who is most likely to buy soon?',
  'Explain the difference between buyer stages and Tiny Transformer personas.',
  'How well is the model learning, honestly?',
];

function bubbleStyle(role) {
  if (role === 'user') {
    return {
      alignSelf: 'flex-end',
      background: 'linear-gradient(135deg, rgba(124,108,240,0.35), rgba(61,214,198,0.2))',
      border: '1px solid rgba(124,108,240,0.45)',
      borderRadius: '16px 16px 4px 16px',
    };
  }
  return {
    alignSelf: 'flex-start',
    background: 'rgba(15,18,28,0.9)',
    border: '1px solid rgba(139,146,168,0.25)',
    borderRadius: '16px 16px 16px 4px',
  };
}

function renderText(text) {
  // light markdown-ish: **bold**, bullets, newlines
  const lines = String(text || '').split('\n');
  return lines.map((line, i) => {
    const parts = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    let key = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<strong key={`b${i}-${key++}`}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    if (!parts.length) parts.push(line || '\u00a0');
    return (
      <div
        key={i}
        style={{ marginBottom: line.startsWith('- ') || line.startsWith('* ') ? 4 : 6 }}
      >
        {parts}
      </div>
    );
  });
}

export default function AdminChatPage() {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "Hi — I'm **Trove Intel**. I combine your Tiny Transformer (persona labels), buyer funnels, and forecasts into clear advice.\n\nAsk me about leaks, who will buy, what the model knows, or what to do next.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyMsg, setKeyMsg] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [provider, setProvider] = useState('local');
  const bottomRef = useRef(null);
  const sessionId = 'admin-chat';

  useEffect(() => {
    api
      .adminChatStatus()
      .then((s) => {
        setStatus(s);
        if (s?.provider) setProvider(s.provider);
        else if (s?.providers?.gemini?.configured) setProvider('gemini');
        else if (s?.providers?.xai?.configured) setProvider('xai');
        else setProvider('local');
      })
      .catch(() => {});
  }, []);

  const saveKey = async () => {
    setKeyBusy(true);
    setKeyMsg('');
    setError('');
    try {
      const r = await api.adminChatSaveKey(keyInput.trim(), provider || 'auto');
      setKeyMsg(r.message || 'Key saved.');
      setKeyInput('');
      setStatus(r.status || (await api.adminChatStatus()));
      if (r.provider) setProvider(r.provider);
    } catch (e) {
      setKeyMsg('');
      setError(e.message);
    } finally {
      setKeyBusy(false);
    }
  };

  const useLocal = async () => {
    setKeyBusy(true);
    setKeyMsg('');
    setError('');
    try {
      const r = await api.adminChatUseLocal();
      setKeyMsg(r.message || 'Using local advisor.');
      setStatus(r.status || (await api.adminChatStatus()));
      setProvider('local');
    } catch (e) {
      setError(e.message);
    } finally {
      setKeyBusy(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput('');
    setError('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setBusy(true);
    try {
      const res = await api.adminChat({
        message: msg,
        sessionId,
        provider: provider === 'local' ? 'local' : status?.hasLlm ? provider : undefined,
      });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          meta: { provider: res.provider, model: res.model },
        },
      ]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `I hit a snag reaching the chat backend: ${e.message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api.adminChatClear({ sessionId });
    } catch {
      /* ignore */
    }
    setMessages([
      {
        role: 'assistant',
        content: 'Conversation cleared. What would you like to explore?',
      },
    ]);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 48px)',
        maxHeight: 900,
      }}
    >
      <div className="ad-topbar" style={{ flexShrink: 0 }}>
        <div>
          <h1>Trove Chat</h1>
          <p>
            High-skill advisor grounded in your transformer + buyer analytics.
            {status?.hasLlm ? (
              <>
                {' '}
                <span className="ad-pill ok">
                  {status.provider === 'gemini' ? 'Gemini' : 'Grok'} live · {status.model}
                </span>
              </>
            ) : (
              <>
                {' '}
                <span className="ad-pill warn">Local advisor</span>
                <span className="ad-muted"> — free offline analytics replies</span>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/knowledge" className="ad-btn">
            What AI knows
          </Link>
          <Link to="/admin/buyers" className="ad-btn">
            Buyer behavior
          </Link>
          <button type="button" className="ad-btn" onClick={clear}>
            New chat
          </button>
        </div>
      </div>

      <div className="ad-insight rec" style={{ flexShrink: 0, marginBottom: '0.75rem' }}>
        <strong>
          {status?.hasLlm
            ? `Connected: ${status.provider === 'gemini' ? 'Gemini' : 'Grok/xAI'}`
            : 'Local advisor (default)'}
        </strong>
        <p className="ad-muted" style={{ fontSize: '0.88rem', margin: '0.4rem 0 0.75rem' }}>
          <strong>Local advisor</strong> is free and light — grounded in your funnels and forecasts.
          Optional cloud keys (Gemini / Grok) add fluent chat if you have one.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{
              background: 'var(--ad-bg, #0b0d14)',
              border: '1px solid var(--ad-line, #2a2f3d)',
              borderRadius: 10,
              color: 'inherit',
              padding: '0.65rem 0.75rem',
            }}
          >
            <option value="local">Local advisor (free)</option>
            <option value="gemini">Google Gemini (cloud)</option>
            <option value="xai">xAI Grok (cloud)</option>
            <option value="auto">Auto</option>
          </select>
          {provider === 'local' ? (
            <button
              type="button"
              className="ad-btn primary"
              disabled={keyBusy}
              onClick={useLocal}
            >
              {keyBusy ? 'Saving…' : 'Use local advisor'}
            </button>
          ) : (
            <>
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  provider === 'xai'
                    ? 'xai-… paste Grok API key'
                    : 'AIza… paste Gemini API key'
                }
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                style={{
                  flex: '1 1 280px',
                  minWidth: 200,
                  background: 'var(--ad-bg, #0b0d14)',
                  border: '1px solid var(--ad-line, #2a2f3d)',
                  borderRadius: 10,
                  color: 'inherit',
                  padding: '0.65rem 0.85rem',
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '0.9rem',
                }}
              />
              <button
                type="button"
                className="ad-btn primary"
                disabled={keyBusy || !keyInput.trim()}
                onClick={saveKey}
              >
                {keyBusy ? 'Checking…' : 'Save & connect'}
              </button>
            </>
          )}
        </div>
        {keyMsg && (
          <p style={{ color: '#3ecf8e', margin: '0.65rem 0 0', fontSize: '0.9rem' }}>{keyMsg}</p>
        )}
        <p className="ad-muted" style={{ fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
          Status: {status?.keyHint || 'unknown'}
          {status?.providers && (
            <>
              {' · '}
              Local ✓ · Gemini {status.providers.gemini?.configured ? '✓' : '—'} · Grok{' '}
              {status.providers.xai?.configured ? '✓' : '—'}
            </>
          )}
        </p>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div
        className="ad-card"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          padding: '0.75rem',
        }}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '0.5rem 0.35rem',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                maxWidth: 'min(720px, 92%)',
                padding: '0.75rem 1rem',
                ...bubbleStyle(m.role),
              }}
            >
              <div
                className="ad-muted"
                style={{
                  fontSize: '0.7rem',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {m.role === 'user' ? 'You' : 'Trove Intel'}
                {m.meta?.model && (
                  <span style={{ marginLeft: 8, opacity: 0.8 }}>{m.meta.model}</span>
                )}
              </div>
              <div style={{ fontSize: '0.95rem', lineHeight: 1.5, color: '#e8ebf4' }}>
                {renderText(m.content)}
              </div>
            </div>
          ))}
          {busy && (
            <div className="ad-muted" style={{ paddingLeft: 8 }}>
              Thinking with your live analytics…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="ad-chip-list" style={{ flexShrink: 0, margin: '0.5rem 0' }}>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="ad-chip"
              style={{ cursor: 'pointer', border: '1px solid var(--ad-line, #2a2f3d)' }}
              disabled={busy}
              onClick={() => send(s)}
            >
              {s.length > 48 ? `${s.slice(0, 48)}…` : s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end',
            borderTop: '1px solid rgba(139,146,168,0.2)',
            paddingTop: '0.75rem',
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about buyers, leaks, what the model knows, predictions…"
            rows={2}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--ad-bg, #0b0d14)',
              border: '1px solid var(--ad-line, #2a2f3d)',
              borderRadius: 12,
              color: 'inherit',
              padding: '0.75rem 0.9rem',
              fontFamily: 'inherit',
              fontSize: '0.95rem',
            }}
          />
          <button type="submit" className="ad-btn primary" disabled={busy || !input.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
