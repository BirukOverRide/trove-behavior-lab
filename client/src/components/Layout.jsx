import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useCart } from '../CartContext';
import { useTracker } from '../BehaviorTracker';

function LogoMark() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden>
      <path
        d="M18 38c0-10 6-18 14-18s14 8 14 18"
        stroke="#f0a06a"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="40" r="6" fill="#7c6cf0" />
    </svg>
  );
}

export default function Layout() {
  const { user, logout, isAuthed } = useAuth();
  const { itemCount } = useCart();
  const { search: trackSearch } = useTracker();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [categories, setCategories] = useState([]);
  const [dept, setDept] = useState(params.get('category') || '');

  useEffect(() => {
    api.categories().then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setQ(params.get('q') || '');
    setDept(params.get('category') || '');
  }, [params]);

  const onSearch = (e) => {
    e.preventDefault();
    const query = q.trim();
    if (query) trackSearch(query);
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
    if (dept) sp.set('category', dept);
    navigate(`/s?${sp.toString()}`);
  };

  return (
    <div className="tv">
      <header className="tv-header">
        <div className="tv-top">
          <Link to="/" className="tv-logo" aria-label="Trove home">
            <span className="tv-logo-mark">
              <LogoMark />
            </span>
            <span className="tv-logo-word">
              Tro<span>ve</span>
            </span>
          </Link>

          <form className="tv-search" onSubmit={onSearch}>
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              aria-label="Department"
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products, brands, categories…"
              aria-label="Search"
            />
            <button type="submit">Search</button>
          </form>

          <div className="tv-actions">
            {isAuthed ? (
              <>
                <Link to="/account" className="tv-action">
                  Hi, {user.name.split(' ')[0]}
                </Link>
                <Link to="/orders" className="tv-action">
                  Orders
                </Link>
                <button type="button" className="tv-action" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="tv-action">
                Sign in
              </Link>
            )}
            <Link to="/cart" className="tv-action cart">
              Cart
              {itemCount > 0 && <span className="tv-cart-count">{itemCount}</span>}
            </Link>
          </div>
        </div>

        <nav className="tv-cats" aria-label="Categories">
          <NavLink to="/s" end>
            All products
          </NavLink>
          {categories.map((c) => (
            <NavLink key={c.id} to={`/s?category=${c.slug}`}>
              {c.name}
            </NavLink>
          ))}
          <NavLink to="/s?sort=bestseller">Top picks</NavLink>
          <NavLink to="/s?prime=1">Fast ship</NavLink>
        </nav>
      </header>

      <main className="tv-main">
        <Outlet />
      </main>

      <footer className="tv-footer">
        <div className="tv-footer-inner">
          <div>
            <div className="brand-foot">
              Tro<span>ve</span>
            </div>
            <p>
              A modern marketplace for everyday essentials and standout finds.
              Real catalog, real cart, real accounts — powered by a live database.
            </p>
          </div>
          <div>
            <h3>Shop</h3>
            <p>
              <Link to="/s">Browse all</Link>
              <br />
              <Link to="/s?sort=bestseller">Bestsellers</Link>
              <br />
              <Link to="/cart">Your cart</Link>
            </p>
          </div>
          <div>
            <h3>Account</h3>
            <p>
              <Link to="/login">Sign in</Link>
              <br />
              <Link to="/orders">Order history</Link>
              <br />
              <Link to="/account">Profile</Link>
            </p>
          </div>
        </div>
        <div className="tv-footer-bottom">
          © {new Date().getFullYear()} Trove Commerce ·{' '}
          <a href="/admin" style={{ color: '#b8b0d0' }}>
            Intelligence admin
          </a>
        </div>
      </footer>
    </div>
  );
}
