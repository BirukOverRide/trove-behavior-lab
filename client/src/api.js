const API_BASE = '';

function sessionId() {
  let id = localStorage.getItem('shop_session_id');
  if (!id) {
    id = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('shop_session_id', id);
  }
  return id;
}

function authHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-Id': sessionId(),
  };
  const token = localStorage.getItem('shop_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
  } catch {
    throw new Error(
      'Cannot reach the API. Is the server running on port 8000?'
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export { sessionId };

export const api = {
  health: () => request('/api/health'),
  categories: () => request('/api/categories'),
  products: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const s = qs.toString();
    return request(`/api/products${s ? `?${s}` : ''}`);
  },
  product: (id) => request(`/api/products/${encodeURIComponent(id)}`),
  deals: () => request('/api/deals'),
  bestsellers: () => request('/api/bestsellers'),
  register: (body) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/api/auth/me'),
  cart: () => request('/api/cart'),
  addToCart: (productId, qty = 1) =>
    request('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ productId, qty }),
    }),
  updateCartItem: (productId, qty) =>
    request(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ qty }),
    }),
  removeCartItem: (productId) =>
    request(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    }),
  addresses: () => request('/api/addresses'),
  createAddress: (body) =>
    request('/api/addresses', { method: 'POST', body: JSON.stringify(body) }),
  placeOrder: (body) =>
    request('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  orders: () => request('/api/orders'),
  order: (id) => request(`/api/orders/${encodeURIComponent(id)}`),
  addReview: (productId, body) =>
    request(`/api/products/${encodeURIComponent(productId)}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logEvent: (payload) =>
    request('/log_event', {
      method: 'POST',
      body: JSON.stringify({ ...payload, sessionId: sessionId() }),
    }),

  // Admin / consumer intelligence
  adminOverview: () => request('/api/admin/overview'),
  adminProfiles: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const s = qs.toString();
    return request(`/api/admin/profiles${s ? `?${s}` : ''}`);
  },
  adminProfile: (key) =>
    request(`/api/admin/profiles/${encodeURIComponent(key)}`),
  adminAnalyze: (key) =>
    request(`/api/admin/profiles/${encodeURIComponent(key)}/analyze`, {
      method: 'POST',
      body: '{}',
    }),
  adminRebuild: () =>
    request('/api/admin/rebuild', { method: 'POST', body: '{}' }),
  adminEvents: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const s = qs.toString();
    return request(`/api/admin/events${s ? `?${s}` : ''}`);
  },
  adminSnapshot: () => request('/api/admin/events/stream-snapshot'),

  // Bots
  adminBots: () => request('/api/admin/bots'),
  adminBotPersonas: () => request('/api/admin/bots/personas'),
  adminBot: (id) => request(`/api/admin/bots/${encodeURIComponent(id)}`),
  adminCreateBot: (body) =>
    request('/api/admin/bots', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateBot: (id, body) =>
    request(`/api/admin/bots/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminDeleteBot: (id) =>
    request(`/api/admin/bots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminRunBot: (id, sessions = 1) =>
    request(`/api/admin/bots/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    }),
  adminRunAllBots: (sessions = 1) =>
    request('/api/admin/bots/run-all', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    }),
  adminStopAllBots: () =>
    request('/api/admin/bots/stop-all', { method: 'POST', body: '{}' }),
  adminStopBot: (id) =>
    request(`/api/admin/bots/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: '{}',
    }),
  adminFleetRunStatus: () => request('/api/admin/bots/fleet-run'),
  adminActiveBots: (withinHours = 48) =>
    request(`/api/admin/bots/active?withinHours=${withinHours}`),
  adminBotAnalysis: (id) =>
    request(`/api/admin/bots/${encodeURIComponent(id)}/analysis`),
  adminFleetBuyingAnalysis: () => request('/api/admin/bots-buying-analysis'),

  // Tiny AI learning
  adminAi: () => request('/api/admin/ai'),
  adminAiProgress: () => request('/api/admin/ai/progress'),
  adminAiTrain: (body = {}) =>
    request('/api/admin/ai/train', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminAiAuto: () => request('/api/admin/ai/auto'),
  adminAiAutoSet: (body = {}) =>
    request('/api/admin/ai/auto', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminAiRuns: () => request('/api/admin/ai/runs'),
  adminInsights: () => request('/api/admin/insights'),
  adminInsightsGrowth: () => request('/api/admin/insights/growth'),
  adminInsightsCatalog: () => request('/api/admin/insights/catalog'),
  adminInsightsBots: () => request('/api/admin/insights/bots'),
  adminInsightsModel: () => request('/api/admin/insights/model'),
  adminRealtimeAnalysis: (minutes = 30) =>
    request(`/api/admin/analysis/realtime?minutes=${minutes}`),
  adminPersonaAnalysis: () => request('/api/admin/analysis/personas'),
  adminBuyerBehavior: () => request('/api/admin/analysis/buyers'),
  adminPredictions: () => request('/api/admin/analysis/predictions'),
  adminKnowledge: () => request('/api/admin/analysis/knowledge'),
  adminChatStatus: () => request('/api/admin/chat/status'),
  adminChat: (body) =>
    request('/api/admin/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminChatClear: (body = {}) =>
    request('/api/admin/chat/clear', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminChatSaveKey: (apiKey, provider = 'auto') =>
    request('/api/admin/chat/key', {
      method: 'POST',
      body: JSON.stringify({ apiKey, provider }),
    }),
  adminChatUseLocal: () =>
    request('/api/admin/chat/local', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // Shopper-facing AI features
  aiMe: () => request('/api/ai/me'),
  aiPersonalize: () => request('/api/ai/personalize'),
};
