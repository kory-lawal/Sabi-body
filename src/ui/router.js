/**
 * Hash routes (e.g. #/dashboard). Hash routing needs no server rewrites on
 * Vercel, and tokens in email links (#/reset-password?token=...) are never
 * sent to any server in request URLs or logs.
 */
export const PUBLIC_ROUTES = new Set(['home', 'exercises', 'login', 'register', 'forgot-password', 'reset-password', 'verify-email']);
export const AUTH_ONLY_ROUTES = new Set(['login', 'register', 'forgot-password']);
export const PROTECTED_ROUTES = new Set(['dashboard', 'history', 'profile', 'settings', 'admin', 'buddies', 'notifications']);
export const ACCOUNT_ROUTES = new Set([...PROTECTED_ROUTES, 'login', 'register', 'forgot-password', 'reset-password', 'verify-email']);

export function parseRoute(hash = '') {
  const raw = String(hash ?? '').replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  const name = path.split('/')[0] || 'home';
  const params = Object.fromEntries(new URLSearchParams(search));
  if (name === 'home' && raw === 'home') {
    return { name: 'home', params };
  }
  const known = PUBLIC_ROUTES.has(name) || PROTECTED_ROUTES.has(name);
  return { name: known ? name : 'home', params };
}

export function routeHref(name, params = {}) {
  const search = new URLSearchParams(params).toString();
  return `#/${name === 'home' ? '' : name}${search ? `?${search}` : ''}`;
}

export function isAccountRoute(route) {
  return ACCOUNT_ROUTES.has(route?.name);
}
