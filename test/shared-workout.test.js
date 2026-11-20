import test from 'node:test';
import assert from 'node:assert/strict';

import { createPeer } from '../src/buddies/rtc-peer.js';
import { createSharedWorkout } from '../src/buddies/shared-workout.js';

// ------------------------------------------------------------------ fakes
class FakePC {
  static last = null;
  constructor(config) {
    this.config = config;
    this.signalingState = 'stable';
    this.tracks = [];
    this.remote = null;
    this.localDescription = null;
    this.candidates = [];
    FakePC.last = this;
  }
  addTrack(track) { this.tracks.push(track); }
  async setLocalDescription() {
    this.localDescription = { type: this.remote?.type === 'offer' ? 'answer' : 'offer', sdp: 'local' };
    this.signalingState = this.localDescription.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(desc) {
    this.remote = desc;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate(c) { this.candidates.push(c); }
  getSenders() { return []; }
  close() { this.closed = true; }
}

function fakeTrack(kind) {
  return { kind, enabled: true, stopped: false, stop() { this.stopped = true; } };
}

function fakeStream() {
  const tracks = [fakeTrack('video'), fakeTrack('audio')];
  return {
    tracks,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  };
}

function fakeRealtime() {
  const handlers = new Map();
  const sent = [];
  const requests = [];
  return {
    sent,
    requests,
    replies: {},
    on(type, fn) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
    emit(type, data) { for (const fn of handlers.get(type) ?? []) fn(data); },
    send(type, data) { sent.push([type, data]); },
    async request(type, data) {
      requests.push([type, data]);
      const reply = this.replies[type];
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(data) : reply;
    },
  };
}

function fakeWorkout() {
  const calls = [];
  let status = 'idle';
  let personality = 'friendly';
  return {
    calls,
    setStatus(s) { status = s; },
    getState: () => ({ workoutStatus: status, personality, voiceEnabled: true }),
    selectExercise: (id) => calls.push(['select', id]),
    setGoal: (t) => calls.push(['goal', t]),
    start: async () => calls.push(['start']),
    end: async () => calls.push(['end']),
    goHome: () => calls.push(['home']),
    setPersonality: (p) => { personality = p; calls.push(['personality', p]); },
    setVoiceEnabled: (v) => calls.push(['voice', v]),
  };
}

const ME = 'a1';
const PARTNER = { id: 'b1', first_name: 'Bola', display_name: 'Bola Ade', username: 'bola' };
const SESSION = { id: 's1', status: 'accepted', can_join: true, exercise_id: 'push-ups', target: 20, partner: PARTNER };

function setup({ getUserMedia, session = SESSION } = {}) {
  const realtime = fakeRealtime();
  realtime.replies['room.join'] = (data) => ({
    session: { ...session, id: data.session_id },
    state: { session_id: data.session_id, phase: 'waiting', members: {
      [ME]: { connected: true, ready: false, progress: {} }, b1: { connected: false, progress: {} } } },
  });
  const workout = fakeWorkout();
  const timers = { setInterval: () => 1, clearInterval() {}, setTimeout: (fn) => fn, clearTimeout() {} };
  const stream = fakeStream();
  const shared = createSharedWorkout({
    realtime,
    buddiesApi: {
      session: async (id) => ({ session: { ...session, id } }),
      iceServers: async () => ({ ice_servers: [], relay: 'none' }),
      sessionSummary: async () => ({}),
    },
    getUser: () => ({ id: ME }),
    workout,
    mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) },
    createPeerImpl: () => ({ handleSignal: async () => {}, replaceTrack: async () => {}, close() {}, connectionState: 'new' }),
    view: null,
    timers,
  });
  return { shared, realtime, workout, stream };
}

// ------------------------------------------------------------------ peer
test('peer sends an offer on negotiation and answers incoming offers', async () => {
  const signals = [];
  const remote = [];
  const peer = createPeer({ polite: true, localStream: fakeStream(), signal: (s) => signals.push(s),
    onRemoteStream: (s) => remote.push(s), RTCPeerConnectionImpl: FakePC });
  const pc = FakePC.last;
  assert.equal(pc.tracks.length, 2);
  await pc.onnegotiationneeded();
  assert.equal(signals[0].description.type, 'offer');
  await peer.handleSignal({ description: { type: 'answer', sdp: 'x' } });
  assert.equal(pc.signalingState, 'stable');
  pc.ontrack({ streams: [{ id: 'remote' }] });
  assert.deepEqual(remote, [{ id: 'remote' }]);
});

test('impolite peer ignores a colliding offer; polite peer accepts it', async () => {
  for (const polite of [false, true]) {
    const signals = [];
    const peer = createPeer({ polite, signal: (s) => signals.push(s), RTCPeerConnectionImpl: FakePC });
    const pc = FakePC.last;
    pc.signalingState = 'have-local-offer'; // we are mid-offer
    await peer.handleSignal({ description: { type: 'offer', sdp: 'theirs' } });
    assert.equal(Boolean(pc.remote), polite);
  }
});

// ------------------------------------------------------------------ shared workout
test('entering a room sets up the exercise, quiets the coach, gets media and joins', async () => {
  const { shared, realtime, workout } = setup();
  await shared.enter('s1');
  const state = shared.getState();
  assert.equal(state.phase, 'waiting');
  assert.equal(state.media.status, 'ready');
  assert.deepEqual(workout.calls.slice(0, 3), [['select', 'push-ups'], ['goal', '20'], ['personality', 'quiet']]);
  assert.deepEqual(realtime.requests[0], ['room.join', { session_id: 's1' }]);
});

test('a denied microphone still lets you join with video only', async () => {
  let calls = 0;
  const stream = fakeStream();
  const { shared } = setup({
    getUserMedia: async ({ audio }) => {
      calls += 1;
      if (audio) {
        const error = new Error('denied');
        error.name = 'NotAllowedError';
        throw error;
      }
      return stream;
    },
  });
  await shared.enter('s1');
  const { media } = shared.getState();
  assert.equal(calls, 2);
  assert.equal(media.status, 'ready');
  assert.equal(media.micAvailable, false);
  assert.match(media.error, /can see you but not hear you/);
});

test('a denied camera explains why the camera is needed', async () => {
  const { shared } = setup({
    getUserMedia: async () => {
      const error = new Error('denied');
      error.name = 'NotAllowedError';
      throw error;
    },
  });
  await shared.enter('s1');
  assert.equal(shared.getState().media.status, 'denied');
  assert.match(shared.getState().media.error, /needs your camera to count your reps/);
});

test('a room that is not open yet shows a clear error instead of connecting', async () => {
  const { shared, realtime } = setup({ session: { ...SESSION, can_join: false, mode: 'scheduled' } });
  await shared.enter('s1');
  assert.equal(shared.getState().phase, 'error');
  assert.match(shared.getState().error, /opens 15 minutes before/);
  assert.equal(realtime.requests.length, 0);
});

test('ready, synchronized start and separate progress reporting', async () => {
  const { shared, realtime, workout } = setup();
  await shared.enter('s1');
  shared.setReady(true);
  assert.deepEqual(realtime.sent.at(-1), ['room.ready', { session_id: 's1', ready: true }]);

  realtime.emit('room.start', { session_id: 's1', starts_at: new Date(Date.now() - 10).toISOString() });
  assert.equal(shared.getState().phase, 'active');
  assert.deepEqual(workout.calls.at(-1), ['start']);

  shared.onLocalState({ workoutStatus: 'running', count: 3, elapsedMs: 0, target: 20 });
  assert.deepEqual(realtime.sent.at(-1), ['room.progress', { session_id: 's1', count: 3, elapsed_ms: 0, target: 20, status: 'running' }]);

  // The partner's numbers arrive separately and never change mine.
  realtime.emit('room.progress', { session_id: 's1', user_id: 'b1', progress: { count: 9, status: 'running' } });
  assert.equal(shared.getState().members.b1.progress.count, 9);
  assert.equal(shared.getState().members[ME].progress.count, 3);

  shared.onLocalState({ workoutStatus: 'completed', count: 20, elapsedMs: 0, target: 20 });
  assert.equal(shared.getState().myFinished, true);
  assert.equal(realtime.sent.at(-1)[1].status, 'finished');
});

test('rejoins the room after the socket reconnects', async () => {
  const { shared, realtime } = setup();
  await shared.enter('s1');
  realtime.emit('ready', {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(realtime.requests.filter(([type]) => type === 'room.join').length, 2);
});

test('leaving ends an unfinished workout, stops the camera and restores the coach', async () => {
  const { shared, realtime, workout, stream } = setup();
  await shared.enter('s1');
  workout.setStatus('running');
  await shared.leave({ navigateAway: false });
  assert.ok(workout.calls.some(([c]) => c === 'end'));
  assert.ok(realtime.sent.some(([type]) => type === 'room.leave'));
  assert.ok(stream.tracks.every((t) => t.stopped));
  assert.deepEqual(workout.calls.find(([c, v]) => c === 'personality' && v === 'friendly'), ['personality', 'friendly']);
  assert.equal(shared.isActive(), false);
});

test('a new round switches to the new session', async () => {
  const { shared, realtime, workout } = setup();
  await shared.enter('s1');
  realtime.emit('room.round', { session_id: 's1', new_session_id: 's2' });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(shared.sessionId(), 's2');
  assert.deepEqual(realtime.requests.at(-1), ['room.join', { session_id: 's2' }]);
  assert.ok(realtime.sent.some(([type, data]) => type === 'room.leave' && data.session_id === 's1'));
  assert.equal(workout.calls.filter(([c]) => c === 'select').length, 2);
});

test('camera "off" hides video from the partner but keeps tracking', async () => {
  const { shared, stream } = setup();
  await shared.enter('s1');
  shared.toggleCam();
  assert.equal(shared.getState().media.cam, false);
  assert.equal(stream.getVideoTracks()[0].stopped, false, 'tracking keeps the local camera running');
  shared.toggleMic();
  assert.equal(stream.getAudioTracks()[0].enabled, false);
});
