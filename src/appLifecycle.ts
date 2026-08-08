const createClientId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '');
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
};

export const startAppLifecycle = () => {
  const clientId = createClientId();
  let events: EventSource | null = null;

  const connect = () => {
    if (events) return;
    events = new EventSource(`/api/lifecycle/events?clientId=${encodeURIComponent(clientId)}`);
  };

  const disconnect = () => {
    events?.close();
    events = null;
  };

  const handlePageHide = () => disconnect();
  const handlePageShow = () => connect();

  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  connect();

  return () => {
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
    disconnect();
  };
};
