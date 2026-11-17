import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthenticatedFetch } from '../src/services/authenticated-fetch.js';

test('authenticated fetch adds the bearer token and preserves request data', async () => {
  const response = { status: 200 };
  const headers = new Headers({ 'X-Trace-Id': 'trace-123' });
  const body = JSON.stringify({ exercise: 'squats' });
  let captured;
  const fetchImpl = async (input, init) => {
    captured = { input, init };
    return response;
  };
  const authenticatedFetch = createAuthenticatedFetch({
    authService: {
      getSession: async () => ({ access_token: 'access-token' }),
    },
    fetchImpl,
  });

  assert.equal(
    await authenticatedFetch('/api/auth/me', {
      method: 'POST',
      headers,
      body,
    }),
    response,
  );
  assert.equal(captured.input, '/api/auth/me');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.body, body);
  assert.equal(captured.init.headers.get('Authorization'), 'Bearer access-token');
  assert.equal(captured.init.headers.get('X-Trace-Id'), 'trace-123');
});

test('authenticated fetch rejects without a session before making a request', async () => {
  let fetchCalled = false;
  const authenticatedFetch = createAuthenticatedFetch({
    authService: { getSession: async () => null },
    fetchImpl: async () => {
      fetchCalled = true;
    },
  });

  await assert.rejects(authenticatedFetch('/api/auth/me'), /sign in/i);
  assert.equal(fetchCalled, false);
});

test('authenticated fetch propagates session lookup errors', async () => {
  const error = new Error('session lookup failed');
  const authenticatedFetch = createAuthenticatedFetch({
    authService: { getSession: async () => { throw error; } },
    fetchImpl: async () => assert.fail('fetch must not run'),
  });

  await assert.rejects(authenticatedFetch('/api/auth/me'), error);
});
