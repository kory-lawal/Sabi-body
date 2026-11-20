import test from 'node:test';
import assert from 'node:assert/strict';

import { createRealtimeClient, realtimeUrl } from '../src/buddies/realtime-client.js';

class FakeSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function fakeTimers() {
  const queue = [];
  return {
    queue,
    setTimeout(fn, ms) { const t = { fn, ms }; queue.push(t); return t; },
    clearTimeout(t) { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); },
    setInterval() { return {}; },
    clearInterval() {},
    runNext() { const t = queue.shift(); t?.fn(); return t; },
  };
}

test('production uses Render directly; localhost goes through the Vite proxy', () => {
  assert.equal(realtimeUrl({ hostname: 'www.sabibody.fit', host: 'www.sabibody.fit', protocol: 'https:' }),
    'wss://sabi-body-1.onrender.com/api/ws');
  assert.equal(realtimeUrl({ hostname: 'localhost', host: 'localhost:5176', protocol: 'http:' }),
    'ws://localhost:5176/api/ws');
  assert.equal(realtimeUrl({ hostname: 'x' }, { VITE_WS_URL: 'wss://custom/api/ws' }), 'wss://custom/api/ws');
});

test('authenticates in the first message, never in the URL, then emits ready', () => {
  FakeSocket.instances = [];
  const client = createRealtimeClient({ url: 'ws://h/api/ws', getToken: () => 'tok-1', WebSocketImpl: FakeSocket,
    timers: fakeTimers(), view: null });
  const seen = [];
  client.on('ready', (data) => seen.push(data));
  client.connect();
  const ws = FakeSocket.instances[0];
  assert.doesNotMatch(ws.url, /tok-1/);
  ws.open();
  assert.deepEqual(ws.sent[0], { type: 'auth', data: { token: 'tok-1' } });
  ws.receive({ type: 'ready', data: { unread: 2 } });
  assert.equal(client.status(), 'open');
  assert.deepEqual(seen, [{ unread: 2 }]);
});

test('requests resolve from acks and queue while reconnecting', async () => {
  FakeSocket.instances = [];
  const timers = fakeTimers();
  const client = createRealtimeClient({ url: 'u', getToken: () => 't', WebSocketImpl: FakeSocket, timers, view: null,
    random: () => 0 });
  client.connect();
  let ws = FakeSocket.instances[0];
  ws.open();
  ws.receive({ type: 'ready', data: {} });
  const answer = client.request('chat.send', { body: 'hi' });
  const sent = ws.sent.at(-1);
  ws.receive({ type: 'ack', ref: sent.id, ok: true, data: { id: 'm1' } });
  assert.deepEqual(await answer, { id: 'm1' });

  ws.close(1006); // network drop → reconnect scheduled
  assert.equal(client.status(), 'reconnecting');
  client.send('room.progress', { count: 3 });
  timers.runNext();
  ws = FakeSocket.instances[1];
  ws.open();
  ws.receive({ type: 'ready', data: {} });
  assert.deepEqual(ws.sent.at(-1), { type: 'room.progress', data: { count: 3 } }, 'queued message is flushed');
});

test('a 4401 close refreshes the token before reconnecting; failed acks reject', async () => {
  FakeSocket.instances = [];
  const timers = fakeTimers();
  let token = 'old';
  const client = createRealtimeClient({ url: 'u', getToken: () => token, WebSocketImpl: FakeSocket, timers, view: null,
    refreshToken: async () => { token = 'new'; return token; } });
  client.connect();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.receive({ type: 'ready', data: {} });
  const failing = client.request('x');
  ws.receive({ type: 'ack', ref: ws.sent.at(-1).id, ok: false, error: { code: 'not_friends', message: 'Nope' } });
  await assert.rejects(failing, /Nope/);

  ws.close(4401);
  await new Promise((r) => setTimeout(r, 0));
  timers.runNext();
  const next = FakeSocket.instances[1];
  next.open();
  assert.deepEqual(next.sent[0], { type: 'auth', data: { token: 'new' } });
});

test('server expiry warning triggers auth.refresh with the new token', async () => {
  FakeSocket.instances = [];
  let token = 'a';
  const client = createRealtimeClient({ url: 'u', getToken: () => token, WebSocketImpl: FakeSocket,
    timers: fakeTimers(), view: null, refreshToken: async () => { token = 'b'; return 'b'; } });
  client.connect();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.receive({ type: 'ready', data: {} });
  ws.receive({ type: 'auth.expiring', data: {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ws.sent.at(-1), { type: 'auth.refresh', data: { token: 'b' } });
  client.disconnect();
  assert.equal(client.status(), 'idle');
});

test('a close before "ready" with no code (proxy dropped 4401) refreshes the token and retries', async () => {
  FakeSocket.instances = [];
  const timers = fakeTimers();
  let token = 'stale';
  let refreshed = 0;
  const client = createRealtimeClient({ url: 'u', getToken: () => token, WebSocketImpl: FakeSocket, timers, view: null,
    refreshToken: async () => { refreshed += 1; token = 'fresh'; return token; } });
  client.connect();
  const ws = FakeSocket.instances[0];
  ws.open();
  ws.close(1006);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(refreshed, 1);
  assert.notEqual(client.status(), 'signed-out');
  timers.runNext();
  const next = FakeSocket.instances[1];
  next.open();
  assert.deepEqual(next.sent[0], { type: 'auth', data: { token: 'fresh' } });
  client.disconnect();
});
