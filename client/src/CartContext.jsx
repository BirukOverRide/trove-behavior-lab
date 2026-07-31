import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './api';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState({
    items: [],
    itemCount: 0,
    subtotal: { cents: 0, formatted: '$0.00', amount: '0.00' },
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.cart();
      setCart(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  const addItem = async (productId, qty = 1) => {
    const data = await api.addToCart(productId, qty);
    setCart(data);
    return data;
  };

  const setQty = async (productId, qty) => {
    const data = await api.updateCartItem(productId, qty);
    setCart(data);
    return data;
  };

  const removeItem = async (productId) => {
    const data = await api.removeCartItem(productId);
    setCart(data);
    return data;
  };

  const value = useMemo(
    () => ({
      ...cart,
      loading,
      refresh,
      addItem,
      setQty,
      removeItem,
    }),
    [cart, loading, refresh]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart requires CartProvider');
  return ctx;
}
