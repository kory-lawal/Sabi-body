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
      this.pauseCount = 0;
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

test('voice playback replaces lower-priority audio and never overlaps', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);

  assert.equal(await manager.play(new Blob(['first']), { priority: 10 }), true);
  assert.equal(await manager.play(new Blob(['milestone']), { priority: 5 }), false);
  assert.equal(await manager.play(new Blob(['completion']), { priority: 100 }), true);

  assert.equal(harness.created.length, 2);
  assert.equal(harness.created[0].pauseCount, 1);
  assert.equal(harness.created[1].paused, false);
});

test('muting stops current audio and prevents future playback', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  await manager.play(new Blob(['first']));
  manager.setMuted(true);

  assert.equal(harness.created[0].paused, true);
  assert.equal(await manager.play(new Blob(['second'])), false);
  assert.equal(harness.created.length, 1);
  assert.deepEqual(harness.revoked, ['blob:audio-1']);
});

test('volume is clamped and reflected on the active and next audio elements', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  manager.setVolume(2);
  await manager.play(new Blob(['first']));
  assert.equal(harness.created[0].volume, 1);

  manager.setVolume(0.35);
  assert.equal(harness.created[0].volume, 0.35);
});

test('playback reports completion only after the audio element ends', async () => {
  const harness = createAudioHarness();
  const manager = createVoicePlaybackManager(harness);
  let completionCount = 0;

  assert.equal(await manager.play(new Blob(['sample']), {
    onEnded() { completionCount += 1; },
  }), true);
  assert.equal(completionCount, 0);
  harness.created[0].onended();
  assert.equal(completionCount, 1);
});

test('identical semantic events are suppressed during the cooldown', async () => {
  const harness = createAudioHarness();
  let timestamp = 1000;
  const manager = createVoicePlaybackManager({
    ...harness,
    now: () => timestamp,
    cooldownMs: 5000,
  });

  assert.equal(await manager.play(new Blob(['cue']), { eventKey: 'camera-positioning' }), true);
  harness.created[0].onended();
  timestamp += 4999;
  assert.equal(await manager.play(new Blob(['duplicate']), { eventKey: 'camera-positioning' }), false);
  timestamp += 1;
  assert.equal(await manager.play(new Blob(['next cue']), { eventKey: 'camera-positioning' }), true);
  assert.equal(harness.created.length, 2);
});

test('identical semantic events are suppressed while browser playback is pending', async () => {
  const resolvePlays = [];
  const harness = createAudioHarness({
    playAudio: (audio) => new Promise((resolve) => {
      resolvePlays.push(() => {
        audio.paused = false;
        resolve();
      });
    }),
  });
  const manager = createVoicePlaybackManager(harness);

  const firstPlayback = manager.play(new Blob(['first']), { eventKey: 'same-event' });
  const duplicatePlayback = manager.play(new Blob(['duplicate']), { eventKey: 'same-event' });
  for (const resolvePlay of resolvePlays) {
    resolvePlay();
  }

  const [firstResult, duplicateResult] = await Promise.all([firstPlayback, duplicatePlayback]);
  assert.equal(firstResult, true);
  assert.equal(duplicateResult, false);
  assert.equal(harness.created.length, 1);
});

test('pending high-priority completion blocks lower-priority coaching', async () => {
  const resolvePlays = [];
  const harness = createAudioHarness({
    playAudio: (audio) => new Promise((resolve) => {
      resolvePlays.push(() => {
        audio.paused = false;
        resolve();
      });
    }),
  });
  const manager = createVoicePlaybackManager(harness);

  const completionPlayback = manager.play(new Blob(['completion']), { priority: 100 });
  const lowerPriorityPlayback = manager.play(new Blob(['encouragement']), { priority: 50 });
  for (const resolvePlay of resolvePlays) {
    resolvePlay();
  }

  const [completionResult, lowerPriorityResult] = await Promise.all([
    completionPlayback,
    lowerPriorityPlayback,
  ]);
  assert.equal(lowerPriorityResult, false);
  assert.equal(completionResult, true);
  assert.equal(harness.created.length, 1);
});

test('stop cancels a pending browser play without reporting stale success', async () => {
  let resolvePlay;
  const harness = createAudioHarness({
    playAudio: (audio) => new Promise((resolve) => {
      resolvePlay = () => {
        audio.paused = false;
        resolve();
      };
    }),
  });
  const manager = createVoicePlaybackManager(harness);

  const pendingPlayback = manager.play(new Blob(['pending']));
  manager.stop();
  resolvePlay();

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
    assert.match(error.message, /interact with the page|Test Voice/i);
    assert.equal(error.cause, blocked);
    return true;
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /autoplay protection|Test Voice/i);
  assert.equal(errors[0].cause, blocked);
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

  assert.equal(await manager.play(new Blob(['diagnostic']), { allowMuted: true }), true);
  assert.equal(harness.created.length, 1);
  assert.equal(harness.created[0].paused, false);
});