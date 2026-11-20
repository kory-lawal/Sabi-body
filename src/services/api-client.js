/**
 * Talks to the SabiBody FastAPI backend.
 *
 * Security model:
 * - The short-lived access token is held only in this closure (memory). It is
 *   never written to localStorage or sessionStorage.
 * - The refresh token is an HttpOnly cookie the browser sends automatically to
 *   /api/auth; JavaScript can never read it.
 * - Requests that fail with an expired/revoked access token trigger one shared
 *   refresh and are retried once.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const RETRYABLE_AUTH_CODES = new Set(['token_expired', 'invalid_token', 'session_revoked', 'not_authenticated']);

function messageFromValidation(detail) {
  if (!Array.isArray(detail) || detail.length === 0) {
    return '';
  }
  const first = detail[0];
  const field = Array.isArray(first?.loc) ? first.loc.at(-1) : '';
  const label = {
    email: 'Email',
    new_email: 'Email',
    full_name: 'Full name',
    password: 'Password',
    new_password: 'New password',
  }[field];
  const text = String(first?.msg ?? 'Check the highlighted fields.').replace(/^Value error, /, '');
  if (field === 'email' || field === 'new_email') {
    return 'Enter a valid email address.';
  }
  return label ? `${label}: ${text}` : text;
}

async function toApiError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const detail = body?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.message) {
    return new ApiError(detail.message, { status: response.status, code: detail.code ?? 'error', details: detail });
  }
  if (Array.isArray(detail)) {
    return new ApiError(messageFromValidation(detail), { status: response.status, code: 'validation_error', details: detail });
  }
  const fallback = response.status >= 500
    ? 'SabiBody is having trouble right now. Please try again in a moment.'
    : 'Something went wrong. Please try again.';
  return new ApiError(typeof detail === 'string' ? detail : fallback, { status: response.status, code: 'error' });
}

export function createApiClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseUrl = '',
  onSessionLost = () => {},
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let accessToken = null;
  let refreshPromise = null;
  const tokenListeners = new Set();

  function setToken(token) {
    const next = token || null;
    if (next === accessToken) {
      return;
    }
    accessToken = next;
    for (const listener of tokenListeners) {
      try {
        listener(accessToken);
      } catch {
        /* a listener must never break authentication */
      }
    }
  }

  async function send(path, { method = 'GET', body, auth = false, signal } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      throw new ApiError('We could not reach SabiBody. Check your internet connection and try again.', {
        code: 'network_error',
      });
    }
  }

  async function parse(response) {
    if (response.status === 204) {
      return null;
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /** Exchange the refresh cookie for a new access token (single-flight). */
  function refresh() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await send('/api/auth/refresh', { method: 'POST' });
          if (response.ok) {
            const session = await parse(response);
            setToken(session.access_token);
            return session;
          }
          const error = await toApiError(response);
          // Another tab rotated the cookie at the same moment; its new cookie is already stored.
          if (error.code === 'refresh_conflict') {
            await wait(250 * (attempt + 1));
            continue;
          }
          setToken(null);
          throw error;
        }
        setToken(null);
        throw new ApiError('Please log in again.', { status: 401, code: 'session_revoked' });
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function request(path, options = {}) {
    const response = await send(path, options);
    if (response.ok) {
      return parse(response);
    }
    const error = await toApiError(response);
    if (options.auth && response.status === 401 && RETRYABLE_AUTH_CODES.has(error.code) && !options.retried) {
      try {
        await refresh();
      } catch (refreshError) {
        if (refreshError instanceof ApiError && refreshError.status === 401) {
          onSessionLost(refreshError);
        }
        throw refreshError;
      }
      return request(path, { ...options, retried: true });
    }
    throw error;
  }

  return {
    request,
    refresh,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    delete: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
    setAccessToken(token) {
      setToken(token);
    },
    hasAccessToken: () => Boolean(accessToken),
    /** The current in-memory access token (used to authenticate the realtime socket). */
    getAccessToken: () => accessToken,
    onTokenChange(listener) {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },
  };
}
