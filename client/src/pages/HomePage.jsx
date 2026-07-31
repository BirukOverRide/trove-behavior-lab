import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import { useAuth } from '../AuthContext';

export default function HomePage() {
  const { user } = useAuth();
  const [deals, setDeals] = useState([]);
  const [bestsellers, setBestsellers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [personal, setPersonal] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.deals(),
      api.bestsellers(),
      api.categories(),
      api.aiPersonalize().catch(() => null),
    ])
      .then(([d, b, c, p]) => {
        setDeals(d.products || []);
        setBestsellers(b.products || []);
        setCategories(c.categories || []);
        setPersonal(p);
      })
      .catch((e) => setError(e.message));
  }, [user?.id]);

  const forYou = personal?.forYou || [];
  const dealsForYou = personal?.dealsForYou || [];
  const stage = personal?.stage;
  const urgency = personal?.urgency;

  return (
    <div>
      <section className="tv-hero">
        <div className="tv-hero-copy">
          <div className="tv-kicker">
            {personal?.persona
              ? `AI · ${personal.persona}${stage ? ` · ${stage}` : ''}`
              : 'New season · Live catalog'}
          </div>
          <h1>
            {personal?.headline || 'Find your next everyday essential'}
          </h1>
          <p>
            {urgency === 'soft'
              ? 'Your activity suggests strong interest — we’ve prioritized paths that match how you shop.'
              : 'Trove personalizes from real browsing signals. Sign in or keep exploring; the AI updates live.'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/s?sort=bestseller" className="tv-btn accent">
              Explore top picks
            </Link>
            {forYou[0] && (
              <Link to={`/product/${forYou[0].id}`} className="tv-btn ghost">
                Jump to a pick for you
              </Link>
            )}
          </div>
          {personal?.insights?.length > 0 && (
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', opacity: 0.85 }}>
              {personal.insights[0]}
            </p>
          )}
        </div>
        <div className="tv-hero-side">
          <Link to="/s?sort=price_asc" className="tv-hero-tile ember">
            <div>
              <h3>Smart prices</h3>
              <p>
                {personal?.features?.price_sensitivity >= 50
                  ? 'You respond to value — markdowns are highlighted for you.'
                  : 'Filter by value and catch real markdowns across the catalog.'}
              </p>
            </div>
            <strong>Shop deals →</strong>
          </Link>
          <Link to="/s?prime=1" className="tv-hero-tile sage">
            <div>
              <h3>
                {stage === 'high_intent' || stage === 'cart_at_risk'
                  ? 'Finish strong'
                  : 'Fast ship lane'}
              </h3>
              <p>
                {stage === 'cart_at_risk'
                  ? 'Cart signal detected — complete checkout when ready.'
                  : 'Items ready for quick fulfillment when you need them soon.'}
              </p>
            </div>
            <strong>
              {stage === 'cart_at_risk' ? 'Open cart →' : 'Browse lane →'}
            </strong>
          </Link>
        </div>
      </section>

      {error && <div className="tv-alert error">{error}</div>}

      {forYou.length > 0 && (
        <section className="tv-section">
          <div className="tv-section-head">
            <h2>For you</h2>
            <span className="tv-muted">
              Powered by your live behavior
              {personal?.features?.intent_score != null &&
                ` · intent ${personal.features.intent_score}`}
            </span>
          </div>
          <div className="tv-rail">
            {forYou.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {personal?.showDealRail && dealsForYou.length > 0 && (
        <section className="tv-section">
          <div className="tv-section-head">
            <h2>Value picks for you</h2>
            <span className="tv-muted">Matched to deal-sensitive browsing</span>
          </div>
          <div className="tv-rail">
            {dealsForYou.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <section className="tv-dept-grid">
        {categories.slice(0, 8).map((c) => (
          <Link key={c.id} to={`/s?category=${c.slug}`} className="tv-dept">
            <strong>{c.name}</strong>
            <span>{c.productCount} products</span>
          </Link>
        ))}
      </section>

      <section className="tv-section">
        <div className="tv-section-head">
          <h2>Today&apos;s markdowns</h2>
          <Link to="/s">See all</Link>
        </div>
        <div className="tv-rail">
          {deals.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="tv-section">
        <div className="tv-section-head">
          <h2>Crowd favorites</h2>
          <Link to="/s?sort=bestseller">See all</Link>
        </div>
        <div className="tv-rail">
          {bestsellers.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
