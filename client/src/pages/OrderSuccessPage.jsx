import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';

export default function OrderSuccessPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState(location.state?.order || null);

  useEffect(() => {
    if (!order) {
      api.order(orderId).then((d) => setOrder(d.order)).catch(() => {});
    }
  }, [orderId, order]);

  return (
    <div className="tv-panel tv-narrow" style={{ maxWidth: 560, textAlign: 'left' }}>
      <div className="tv-success-icon">✓</div>
      <h1 className="display" style={{ textAlign: 'center' }}>
        Order confirmed
      </h1>
      <p className="tv-muted" style={{ textAlign: 'center' }}>
        Thanks for shopping Trove. Your order is saved in the database.
      </p>
      <p style={{ textAlign: 'center' }}>
        Order <strong>{order?.id || orderId}</strong>
      </p>
      {order && (
        <>
          <p style={{ textAlign: 'center' }}>
            Total <strong>{order.total.formatted}</strong> · {order.status}
          </p>
          <ul className="tv-line-items">
            {order.items.map((i) => (
              <li key={i.productId}>
                <img src={i.imageUrl} alt="" />
                <div>
                  <strong>{i.title}</strong>
                  <div className="tv-muted">
                    Qty {i.qty} · {i.lineTotal.formatted}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {order.shippingAddress && (
            <div className="tv-pay-demo" style={{ marginTop: '1rem' }}>
              <strong>Ship to</strong>
              <p style={{ margin: '0.35rem 0 0' }}>
                {order.shippingAddress.fullName}
                <br />
                {order.shippingAddress.line1}
                <br />
                {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
                {order.shippingAddress.postalCode}
              </p>
            </div>
          )}
        </>
      )}
      <div className="tv-success-actions">
        <Link to="/orders" className="tv-btn primary">
          View orders
        </Link>
        <Link to="/" className="tv-btn ghost">
          Keep shopping
        </Link>
      </div>
    </div>
  );
}
