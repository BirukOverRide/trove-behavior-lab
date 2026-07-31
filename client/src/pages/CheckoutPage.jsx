import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useCart } from '../CartContext';
import { useTracker } from '../BehaviorTracker';

export default function CheckoutPage() {
  const { isAuthed, user } = useAuth();
  const { items, itemCount, subtotal, refresh } = useCart();
  const { beginCheckout, purchase } = useTracker();
  const navigate = useNavigate();
  const [ship, setShip] = useState({
    fullName: user?.name || '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'US',
    phone: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthed) {
      navigate('/login?next=/checkout');
      return;
    }
    api
      .addresses()
      .then((d) => {
        const a = d.addresses?.[0];
        if (a) {
          setShip({
            fullName: a.fullName,
            line1: a.line1,
            line2: a.line2 || '',
            city: a.city,
            state: a.state,
            postalCode: a.postalCode,
            country: a.country || 'US',
            phone: a.phone || '',
          });
        }
      })
      .catch(() => {});
  }, [isAuthed, navigate]);

  useEffect(() => {
    if (items.length) {
      beginCheckout({
        itemCount,
        subtotal: subtotal.cents,
        productIds: items.map((i) => i.productId),
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) {
    return (
      <div className="tv-empty">
        <h1>Nothing to check out</h1>
        <Link to="/s" className="tv-btn primary">
          Browse products
        </Link>
      </div>
    );
  }

  const shippingCents = subtotal.cents >= 3500 ? 0 : 599;
  const taxCents = Math.round(subtotal.cents * 0.08);
  const totalCents = subtotal.cents + shippingCents + taxCents;
  const fmt = (c) => `$${(c / 100).toFixed(2)}`;

  const onChange = (e) => setShip((s) => ({ ...s, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { order } = await api.placeOrder({
        shipping: ship,
        paymentMethod: 'card_demo',
      });
      purchase(order);
      await refresh();
      navigate(`/order/${order.id}`, { state: { order } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="display" style={{ marginTop: 0 }}>
        Checkout
      </h1>
      <div className="tv-checkout-grid">
        <form onSubmit={onSubmit}>
          <section className="tv-panel" style={{ marginBottom: '1rem' }}>
            <h2>Shipping</h2>
            <div className="tv-fields">
              <label>
                Full name
                <input name="fullName" value={ship.fullName} onChange={onChange} required />
              </label>
              <label>
                Address
                <input name="line1" value={ship.line1} onChange={onChange} required />
              </label>
              <label>
                Apt / suite
                <input name="line2" value={ship.line2} onChange={onChange} />
              </label>
              <div className="tv-field-row">
                <label>
                  City
                  <input name="city" value={ship.city} onChange={onChange} required />
                </label>
                <label>
                  State
                  <input name="state" value={ship.state} onChange={onChange} required />
                </label>
                <label>
                  ZIP
                  <input
                    name="postalCode"
                    value={ship.postalCode}
                    onChange={onChange}
                    required
                  />
                </label>
              </div>
              <label>
                Phone
                <input name="phone" value={ship.phone} onChange={onChange} />
              </label>
            </div>
          </section>

          <section className="tv-panel" style={{ marginBottom: '1rem' }}>
            <h2>Payment</h2>
            <div className="tv-pay-demo">
              <strong>Demo card ···· 4242</strong>
              <p className="tv-muted small" style={{ margin: '0.35rem 0 0' }}>
                No real charge — this stores the order in the database only.
              </p>
            </div>
          </section>

          <section className="tv-panel" style={{ marginBottom: '1rem' }}>
            <h2>Items</h2>
            <ul className="tv-line-items">
              {items.map((i) => (
                <li key={i.productId}>
                  <img src={i.product.images[0]} alt="" />
                  <div>
                    <strong>{i.product.title}</strong>
                    <div className="tv-muted">
                      Qty {i.qty} · {i.lineTotal.formatted}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {error && <div className="tv-alert error">{error}</div>}
          <button type="submit" className="tv-btn accent" disabled={busy}>
            {busy ? 'Placing order…' : `Place order · ${fmt(totalCents)}`}
          </button>
        </form>

        <aside className="tv-panel">
          <h2>Order total</h2>
          <div className="tv-sum-row">
            <span>Items</span>
            <span>{subtotal.formatted}</span>
          </div>
          <div className="tv-sum-row">
            <span>Shipping</span>
            <span>{shippingCents === 0 ? 'FREE' : fmt(shippingCents)}</span>
          </div>
          <div className="tv-sum-row">
            <span>Tax</span>
            <span>{fmt(taxCents)}</span>
          </div>
          <div className="tv-sum-row total">
            <span>Total</span>
            <span>{fmt(totalCents)}</span>
          </div>
          <p className="tv-muted small">Free shipping on orders $35+</p>
          <Link to="/cart">← Edit cart</Link>
        </aside>
      </div>
    </div>
  );
}
