import { Link } from 'react-router-dom';
import { useCart } from '../CartContext';
import { useTracker } from '../BehaviorTracker';
import { useAuth } from '../AuthContext';

export default function CartPage() {
  const { items, itemCount, subtotal, setQty, removeItem, loading } = useCart();
  const { removeFromCart } = useTracker();
  const { isAuthed } = useAuth();

  if (loading) return <div className="tv-narrow tv-muted">Loading cart…</div>;

  if (!items.length) {
    return (
      <div className="tv-empty">
        <h1>Your cart is empty</h1>
        <p className="tv-muted">Discover products and add a few favorites.</p>
        <Link to="/s" className="tv-btn primary">
          Browse catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="tv-cart-page">
      <div className="tv-panel">
        <h1>Cart ({itemCount})</h1>
        {items.map((line) => (
          <div key={line.productId} className="tv-cart-line">
            <img src={line.product.images[0]} alt="" />
            <div>
              <Link to={`/product/${line.productId}`}>
                <strong>{line.product.title}</strong>
              </Link>
              <div className={line.product.inStock ? 'tv-instock' : 'tv-oos'}>
                {line.product.inStock ? 'In stock' : 'Out of stock'}
              </div>
              <div className="tv-cart-actions">
                <select
                  value={line.qty}
                  onChange={(e) => setQty(line.productId, Number(e.target.value))}
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Qty {n}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    await removeItem(line.productId);
                    removeFromCart(line.productId);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="tv-cart-line-price">{line.lineTotal.formatted}</div>
          </div>
        ))}
      </div>

      <aside className="tv-panel">
        <h2>Summary</h2>
        <div className="tv-cart-sub">
          Subtotal <strong>{subtotal.formatted}</strong>
        </div>
        <p className="tv-muted small">Shipping & tax calculated at checkout.</p>
        {isAuthed ? (
          <Link to="/checkout" className="tv-btn accent block">
            Checkout
          </Link>
        ) : (
          <Link to="/login?next=/checkout" className="tv-btn accent block">
            Sign in to checkout
          </Link>
        )}
        <Link to="/s" className="tv-btn ghost block" style={{ marginTop: '0.5rem' }}>
          Keep shopping
        </Link>
      </aside>
    </div>
  );
}
