import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';

function Score({ name, value, invert }) {
  const hot = invert ? value >= 60 : value >= 70;
  const mid = invert ? value >= 40 : value >= 40;
  const color = hot ? '#ff6b7a' : mid ? '#f0a06a' : '#3ecf8e';
  // for non-invert, high is good = teal/purple
  const fill = invert
    ? color
    : value >= 70
      ? '#3dd6c6'
      : value >= 40
        ? '#7c6cf0'
        : '#8b92a8';
  return (
    <div className="ad-score">
      <span className="name">{name}</span>
      <span className="num">{value}</span>
      <div className="track">
        <div className="fill" style={{ width: `${value}%`, background: fill }} />
      </div>
    </div>
  );
}

export default function AdminProfileDetailPage() {
  const { key } = useParams();
  const profileKey = decodeURIComponent(key);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .adminProfile(profileKey)
      .then((d) => setProfile(d.profile))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [profileKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const reanalyze = async () => {
    setBusy(true);
    try {
      const d = await api.adminAnalyze(profileKey);
      setProfile(d.profile);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !profile) return <div className="ad-alert">{error}</div>;
  if (!profile) return <p className="ad-muted">Loading profile…</p>;

  const scores = profile.scores || {};

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <p className="ad-muted" style={{ margin: 0 }}>
            <Link to="/admin/profiles">Profiles</Link> / detail
          </p>
          <h1>{profile.displayName || profile.profileKey}</h1>
          <p>
            <span className="ad-pill teal">{profile.personaLabel || profile.persona}</span>{' '}
            · confidence {((profile.confidence || 0) * 100).toFixed(0)}% ·{' '}
            <span className="ad-mono">{profile.profileKey}</span>
          </p>
        </div>
        <button type="button" className="ad-btn primary" onClick={reanalyze} disabled={busy}>
          {busy ? 'Analyzing…' : 'Re-run AI analysis'}
        </button>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div className="ad-grid-3" style={{ marginBottom: '1rem' }}>
        <div className="ad-card">
          <h2>Behavior scores</h2>
          <div className="ad-score-grid">
            <Score name="Engagement" value={scores.engagement || 0} />
            <Score name="Purchase intent" value={scores.purchaseIntent || 0} />
            <Score name="Price sensitivity" value={scores.priceSensitivity || 0} />
            <Score name="Loyalty" value={scores.loyalty || 0} />
            <Score name="Abandon risk" value={scores.abandonRisk || 0} invert />
          </div>
          <p className="ad-muted" style={{ marginTop: '0.85rem', fontSize: '0.85rem' }}>
            {profile.personaBlurb}
          </p>
        </div>

        <div className="ad-card">
          <h2>AI insights</h2>
          {(profile.insights || []).map((t) => (
            <div key={t} className="ad-insight">
              {t}
            </div>
          ))}
          <h3 style={{ marginTop: '1rem' }}>Recommendations</h3>
          {(profile.recommendations || []).map((t) => (
            <div key={t} className="ad-insight rec">
              {t}
            </div>
          ))}
        </div>

        <div className="ad-card">
          <h2>Commerce snapshot</h2>
          <p>
            Events: <strong>{profile.eventCount ?? profile.counts?.totalEvents}</strong>
            <br />
            Purchases: <strong>{profile.purchaseCount}</strong>
            <br />
            Spent:{' '}
            <strong>
              {profile.totalSpent?.formatted ||
                `$${((profile.totalSpentCents || 0) / 100).toFixed(2)}`}
            </strong>
            <br />
            Last active: <strong>{profile.lastActive || '—'}</strong>
          </p>
          {profile.counts && (
            <div className="ad-chip-list" style={{ marginTop: '0.75rem' }}>
              <span className="ad-chip">views {profile.counts.productViews}</span>
              <span className="ad-chip">carts {profile.counts.addToCarts}</span>
              <span className="ad-chip">checkouts {profile.counts.checkouts}</span>
              <span className="ad-chip">searches {profile.counts.searches}</span>
            </div>
          )}
        </div>
      </div>

      <div className="ad-grid-2">
        <div className="ad-card">
          <h2>Category affinity</h2>
          {(profile.categoryAffinity || []).length === 0 && (
            <p className="ad-muted">No category signal yet.</p>
          )}
          {(profile.categoryAffinity || []).map((c) => (
            <div key={c.name} className="ad-bar-row">
              <span>{c.name}</span>
              <div className="ad-bar-track">
                <div
                  className="ad-bar-fill"
                  style={{
                    width: `${Math.min(100, c.count * 15)}%`,
                  }}
                />
              </div>
              <span>{c.count}</span>
            </div>
          ))}
          <h3 style={{ marginTop: '1rem' }}>Brands</h3>
          <div className="ad-chip-list">
            {(profile.brandAffinity || []).map((b) => (
              <span key={b.name} className="ad-chip">
                {b.name} · {b.count}
              </span>
            ))}
          </div>
        </div>

        <div className="ad-card">
          <h2>Top products in journey</h2>
          <table className="ad-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Hits</th>
              </tr>
            </thead>
            <tbody>
              {(profile.topProducts || []).map((p) => (
                <tr key={p.productId}>
                  <td>
                    {p.title}
                    <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                      {p.brand}
                    </div>
                  </td>
                  <td>{p.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>Journey path (token sequence)</h2>
        <div className="ad-journey">{profile.journeyPath || '—'}</div>
      </div>

      <div className="ad-card" style={{ marginTop: '1rem' }}>
        <h2>Activity timeline</h2>
        <ul className="ad-timeline">
          {(profile.eventTimeline || []).slice().reverse().map((e) => (
            <li key={e.id}>
              <div className="time">{e.createdAt}</div>
              <div>
                <span className="type">{e.type}</span>
                <div className="meta">
                  {e.target || e.path || '—'}
                  {e.productId ? ` · ${e.productId}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
