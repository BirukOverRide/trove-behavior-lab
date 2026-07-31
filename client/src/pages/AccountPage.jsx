import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { api } from '../api';

export default function AccountPage() {
  const { user, isAuthed, logout } = useAuth();
  const navigate = useNavigate();
  const [ai, setAi] = useState(null);

  useEffect(() => {
    if (!isAuthed) navigate('/login?next=/account');
  }, [isAuthed, navigate]);

  useEffect(() => {
    if (!isAuthed) return;
    api.aiMe().then(setAi).catch(() => {});
  }, [isAuthed, user?.id]);

  if (!user) return null;

  const f = ai?.features;

  return (
    <div>
      <h1 className="display" style={{ marginTop: 0 }}>
        Account
      </h1>
      <p>
        Signed in as <strong>{user.name}</strong>
        <br />
        <span className="tv-muted">{user.email}</span>
      </p>

      {f && (
        <div
          className="tv-panel"
          style={{ marginBottom: '1.25rem', textAlign: 'left' }}
        >
          <h2 style={{ marginTop: 0 }}>Your AI shopping profile</h2>
          <p className="tv-muted">
            Stage <strong>{f.buyer_stage}</strong>
            {f.tf_label && (
              <>
                {' '}
                · model <strong>{f.tf_label}</strong> (
                {((f.tf_confidence || 0) * 100).toFixed(0)}%)
              </>
            )}
          </p>
          <div className="tv-dept-grid" style={{ marginTop: '0.75rem' }}>
            <div className="tv-dept">
              <strong>Intent {f.intent_score}</strong>
              <span>Purchase likelihood</span>
            </div>
            <div className="tv-dept">
              <strong>Risk {f.abandon_prob}</strong>
              <span>Cart abandon signal</span>
            </div>
            <div className="tv-dept">
              <strong>Priority {f.priority_score}</strong>
              <span>Engagement rank</span>
            </div>
            <div className="tv-dept">
              <strong>{f.total_spent?.formatted || '$0'}</strong>
              <span>Lifetime spend</span>
            </div>
          </div>
          {(ai.recommendations || []).slice(0, 2).map((r) => (
            <p key={r} className="tv-muted" style={{ fontSize: '0.9rem' }}>
              → {r}
            </p>
          ))}
        </div>
      )}

      <div className="tv-account-grid">
        <Link to="/orders" className="tv-account-tile">
          <h2>Orders</h2>
          <p>History stored in SQLite</p>
        </Link>
        <Link to="/cart" className="tv-account-tile">
          <h2>Cart</h2>
          <p>Items ready for checkout</p>
        </Link>
        <Link to="/s" className="tv-account-tile">
          <h2>Catalog</h2>
          <p>Keep browsing the marketplace</p>
        </Link>
      </div>
      <button type="button" className="tv-btn ghost" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

