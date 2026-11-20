/**
 * One authenticated WebSocket per tab for notifications, chat, presence and
 * workout-room signalling.
 *
 * - The access token is sent in the first message, never in the URL.
 * - Reconnects automatically with jittered backoff (and immediately when the
 *   browser comes back online), refreshing the token when the server asks.
 * - request() returns a promise settled by the server's ack.
 */

const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 12_000;

export function realtimeUrl(location = globalThis.location, env = {}) {
  if (env.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  const host = location?.hostname ?? '';
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) {
    // Vite proxies /api/ws to the local FastAPI server during development.
    const scheme = location?.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location?.host ?? 'localhost:5176'}/api/ws`;
  }
  // Vercel rewrites cannot carry WebSockets, so production connects to Render directly.
  return 'wss://sabi-body-1.onrender.com/api/ws';
}

export function createRealtimeClient({
  url,
  getToken,
  refreshToken = async () => null,
  WebSocketImpl = globalThis.WebSocket,
  timers = globalThis,
  random = Math.random,
  view = globalThis,
} = {}) {
  let socket = null;
  let status = 'idle';
  let wanted = false;
  let attempt = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let nextId = 1;
  const listeners = new Map();
  const statusListeners = new Set();
  const pending = new Map();
  const outbox = [];

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) listener(status);
  }

  function emit(type, data, message) {
    for (const listener of listeners.get(type) ?? []) {
      try {
        listener(data, message);
      } catch (error) {
        globalThis.console?.error?.('Realtime listener failed', error);
      }
    }
    for (const listener of listeners.get('*') ?? []) {
      try {
        listener(data, message);
      } catch {
        /* ignore */
      }
    }
  }

  function rawSend(payload) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  function clearTimers() {
    timers.clearTimeout(reconnectTimer);
    timers.clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
  }

  function scheduleReconnect(delayOverride) {
    if (!wanted) return;
    timers.clearTimeout(reconnectTimer);
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5));
    const delay = delayOverride ?? Math.round(base * (0.5 + random() * 0.5));
    attempt += 1;
    setStatus('reconnecting');
    reconnectTimer = timers.setTimeout(open, delay);
  }

  function failPending(message) {
    for (const [, entry] of pending) {
      timers.clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  }

  function open() {
    if (!wanted || !WebSocketImpl) return;
    const token = getToken();
    if (!token) {
      // No token yet (still restoring the session); try again shortly.
      scheduleReconnect(1500);
      return;
    }
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    let ws;
    try {
      ws = new WebSocketImpl(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', data: { token } }));
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(message);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      timers.clearInterval(pingTimer);
      failPending('Connection lost.');
      if (!wanted) {
        setStatus('idle');
        return;
      }
      if (event?.code === 4403) {
        setStatus('blocked');
        return;
      }
      if (event?.code === 4401) {
        // The token expired or was revoked: refresh, then reconnect.
        Promise.resolve(refreshToken()).then((fresh) => {
          if (fresh || getToken()) scheduleReconnect(250);
          else setStatus('signed-out');
        }).catch(() => setStatus('signed-out'));
        return;
      }
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows and handles reconnection */
    };
  }

  async function handleExpiring() {
    try {
      await refreshToken();
    } catch {
      return;
    }
    const token = getToken();
    if (token) rawSend({ type: 'auth.refresh', data: { token } });
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'ready':
        attempt = 0;
        setStatus('open');
        timers.clearInterval(pingTimer);
        pingTimer = timers.setInterval(() => rawSend({ type: 'ping' }), PING_INTERVAL_MS);
        while (outbox.length) {
          rawSend(outbox.shift());
        }
        emit('ready', message.data, message);
        return;
      case 'ack': {
        const entry = pending.get(message.ref);
        if (entry) {
          pending.delete(message.ref);
          timers.clearTimeout(entry.timer);
          if (message.ok) entry.resolve(message.data ?? {});
          else {
            const error = new Error(message.error?.message || 'Request failed.');
            error.code = message.error?.code;
            entry.reject(error);
          }
        }
        return;
      }
      case 'auth.expiring':
        void handleExpiring();
        return;
      case 'pong':
        return;
      default:
        emit(message.type, message.data ?? {}, message);
    }
  }

  function onBrowserOnline() {
    if (wanted && status !== 'open') {
      attempt = 0;
      timers.clearTimeout(reconnectTimer);
      open();
    }
  }

  function onBrowserOffline() {
    if (wanted) setStatus('offline');
  }

  view?.addEventListener?.('online', onBrowserOnline);
  view?.addEventListener?.('offline', onBrowserOffline);

  return {
    connect() {
      if (wanted) return;
      wanted = true;
      attempt = 0;
      open();
    },
    disconnect() {
      wanted = false;
      clearTimers();
      outbox.length = 0;
      failPending('Disconnected.');
      const ws = socket;
      socket = null;
      try {
        ws?.close?.(1000);
      } catch {
        /* ignore */
      }
      setStatus('idle');
    },
    /** Called when the API client obtains a new access token. */
    tokenChanged(token) {
      if (token && status === 'open') {
        rawSend({ type: 'auth.refresh', data: { token } });
      }
    },
    send(type, data = {}) {
      const payload = { type, data };
      if (!rawSend(payload) && wanted) outbox.push(payload);
    },
    request(type, data = {}, { timeout = REQUEST_TIMEOUT_MS } = {}) {
      const id = `r${nextId++}`;
      const payload = { type, id, data };
      return new Promise((resolve, reject) => {
        const timer = timers.setTimeout(() => {
          pending.delete(id);
          reject(new Error('The server took too long to answer.'));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        if (!rawSend(payload)) {
          if (wanted) outbox.push(payload);
          else {
            pending.delete(id);
            timers.clearTimeout(timer);
            reject(new Error('Not connected.'));
          }
        }
      });
    },
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    status: () => status,
  };
}
