import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';

export default function AdminProfilesPage() {
  const [q, setQ] = useState('');
  const [persona, setPersona] = useState('');
  const [data, setData] = useState({ profiles: [], total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .adminProfiles({ q, persona, limit: 50 })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, persona]);

  return (
    <div>
      <div className="ad-topbar">
        <div>
          <h1>Consumer profiles</h1>
          <p>Each profile is rebuilt from that shopper&apos;s full activity history.</p>
        </div>
      </div>

      <div className="ad-filters">
        <input
          placeholder="Search name, email, key…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="">All personas</option>
          <option value="loyal_buyer">Loyal Buyer</option>
          <option value="high_intent">High Intent Buyer</option>
          <option value="cart_abandons">Cart Abandoner</option>
          <option value="cart_builder">Cart Builder</option>
          <option value="bargain_hunter">Bargain Hunter</option>
          <option value="product_browser">Product Researcher</option>
          <option value="window_shopper">Window Shopper</option>
          <option value="impulse_buyer">Impulse Buyer</option>
          <option value="category_loyal">Category Loyalist</option>
          <option value="explorer">Category Explorer</option>
        </select>
      </div>

      {error && <div className="ad-alert">{error}</div>}

      <div className="ad-card">
        <h2>
          {loading ? 'Loading…' : `${data.total} profile${data.total === 1 ? '' : 's'}`}
        </h2>
        <table className="ad-table">
          <thead>
            <tr>
              <th>Shopper</th>
              <th>Persona</th>
              <th>Events</th>
              <th>Intent</th>
              <th>Abandon risk</th>
              <th>Spent</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {data.profiles.map((p) => (
              <tr key={p.profileKey}>
                <td>
                  <Link to={`/admin/profiles/${encodeURIComponent(p.profileKey)}`}>
                    <strong>{p.displayName}</strong>
                  </Link>
                  <div className="ad-mono ad-muted">{p.profileKey}</div>
                </td>
                <td>
                  <span className="ad-pill">{p.personaLabel}</span>
                  <div className="ad-muted" style={{ fontSize: '0.75rem' }}>
                    conf {(p.confidence * 100).toFixed(0)}%
                  </div>
                </td>
                <td>{p.eventCount}</td>
                <td>{p.scores.purchaseIntent}</td>
                <td>
                  <span
                    className={
                      p.scores.abandonRisk >= 60
                        ? 'ad-pill danger'
                        : p.scores.abandonRisk >= 40
                          ? 'ad-pill warn'
                          : 'ad-pill ok'
                    }
                  >
                    {p.scores.abandonRisk}
                  </span>
                </td>
                <td>{p.totalSpent.formatted}</td>
                <td className="ad-muted" style={{ fontSize: '0.82rem' }}>
                  {p.lastActive || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && data.profiles.length === 0 && (
          <p className="ad-muted">
            No profiles yet. Use the storefront (signed in or guest), then hit Rebuild
            on Overview.
          </p>
        )}
      </div>
    </div>
  );
}
