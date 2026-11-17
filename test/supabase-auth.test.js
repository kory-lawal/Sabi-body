import assert from 'node:assert/strict';
import test from 'node:test';

import { createSupabaseAuthService } from '../src/services/supabase-auth.js';

function createAuthDouble(results = {}) {
  const calls = [];
  let authCallback;
  const auth = {
    async getSession() {
      calls.push(['getSession']);
      return results.getSession ?? { data: { session: null }, error: null };
    },
    async getUser() {
      calls.push(['getUser']);
      return results.getUser ?? { data: { user: { id: 'user-id' } }, error: null };
    },
    onAuthStateChange(callback) {
      calls.push(['onAuthStateChange']);
      authCallback = callback;
      return { data: { subscription: { unsubscribe() { calls.push(['unsubscribe']); } } } };
    },
    async signUp(...args) {
      calls.push(['signUp', ...args]);
      return results.signUp ?? { data: { user: { id: 'user-id' }, session: null }, error: null };
    },
    async signInWithPassword(...args) {
      calls.push(['signInWithPassword', ...args]);
      return results.signIn ?? { data: { user: { id: 'user-id' }, session: { access_token: 'token' } }, error: null };
    },
    async signOut(...args) {
      calls.push(['signOut', ...args]);
      return results.signOut ?? { error: null };
    },
    async resetPasswordForEmail(...args) {
      calls.push(['resetPasswordForEmail', ...args]);
      return results.reset ?? { error: null };
    },
    async updateUser(...args) {
      calls.push(['updateUser', ...args]);
      return results.updateUser ?? { data: { user: { id: 'user-id' } }, error: null };
    },
  };
  return { auth, calls, emit: (...args) => authCallback?.(...args) };
}

test('auth service restores sessions and returns an unsubscribe function', async () => {
  const session = { access_token: 'existing-token' };
  const double = createAuthDouble({ getSession: { data: { session }, error: null } });
  const service = createSupabaseAuthService({ auth: double.auth });
  const events = [];
  const unsubscribe = service.subscribe((event) => events.push(event));

  assert.equal(await service.getSession(), session);
  double.emit('SIGNED_IN', session);
  assert.deepEqual(events, [{ event: 'SIGNED_IN', session }]);
  unsubscribe();
  assert.deepEqual(double.calls.at(-1), ['unsubscribe']);
});

test('auth service delegates signup, login, reset, password update, and logout', async () => {
  const double = createAuthDouble();
  const service = createSupabaseAuthService({ auth: double.auth });

  const signup = await service.signUp({
    fullName: 'Sabi User',
    email: 'user@example.com',
    password: 'password-123',
  });
  assert.equal(signup.confirmationRequired, true);
  assert.deepEqual(double.calls.find((call) => call[0] === 'signUp')[1], {
    email: 'user@example.com',
    password: 'password-123',
    options: { data: { full_name: 'Sabi User' } },
  });
  assert.ok((await service.signIn('user@example.com', 'password-123')).session);
  await service.requestPasswordReset('user@example.com', 'https://app.example/reset');
  await service.updatePassword('new-password-123');
  await service.signOut();
  assert.deepEqual(double.calls.find((call) => call[0] === 'resetPasswordForEmail'), [
    'resetPasswordForEmail',
    'user@example.com',
    { redirectTo: 'https://app.example/reset' },
  ]);
  assert.deepEqual(double.calls.find((call) => call[0] === 'updateUser')[1], {
    password: 'new-password-123',
  });
});

test('auth service propagates provider errors', async () => {
  const error = new Error('invalid credentials');
  const service = createSupabaseAuthService({
    auth: createAuthDouble({ signIn: { data: null, error } }).auth,
  });
  await assert.rejects(service.signIn('user@example.com', 'wrong'), error);
});

test('auth service retrieves the provider-verified current user', async () => {
  const user = { id: 'verified-user' };
  const double = createAuthDouble({
    getUser: { data: { user }, error: null },
  });
  const service = createSupabaseAuthService({ auth: double.auth });

  assert.equal(await service.getUser(), user);
  assert.deepEqual(double.calls, [['getUser']]);
});

test('auth service propagates current-user lookup errors', async () => {
  const error = new Error('session is invalid');
  const service = createSupabaseAuthService({
    auth: createAuthDouble({ getUser: { data: null, error } }).auth,
  });

  await assert.rejects(service.getUser(), error);
});
