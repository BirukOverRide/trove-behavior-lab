import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../AuthContext';

function LogoMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden>
      <path
        d="M18 38c0-10 6-18 14-18s14 8 14 18"
        stroke="#f0a06a"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="40" r="6" fill="#7c6cf0" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    name: '',
    email: 'demo@trove.shop',
    password: 'password123',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
      } else {
        if (!form.name.trim()) {
          throw new Error('Name is required');
        }
        await register(form.name.trim(), form.email.trim(), form.password);
      }
      navigate(next);
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setMode('login');
    setForm({
      name: '',
      email: 'demo@trove.shop',
      password: 'password123',
    });
  };

  return (
    <div className="tv-auth-page">
      <div className="tv-auth-card">
        <Link to="/" className="tv-logo">
          <span className="tv-logo-mark">
            <LogoMark />
          </span>
          <span className="tv-logo-word">
            Tro<span>ve</span>
          </span>
        </Link>

        <h1>{mode === 'login' ? 'Welcome back' : 'Join Trove'}</h1>
        <p className="lead">
          {mode === 'login'
            ? 'Sign in to checkout, track orders, and sync your cart.'
            : 'Create an account — carts merge when you sign in.'}
        </p>

        <form onSubmit={onSubmit}>
          {mode === 'register' && (
            <label>
              Full name
              <input
                name="name"
                value={form.name}
                onChange={onChange}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={onChange}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={onChange}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </label>

          {error && <div className="tv-alert error">{error}</div>}

          <button type="submit" className="tv-btn primary block" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <div className="tv-auth-switch">
          {mode === 'login' ? (
            <button type="button" onClick={() => setMode('register')}>
              New here? Create an account
            </button>
          ) : (
            <button type="button" onClick={() => setMode('login')}>
              Already have an account? Sign in
            </button>
          )}
        </div>

        <div className="tv-demo-hint">
          Demo account:{' '}
          <button
            type="button"
            onClick={fillDemo}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              textDecoration: 'underline',
              font: 'inherit',
              padding: 0,
            }}
          >
            use demo@trove.shop
          </button>
          <br />
          <code>demo@trove.shop</code> / <code>password123</code>
        </div>
      </div>
    </div>
  );
}
