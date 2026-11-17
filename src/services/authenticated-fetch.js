export function createAuthenticatedFetch({
  authService,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof authService?.getSession !== 'function') {
    throw new TypeError('An auth service with getSession() is required.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }

  return async function authenticatedFetch(input, init = {}) {
    const session = await authService.getSession();
    const accessToken = session?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new Error('Please sign in to make this request.');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return fetchImpl(input, { ...init, headers });
  };
}
