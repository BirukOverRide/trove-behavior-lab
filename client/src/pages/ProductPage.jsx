import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useCart } from '../CartContext';
import { useTracker } from '../BehaviorTracker';
import Stars from '../components/Stars';
import ProductCard from '../components/ProductCard';

export default function ProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { viewProduct, addToCart } = useTracker();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [related, setRelated] = useState([]);
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError('');
    setMsg('');
    setQty(1);
    setImg(0);
    api
      .product(id)
      .then((d) => {
        setProduct(d.product);
        setReviews(d.reviews || []);
        setRelated(d.related || []);
        viewProduct(d.product);
      })
      .catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="tv-narrow">
        <div className="tv-alert error">{error}</div>
        <Link to="/">Back home</Link>
      </div>
    );
  }

  if (!product) {
    return <div className="tv-narrow tv-muted">Loading product…</div>;
  }

  const [dollars, cents] = product.price.amount.split('.');

  const onAdd = async (buyNow = false) => {
    setBusy(true);
    setMsg('');
    try {
      await addItem(product.id, qty);
      addToCart(product, qty);
      if (buyNow) navigate('/cart');
      else setMsg('Added to your cart');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="tv-pdp">
        <div className="tv-crumb">
          <Link to={`/s?category=${product.categorySlug}`}>{product.categoryName}</Link>
          <span>/</span>
          <span>{product.brand}</span>
        </div>

        <div className="tv-pdp-grid">
          <div className="tv-gallery">
            <div className="tv-thumbs">
              {product.images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  className={img === i ? 'active' : ''}
                  onClick={() => setImg(i)}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
            <div className="tv-main-img">
              <img src={product.images[img]} alt={product.title} />
            </div>
          </div>

          <div className="tv-pdp-info">
            <div className="tv-pills" style={{ position: 'static', marginBottom: '0.5rem' }}>
              {product.isAmazonChoice && <span className="tv-pill pick">Trove Pick</span>}
              {product.isBestseller && <span className="tv-pill hot">Hot</span>}
              {product.isPrime && <span className="tv-pill fast">Fast ship</span>}
            </div>
            <h1>{product.title}</h1>
            <Link
              to={`/s?brand=${encodeURIComponent(product.brand)}`}
              className="tv-brand-link"
            >
              {product.brand}
            </Link>
            <div className="tv-pdp-rating">
              <Stars rating={product.ratingAvg} count={product.ratingCount} />
            </div>
            <div className="tv-price-block">
              {product.discountPercent > 0 && (
                <span className="tv-off">-{product.discountPercent}%</span>
              )}
              <span className="tv-price" style={{ fontSize: '1.6rem' }}>
                ${dollars}
                <span className="cents">{cents}</span>
              </span>
              {product.listPrice && (
                <div className="tv-list-line">
                  Was <s>{product.listPrice.formatted}</s>
                </div>
              )}
            </div>
            <p className="tv-desc">{product.description}</p>
            <h3>Highlights</h3>
            <ul className="tv-bullets">
              {product.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>

          <aside className="tv-buybox">
            <div className="tv-price" style={{ fontSize: '1.5rem' }}>
              ${dollars}
              <span className="cents">{cents}</span>
            </div>
            <p className={product.inStock ? 'tv-instock' : 'tv-oos'}>
              {product.inStock ? 'In stock' : 'Out of stock'}
            </p>
            <label>
              Qty
              <select
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                disabled={!product.inStock}
              >
                {Array.from(
                  { length: Math.min(10, product.stock) },
                  (_, i) => i + 1
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="tv-btn primary"
              disabled={!product.inStock || busy}
              onClick={() => onAdd(false)}
            >
              Add to cart
            </button>
            <button
              type="button"
              className="tv-btn accent"
              disabled={!product.inStock || busy}
              onClick={() => onAdd(true)}
            >
              Buy now
            </button>
            {msg && (
              <div className={`tv-alert ${msg.includes('Added') ? 'success' : 'error'}`}>
                {msg}
              </div>
            )}
            <div className="tv-buy-meta">
              <div>
                <span>Ships from</span>
                <strong>Trove</strong>
              </div>
              <div>
                <span>Sold by</span>
                <strong>{product.brand}</strong>
              </div>
              <div>
                <span>Returns</span>
                <strong>30-day demo policy</strong>
              </div>
            </div>
          </aside>
        </div>

        <section className="tv-reviews">
          <h2>Customer reviews</h2>
          <div className="tv-review-summary">
            <Stars rating={product.ratingAvg} />
            <strong>{product.ratingAvg.toFixed(1)} / 5</strong>
            <span className="tv-muted">
              {product.ratingCount.toLocaleString()} ratings
            </span>
          </div>
          {reviews.map((r) => (
            <article key={r.id} className="tv-review">
              <div className="tv-review-user">{r.userName}</div>
              <div className="tv-review-title-row">
                <Stars rating={r.rating} size="sm" />
                <strong>{r.title}</strong>
              </div>
              <div className="tv-muted">
                {new Date(r.createdAt).toLocaleDateString()}
                {r.verified ? ' · Verified purchase' : ''}
              </div>
              <p>{r.body}</p>
            </article>
          ))}
        </section>
      </div>

      {related.length > 0 && (
        <section className="tv-section" style={{ marginTop: '1.5rem' }}>
          <div className="tv-section-head">
            <h2>You might also like</h2>
          </div>
          <div className="tv-rail">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
