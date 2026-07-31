document.addEventListener('DOMContentLoaded', () => {
  const ENDPOINT = '/behavior_analysis/log_event.php';
  
  // Helper to get or set a persistent User ID cookie
  const getUserId = () => {
    let userId = document.cookie.replace(/(?:(?:^|.*;\s*)behavior_uid\s*\=\s*([^;]*).*$)|^.*$/, "$1");
    if (!userId) {
      userId = 'u_' + Math.random().toString(36).substr(2, 9);
      document.cookie = `behavior_uid=${userId}; path=/; max-age=31536000`;
    }
    return userId;
  };

  const logEvent = (type, target, extraData = {}) => {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: getUserId(),
        type,
        target,
        ...extraData,
        url: window.location.href,
        timestamp: new Date().toISOString()
      })
    });
  };

  // Usage example for buying behavior:
  // logEvent('purchase', 'product_id_123', { amount: 50.00 });

  logEvent('page_view', window.location.pathname);

  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') {
      logEvent('click', e.target.tagName + '#' + (e.target.id || e.target.className || 'unnamed'));
    }
  });
});