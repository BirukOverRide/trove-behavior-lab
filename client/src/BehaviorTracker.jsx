import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { api, sessionId } from './api';
import { useAuth } from './AuthContext';

const TrackerContext = createContext(null);

/**
 * Tracks every shopper activity and ships it to the API.
 * Events rebuild per-profile consumer behavior models for the admin AI console.
 */
export function BehaviorTrackerProvider({ children }) {
  const location = useLocation();
  const { user } = useAuth();

  // Skip tracking noise on admin routes
  const isAdminRoute = location.pathname.startsWith('/admin');

  const logEvent = useCallback(
    (type, target, extra = {}) => {
      if (isAdminRoute) return;
      const payload = {
        // Prefer real account id so journeys attach to a profile
        userId: user?.id || localStorage.getItem('behavior_uid') || null,
        sessionId: sessionId(),
        type,
        target,
        path: window.location.pathname,
        url: window.location.href,
        timestamp: new Date().toISOString(),
        ...extra,
      };
      api.logEvent(payload).catch(() => {});
    },
    [user?.id, isAdminRoute]
  );

  useEffect(() => {
    if (!localStorage.getItem('behavior_uid')) {
      localStorage.setItem(
        'behavior_uid',
        'u_' + Math.random().toString(36).slice(2, 11)
      );
    }
  }, []);

  useEffect(() => {
    if (isAdminRoute) return;
    logEvent('page_view', location.pathname, {
      path: location.pathname,
      search: location.search,
    });
  }, [location.pathname, location.search, logEvent, isAdminRoute]);

  const value = useMemo(
    () => ({
      logEvent,
      viewProduct: (p) =>
        logEvent('view_product', p.id, {
          productId: p.id,
          category: p.categorySlug || p.categoryId,
          price: p.price?.cents,
          brand: p.brand,
        }),
      addToCart: (p, qty = 1) =>
        logEvent('add_to_cart', p.id, {
          productId: p.id,
          qty,
          price: p.price?.cents,
          brand: p.brand,
          category: p.categorySlug || p.categoryId,
        }),
      removeFromCart: (productId) =>
        logEvent('remove_from_cart', productId, { productId }),
      search: (q) => logEvent('search', q, { query: q }),
      filterCategory: (c) => logEvent('filter_category', c, { category: c }),
      beginCheckout: (summary) => logEvent('begin_checkout', 'checkout', summary),
      purchase: (order) =>
        logEvent('purchase', order.id, {
          orderId: order.id,
          total: order.total?.cents,
          productIds: (order.items || []).map((i) => i.productId),
        }),
    }),
    [logEvent]
  );

  return (
    <TrackerContext.Provider value={value}>{children}</TrackerContext.Provider>
  );
}

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker requires BehaviorTrackerProvider');
  return ctx;
}
