import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import ProductCard from '../components/ProductCard';
import { useTracker } from '../BehaviorTracker';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { filterCategory } = useTracker();
  const [data, setData] = useState({
    products: [],
    total: 0,
    brands: [],
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const sort = params.get('sort') || 'featured';
  const prime = params.get('prime') || '';
  const brand = params.get('brand') || '';
  const page = params.get('page') || '1';

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .products({ q, category, sort, prime, brand, page, limit: 24 })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, category, sort, prime, brand, page]);

  useEffect(() => {
    if (category) filterCategory(category);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="tv-search-page">
      <aside className="tv-filters">
        <h3>Brand</h3>
        <button
          type="button"
          className={!brand ? 'active' : ''}
          onClick={() => set('brand', '')}
        >
          Any brand
        </button>
        {(data.brands || []).slice(0, 14).map((b) => (
          <button
            key={b}
            type="button"
            className={brand === b ? 'active' : ''}
            onClick={() => set('brand', b)}
          >
            {b}
          </button>
        ))}
        <h3>Delivery</h3>
        <label className="tv-check">
          <input
            type="checkbox"
            checked={prime === '1'}
            onChange={(e) => set('prime', e.target.checked ? '1' : '')}
          />
          Fast ship only
        </label>
      </aside>

      <div>
        <div className="tv-results-head">
          <div>
            {q ? (
              <h1>
                Results for “{q}”
              </h1>
            ) : (
              <h1>{category ? category.replace(/-/g, ' ') : 'All products'}</h1>
            )}
            <p className="tv-muted">
              {loading ? 'Loading…' : `${data.total.toLocaleString()} results`}
            </p>
          </div>
          <label className="tv-sort">
            Sort
            <select value={sort} onChange={(e) => set('sort', e.target.value)}>
              <option value="featured">Featured</option>
              <option value="price_asc">Price: low → high</option>
              <option value="price_desc">Price: high → low</option>
              <option value="rating">Top rated</option>
              <option value="bestseller">Bestsellers</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        </div>

        {error && <div className="tv-alert error">{error}</div>}

        <div className="tv-results-grid">
          {(data.products || []).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>

        {!loading && data.products?.length === 0 && (
          <div className="tv-alert">No products match these filters.</div>
        )}

        {data.totalPages > 1 && (
          <div className="tv-pager">
            <button
              type="button"
              disabled={Number(page) <= 1}
              onClick={() => set('page', String(Number(page) - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} of {data.totalPages}
            </span>
            <button
              type="button"
              disabled={Number(page) >= data.totalPages}
              onClick={() => set('page', String(Number(page) + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
