import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

export default function OrdersPage() {
  const { isAuthed } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed) {
      navigate('/login?next=/orders');
      return;
    }
    api
      .orders()
      .then((d) => setOrders(d.orders || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isAuthed, navigate]);

  return (
    <div>
      <h1 className="display" style={{ marginTop: 0 }}>
        Your orders
      </h1>
      {loading && <p className="tv-muted">Loading…</p>}
      {error && <div className="tv-alert error">{error}</div>}
      {!loading && !orders.length && !error && (
        <div className="tv-empty">
          <h2>No orders yet</h2>
          <p className="tv-muted">When you place an order, it shows up here from the database.</p>
          <Link to="/s" className="tv-btn primary">
            Start shopping
          </Link>
        </div>
      )}
      {orders.map((o) => (
        <article key={o.id} className="tv-order-card">
          <header>
            <div>
              <span className="tv-muted">Placed</span>
              <div>{new Date(o.placedAt).toLocaleString()}</div>
            </div>
            <div>
              <span className="tv-muted">Total</span>
              <div>{o.total.formatted}</div>
            </div>
            <div>
              <span className="tv-muted">Order</span>
              <div>
                <Link to={`/order/${o.id}`}>{o.id}</Link>
              </div>
            </div>
          </header>
          <div className="tv-order-items">
            {o.items.map((i) => (
              <div key={i.productId} className="tv-order-item">
                <img src={i.imageUrl} alt="" />
                <div>
                  <Link to={`/product/${i.productId}`}>{i.title}</Link>
                  <div className="tv-muted">
                    Qty {i.qty} · {i.lineTotal.formatted}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="tv-order-status">Status: {o.status}</div>
        </article>
      ))}
    </div>
  );
}
