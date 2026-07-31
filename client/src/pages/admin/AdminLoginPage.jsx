import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import '../../admin.css';

export default function AdminLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('admin@trove.shop');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState(
    params.get('error') === 'forbidden'
      ? 'That account is not an admin.'
      : ''
  );
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(email.trim(), password);
      if (!user.isAdmin) {
        setError('This account does not have admin access.');
        return;
      }
      navigate('/admin');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad ad-login">
      <form className="ad-login-card" onSubmit={onSubmit}>
        <div className="ad-mark" style={{ marginBottom: '1rem' }}>
          TI
        </div>
        <h1>Trove Intelligence</h1>
        <p className="lead">
          Admin console for live consumer behavior models built from every
          shopper action.
        </p>
        {error && <div className="ad-alert">{error}</div>}
        <label>
          Admin email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="ad-btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Enter console'}
        </button>
        <p className="ad-muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
          Default: <code>admin@trove.shop</code> / <code>admin123</code>
        </p>
        <Link to="/" className="ad-muted" style={{ fontSize: '0.85rem' }}>
          ← Return to Trove shop
        </Link>
      </form>
    </div>
  );
}
