import { ApiError, createApiClient } from './api-client.js';

/**
 * Session state for the browser.
 *
 * status: 'checking' (restoring on page load) | 'authenticated' | 'anonymous'
 * Sessions survive refreshes and browser restarts through the HttpOnly refresh
 * cookie: on load, restore() exchanges it for a new in-memory access token.
 */
export function createAuthService({
  api = null,
  BroadcastChannelImpl = globalThis.BroadcastChannel,
  retryDelays = [3000, 6000, 12000, 24000, 30000, 30000],
  setTimeoutImpl = globalThis.setTimeout?.bind(globalThis),
  view = globalThis,
} = {}) {
  const listeners = new Set();
  let state = { status: 'checking', user: null, error: '' };
  let channel = null;

  const client = api ?? createApiClient({
    onSessionLost: () => setAnonymous(),
  });

  function emit() {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (error) {
        globalThis.console?.error?.('[SabiBody] Auth listener failed.', error);
      }
    }
  }

  function setState(changes) {
    state = { ...state, ...changes };
    emit();
  }

  function setAnonymous(error = '') {
    client.setAccessToken(null);
    setState({ status: 'anonymous', user: null, error });
  }

  function broadcast(type) {
    try {
      channel?.postMessage({ type });
    } catch {
      // Cross-tab sync is a convenience only.
    }
  }

  if (typeof BroadcastChannelImpl === 'function') {
    try {
      channel = new BroadcastChannelImpl('sabibody-auth');
      channel.unref?.(); // Node only; lets test processes exit.
      channel.onmessage = (event) => {
        if (event?.data?.type === 'logout') {
          setAnonymous();
        } else if (event?.data?.type === 'login' && state.status !== 'authenticated') {
          void restore();
        }
      };
    } catch {
      channel = null;
    }
  }

  function acceptSession(session) {
    client.setAccessToken(session.access_token);
    setState({ status: 'authenticated', user: session.user, error: '' });
    return session.user;
  }

  let retryIndex = 0;
  let retryTimer = null;

  // A sleeping or restarting server (e.g. a Render cold start) must not look like
  // a logout: keep retrying while the refresh cookie may still be valid.
  function scheduleRestoreRetry() {
    if (!setTimeoutImpl || retryTimer || retryIndex >= retryDelays.length) {
      return;
    }
    const delay = retryDelays[retryIndex];
    retryIndex += 1;
    retryTimer = setTimeoutImpl(() => {
      retryTimer = null;
      if (state.status !== 'authenticated') {
        void restore();
      }
    }, delay);
    retryTimer?.unref?.(); // Node only; lets test processes exit.
  }

  view?.addEventListener?.('online', () => {
    if (state.status !== 'authenticated' && state.error) {
      retryIndex = 0;
      void restore();
    }
  });

  async function restore() {
    try {
      const session = await client.refresh();
      retryIndex = 0;
      return acceptSession(session);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAnonymous();
      } else {
        // Network or server problem: stay signed out for now without discarding the
        // cookie, and try again shortly.
        setAnonymous(error?.message || 'We could not restore your session.');
        scheduleRestoreRetry();
      }
      return null;
    }
  }

  return {
    api: client,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    async register({ fullName, email, password }) {
      return client.post('/api/auth/register', { full_name: fullName, email, password });
    },
    async login({ email, password, remember = true }) {
      const session = await client.post('/api/auth/login', { email, password, remember });
      acceptSession(session);
      broadcast('login');
      return session.user;
    },
    async logout() {
      try {
        await client.post('/api/auth/logout');
      } finally {
        setAnonymous();
        broadcast('logout');
      }
    },
    async logoutEverywhere() {
      try {
        await client.post('/api/auth/logout-all', undefined, { auth: true });
      } finally {
        setAnonymous();
        broadcast('logout');
      }
    },
    verifyEmail: (token) => client.post('/api/auth/verify-email', { token }),
    resendVerification: (email) => client.post('/api/auth/resend-verification', { email }),
    forgotPassword: (email) => client.post('/api/auth/forgot-password', { email }),
    resetPassword: (token, password) => client.post('/api/auth/reset-password', { token, password }),
    async refreshUser() {
      const user = await client.get('/api/account/me', { auth: true });
      setState({ user });
      return user;
    },
    async updateName(fullName) {
      const user = await client.patch('/api/account/me', { full_name: fullName }, { auth: true });
      setState({ user });
      return user;
    },
    changePassword: (currentPassword, newPassword) =>
      client.post('/api/account/password', { current_password: currentPassword, new_password: newPassword }, { auth: true }),
    changeEmail: (newEmail, password) =>
      client.post('/api/account/email', { new_email: newEmail, password }, { auth: true }),
    revokeOtherSessions: () => client.post('/api/account/sessions/revoke-others', undefined, { auth: true }),
    async deleteAccount(password) {
      const result = await client.delete('/api/account', { password }, { auth: true });
      setAnonymous();
      broadcast('logout');
      return result;
    },
  };
}
