import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, createApiClient } from '../src/services/api-client.js';
import { createAuthService } from '../src/services/auth-service.js';
import { toWorkoutPayload } from '../src/services/account-data.js';
import { parseRoute, routeHref } from '../src/ui/router.js';
import { createAccountController } from '../src/ui/account/account-controller.js';
import { passwordRuleState, renderLogin, renderRegister } from '../src/ui/account/auth-pages.js';
import { renderDashboard, renderHistory } from '../src/ui/account/member-pages.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('API client keeps the access token in memory, refreshes once and retries', async () => {
  const calls = [];
  let refreshes = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization ?? null, credentials: init.credentials });
    if (url === '/api/auth/refresh') {
      refreshes += 1;
      return jsonResponse(200, { access_token: `fresh-${refreshes}`, user: { id: 'u1' } });
    }
    if (init.headers.Authorization === 'Bearer stale') {
      return jsonResponse(401, { detail: { code: 'token_expired', message: 'Your session has expired.' } });
    }
    return jsonResponse(200, { ok: true });
  };
  const api = createApiClient({ fetchImpl });
  api.setAccessToken('stale');
  const [first, second] = await Promise.all([
    api.get('/api/account/me', { auth: true }),
    api.get('/api/workouts', { auth: true }),
  ]);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.equal(refreshes, 1, 'concurrent 401s share a single refresh');
  assert.ok(calls.every((call) => call.credentials === 'include'));
  assert.ok(calls.filter((call) => call.url !== '/api/auth/refresh').slice(-2).every((call) => call.auth === 'Bearer fresh-1'));
  assert.equal(globalThis.localStorage?.getItem?.('access_token') ?? null, null);
});

test('API client retries a refresh conflict from another tab, then reports lost sessions', async () => {
  let attempts = 0;
  const api = createApiClient({
    wait: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse(409, { detail: { code: 'refresh_conflict', message: 'retry' } })
        : jsonResponse(200, { access_token: 'ok', user: {} });
    },
  });
  await api.refresh();
  assert.equal(attempts, 2);

  const lost = [];
  const denied = createApiClient({
    onSessionLost: (error) => lost.push(error.code),
    fetchImpl: async (url) => (url === '/api/auth/refresh'
      ? jsonResponse(401, { detail: { code: 'session_revoked', message: 'Please log in again.' } })
      : jsonResponse(401, { detail: { code: 'token_expired', message: 'expired' } })),
  });
  denied.setAccessToken('stale');
  await assert.rejects(denied.get('/api/account/me', { auth: true }), (error) => error instanceof ApiError && error.status === 401);
  assert.deepEqual(lost, ['session_revoked']);
});

test('API client turns network failures and validation errors into readable messages', async () => {
  const offline = createApiClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.get('/api/health'), /internet connection/);
  const invalid = createApiClient({
    fetchImpl: async () => jsonResponse(422, { detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address' }] }),
  });
  await assert.rejects(invalid.post('/api/auth/register', {}), /valid email address/);
});

test('auth service restores a session from the refresh cookie and logs out everywhere in the tab', async () => {
  const states = [];
  const api = createApiClient({
    fetchImpl: async (url) => {
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, { access_token: 'restored', user: { full_name: 'Ada Obi', email: 'ada@example.com' } });
      }
      return jsonResponse(200, { message: 'You have been logged out.' });
    },
  });
  const auth = createAuthService({ api, BroadcastChannelImpl: null });
  auth.subscribe((state) => states.push(state.status));
  assert.equal(auth.getState().status, 'checking');
  await auth.restore();
  assert.equal(auth.getState().status, 'authenticated');
  assert.equal(auth.getState().user.full_name, 'Ada Obi');
  await auth.logout();
  assert.equal(auth.getState().status, 'anonymous');
  assert.equal(api.hasAccessToken(), false);
  assert.deepEqual(states, ['authenticated', 'anonymous']);
});

test('auth service treats a missing refresh cookie as signed out', async () => {
  const api = createApiClient({
    fetchImpl: async () => jsonResponse(401, { detail: { code: 'no_session', message: 'Please log in.' } }),
  });
  const auth = createAuthService({ api, BroadcastChannelImpl: null });
  assert.equal(await auth.restore(), null);
  assert.equal(auth.getState().status, 'anonymous');
  assert.equal(auth.getState().error, '');
});

test('routes parse hash paths, query tokens and unknown pages', () => {
  assert.deepEqual(parseRoute(''), { name: 'home', params: {} });
  assert.deepEqual(parseRoute('#/dashboard'), { name: 'dashboard', params: {} });
  assert.deepEqual(parseRoute('#/reset-password?token=abc'), { name: 'reset-password', params: { token: 'abc' } });
  assert.equal(parseRoute('#/not-a-page').name, 'home');
  assert.equal(routeHref('login', { next: 'history' }), '#/login?next=history');
  assert.equal(routeHref('home'), '#/');
});

test('workout payload maps attempts to the API contract', () => {
  assert.deepEqual(toWorkoutPayload({
    clientSessionId: 'abc12345',
    exerciseId: 'plank',
    completed: true,
    completedReps: null,
    targetReps: null,
    targetDurationSeconds: 30,
    durationSeconds: 31,
    startedAt: '2026-11-20T08:00:00.000Z',
    completedAt: '2026-11-20T08:01:00.000Z',
  }), {
    idempotency_key: 'abc12345',
    exercise_id: 'plank',
    completed: true,
    completed_reps: null,
    target_reps: null,
    target_duration_seconds: 30,
    duration_seconds: 31,
    started_at: '2026-11-20T08:00:00.000Z',
    completed_at: '2026-11-20T08:01:00.000Z',
  });
});

function fakeView(hash) {
  const listeners = new Map();
  const view = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        hash = value.startsWith('#') ? value : `#${value}`;
        listeners.get('hashchange')?.();
      },
    },
    history: {
      state: null,
      replaceState(_state, _title, href) {
        hash = href;
      },
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    scrollTo() {},
  };
  return view;
}

function fakeAuth(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    api: { get: async () => ({ email_provider: 'console' }) },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async restore() {},
    set(next) {
      state = next;
      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}

test('protected pages redirect signed-out visitors to login and signed-in users skip login', async () => {
  const view = fakeView('#/dashboard');
  const auth = fakeAuth({ status: 'checking', user: null });
  const summaries = [];
  const controller = createAccountController({
    authService: auth,
    accountData: { summary: async () => { summaries.push(1); return null; } },
    view,
  });
  controller.start();
  assert.equal(view.location.hash, '#/dashboard', 'waits while the session is being restored');
  auth.set({ status: 'anonymous', user: null });
  assert.equal(view.location.hash, '#/login?next=dashboard');
  assert.equal(summaries.length, 0, 'no private data is requested while signed out');

  auth.set({ status: 'authenticated', user: { full_name: 'Ada Obi', is_admin: false } });
  assert.equal(view.location.hash, '#/dashboard');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(summaries.length, 1);
});

test('guest completions invite sign-up instead of saving; signed-in completions are saved', async () => {
  const saved = [];
  const auth = fakeAuth({ status: 'anonymous', user: null });
  const controller = createAccountController({
    authService: auth,
    accountData: { saveWorkout: async (attempt) => { saved.push(attempt); return { duplicate: false }; } },
    view: fakeView('#/'),
  });
  await controller.saveWorkoutAttempt({ completed: true });
  assert.equal(controller.saveState().status, 'guest');
  assert.equal(saved.length, 0);
  auth.set({ status: 'authenticated', user: { full_name: 'Ada' } });
  await controller.saveWorkoutAttempt({ completed: true, clientSessionId: 'k1' });
  assert.equal(controller.saveState().status, 'saved');
  assert.equal(saved.length, 1);
});

test('auth pages expose show/hide password, requirements and links', () => {
  const login = renderLogin({});
  assert.match(login, /data-acct-action="toggle-password"/);
  assert.match(login, /href="#\/forgot-password"/);
  assert.match(login, /href="#\/register"/);
  assert.match(login, /name="remember"[^>]*checked/);
  const register = renderRegister({});
  for (const name of ['fullName', 'email', 'password', 'confirmPassword']) {
    assert.match(register, new RegExp(`name="${name}"`));
  }
  assert.match(register, /At least 10 characters/);
  assert.deepEqual(passwordRuleState('abc').map((rule) => rule.met), [false, true, false]);
  assert.ok(passwordRuleState('longer-pass-1').every((rule) => rule.met));
});

test('dashboard renders real totals, the weekly chart and an empty state', () => {
  const summary = {
    total_workouts: 3, total_attempts: 4, total_reps: 42, total_duration_seconds: 600, average_duration_seconds: 150,
    workouts_this_week: 2, completion_rate: 0.75, streak_days: 2,
    by_exercise: [{ exercise_id: 'squats', exercise_name: 'Squats', workouts: 3 }],
    week: { offset: 0, start: '2026-11-16', end: '2026-11-22', workouts: 2, previous_week_workouts: 1,
      days: Array.from({ length: 7 }, (_, index) => ({ date: `2026-11-${16 + index}`, workouts: index === 3 ? 2 : 0, reps: 20, seconds: 100 })) },
    recent: [{ exercise_name: 'Squats', exercise_type: 'reps', completed_reps: 10, target_reps: 10, duration_seconds: 60, completed: true, started_at: '2026-11-19T10:00:00Z' }],
  };
  const html = renderDashboard({ user: { full_name: 'Ada Obi' }, summary });
  assert.match(html, /Welcome back, Ada!/);
  assert.match(html, />42</);
  assert.match(html, /75%/);
  assert.match(html, /1 more workout than the week before/);
  assert.match(html, /href="#\/history"/);
  const empty = renderDashboard({ user: { full_name: 'Ada' }, summary: { ...summary, total_attempts: 0 } });
  assert.match(empty, /Your first workout starts here/);
  const history = renderHistory({ items: [], total: 0, filters: { status: 'completed' } });
  assert.match(history, /No workouts match these filters/);
});
