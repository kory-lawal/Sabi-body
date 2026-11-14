import assert from 'node:assert/strict';
import test from 'node:test';

import { createVoicePlaybackManager } from '../src/feedback/voice-playback.js';
import { createBrowserAudioSample } from '../src/feedback/browser-audio-sample.js';

function createAudioHarness({ playAudio } = {}) {
  const created = [];
  const revoked = [];
  let nextUrl = 0;
  class FakeAudio {
    constructor() {
      this.paused = true;
      this.volume = 1;
      this.playbackRate = 1;
      this.preservesPitch = false;
      this.webkitPreservesPitch = false;
      this.mozPreservesPitch = false;
      this.pauseCount = 0;
      this.onended = null;
      this.onerror = null;
      created.push(this);
    }
    async play() {
      if (playAudio) {
        return playAudio(this);
      }
      this.paused = false;
    }
    pause() {
      this.paused = true;
      this.pauseCount += 1;
    }
  }
  return {
    created,
    revoked,
    audioFactory: () => new FakeAudio(),
    URLApi: {
      createObjectURL: () => `blob:audio-${++nextUrl}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
  };
}

test('playback waits for the audio element to end and preserves pitch at moderate rate', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);

  const pending = manager.play(new Blob(['sample']));
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].playbackRate, 0.92);
  assert.equal(harness.created[0].preservesPitch, true);
  assert.equal(harness.created[0].webkitPreservesPitch, true);
  assert.equal(harness.created[0].mozPreservesPitch, true);

  harness.created[0].onended();
  assert.equal(await pending, true);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('muting cancels current audio and prevents future playback', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  const pending = manager.play(new Blob(['first']));
  manager.setMuted(true);

  assert.equal(harness.created[0].paused, true);
  assert.equal(await pending, false);
  assert.equal(await manager.play(new Blob(['second'])), false);
  assert.equal(harness.created.length, 1);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('volume is clamped and reflected on the active and next audio elements', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  manager.setVolume(2);
  const pending = manager.play(new Blob(['first']));
  assert.equal(harness.created[0].volume, 1);

  manager.setVolume(0.35);
  assert.equal(harness.created[0].volume, 0.35);
  manager.stop();
  assert.equal(await pending, false);
});

test('playback reports completion only after the audio element ends', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  let completionCount = 0;

  const pending = manager.play(new Blob(['sample']), {
    onEnded() { completionCount += 1; },
  });
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(completionCount, 0);
  harness.created[0].onended();
  assert.equal(await pending, true);
  assert.equal(completionCount, 1);
});

test('stop settles pending playback as cancelled and revokes its object URL', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);

  const pendingPlayback = manager.play(new Blob(['pending']));
  manager.stop();

  assert.equal(await pendingPlayback, false);
  assert.equal(harness.created[0].paused, true);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('autoplay rejection reports a useful error and releases its audio URL', async () => {
  const errors = [];
  const blocked = new DOMException(
    'play() failed because the user did not interact with the document first.',
    'NotAllowedError',
  );
  const harness = createAudioHarness({ playAudio: async () => { throw blocked; } });
  const manager = createVoicePlaybackManager({ ...harness, onError: (error) => errors.push(error) });

  await assert.rejects(manager.play(new Blob(['sample'])), (error) => {
    assert.match(error.message, /interact with the page|browser audio permissions/i);
    assert.equal(error.cause, blocked);
    return true;
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /autoplay protection|browser audio permissions/i);
  assert.equal(errors[0].cause, blocked);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('audio element errors reject playback and release the object URL', async () => {
  const errors = [];
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager({
    ...harness,
    onError: (error) => errors.push(error),
  });
  const pending = manager.play(new Blob(['sample']));
  const event = { type: 'error' };
  harness.created[0].onerror(event);

  await assert.rejects(pending, /audio playback failed/i);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].cause, event);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('browser diagnostic sample is a valid non-empty local WAV tone', async () => {
  const sample = createBrowserAudioSample();
  const bytes = new DataView(await sample.arrayBuffer());

  assert.equal(sample.type, 'audio/wav');
  assert.ok(sample.size > 44);
  assert.equal(String.fromCharCode(...new Uint8Array(bytes.buffer, 0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...new Uint8Array(bytes.buffer, 8, 4)), 'WAVE');
});

test('explicit browser diagnostic can test playback while coaching is muted', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  manager.setMuted(true);

  const pending = manager.play(new Blob(['diagnostic']), { allowMuted: true });
  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].paused, false);
  harness.created[0].onended();
  assert.equal(await pending, true);
});