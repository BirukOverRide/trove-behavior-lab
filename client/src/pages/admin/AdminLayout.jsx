import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import '../../admin.css';

export default function AdminLayout() {
  const { user, isAdmin, loading, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/admin/login');
      return;
    }
    if (!isAdmin) {
      navigate('/admin/login?error=forbidden');
    }
  }, [user, isAdmin, loading, navigate]);

  if (loading || !isAdmin) {
    return (
      <div className="ad ad-login">
        <p className="ad-muted">Checking admin access…</p>
      </div>
    );
  }

  return (
    <div className="ad">
      <div className="ad-shell">
        <aside className="ad-side">
          <Link to="/admin" className="ad-brand">
            <div className="ad-mark">TI</div>
            <div>
              <strong>Trove Intel</strong>
              <span>Consumer behavior AI</span>
            </div>
          </Link>
          <nav className="ad-nav">
            <NavLink to="/admin" end>
              Overview
            </NavLink>
            <NavLink to="/admin/bots/active">Active bots</NavLink>
            <NavLink to="/admin/bots">Manage bots</NavLink>
            <NavLink to="/admin/buyers">Buyer behavior</NavLink>
            <NavLink to="/admin/knowledge">What AI knows</NavLink>
            <NavLink to="/admin/chat">Trove Chat</NavLink>
            <NavLink to="/admin/predictions">Predictions</NavLink>
            <NavLink to="/admin/analysis">Realtime</NavLink>
            <NavLink to="/admin/personas">Personas</NavLink>
            <NavLink to="/admin/ai">AI training</NavLink>
            <NavLink to="/admin/insights">Feature mine</NavLink>
            <NavLink to="/admin/profiles">Profiles</NavLink>
            <NavLink to="/admin/live">Live feed</NavLink>
          </nav>
          <div className="ad-side-foot">
            <div>{user.name}</div>
            <div className="ad-mono">{user.email}</div>
            <Link to="/">← Back to shop</Link>
            <button
              type="button"
              className="ad-btn ghost"
              style={{ marginTop: '0.5rem', width: '100%' }}
              onClick={() => {
                logout();
                navigate('/admin/login');
              }}
            >
              Sign out
            </button>
          </div>
        </aside>
        <div className="ad-main">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
