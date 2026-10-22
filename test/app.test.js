import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlankAnalyzer } from '../src/exercises/plank.js';
import { createWorkoutController } from '../src/ui/app.js';

function createHarness({
  startCamera: acquireCamera,
  startTracker = async () => {},
  createAnalyzers = () => ({
    squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
    'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
    plank: { reset() {}, update: () => ({ elapsedMs: 0, active: false, state: 'aligned' }) },
  }),
} = {}) {
  const video = { srcObject: null };
  const canvas = {};
  const states = [];
  const trackers = [];
  const tracks = [];
  let cameraStarts = 0;
  let cameraStops = 0;

  const controller = createWorkoutController({
    video,
    canvas,
    onState(state) {
      states.push({ ...state });
    },
    startCamera: async () => {
      cameraStarts += 1;
      if (acquireCamera) {
        return acquireCamera({ video, tracks });
      }
      const track = {
        listeners: new Map(),
        addEventListener(name, callback) {
          this.listeners.set(name, callback);
        },
        removeEventListener(name) {
          this.listeners.delete(name);
        },
        stop() {
          this.stopped = true;
        },
      };
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    },
    stopCamera(stream, videoElement) {
      cameraStops += 1;
      for (const track of stream?.getTracks?.() ?? []) {
        track.stop();
      }
      if (videoElement) {
        videoElement.srcObject = null;
      }
    },
    createPoseTracker(callbacks) {
      const tracker = {
        callbacks,
        startCalls: 0,
        pauseCalls: 0,
        resumeCalls: 0,
        stopCalls: 0,
        async start() {
          this.startCalls += 1;
          await startTracker(this);
        },
        pause() {
          this.pauseCalls += 1;
        },
        resume() {
          this.resumeCalls += 1;
        },
        stop() {
          this.stopCalls += 1;
        },
      };
      trackers.push(tracker);
      return tracker;
    },
    createAnalyzers,
    translateMessage: () => ({ text: 'Ready', isFallback: false }),
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
  });

  return {
    controller,
    video,
    states,
    trackers,
    tracks,
    get cameraStarts() {
      return cameraStarts;
    },
    get cameraStops() {
      return cameraStops;
    },
  };
}

test('repeated Start actions share one camera stream and tracker loop', async () => {
  let releaseStart;
  const harness = createHarness({
    startTracker: () => new Promise((resolve) => {
      releaseStart = resolve;
    }),
  });

  const firstStart = harness.controller.start();
  const secondStart = harness.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cameraStarts, 1);
  assert.equal(harness.trackers.length, 1);
  releaseStart();
  await Promise.all([firstStart, secondStart]);

  assert.equal(harness.trackers[0].startCalls, 1);
  assert.equal(harness.controller.getState().workoutStatus, 'running');
});

test('failed tracker startup releases the camera and leaves retry available', async () => {
  const harness = createHarness({
    startTracker: async () => {
      throw new Error('model could not load');
    },
  });

  await harness.controller.start();

  assert.equal(harness.controller.getState().workoutStatus, 'error');
  assert.match(harness.controller.getState().statusMessage, /model|try again/i);
  assert.equal(harness.cameraStops, 1);
  assert.equal(harness.tracks[0].stopped, true);
  assert.equal(harness.trackers[0].stopCalls, 1);
  assert.equal(harness.controller.getState().canStart, true);
});

test('an ended camera track pauses tracking and reports a next step', async () => {
  const harness = createHarness();
  await harness.controller.start();

  harness.tracks[0].listeners.get('ended')();

  assert.equal(harness.trackers[0].pauseCalls, 1);
  assert.equal(harness.controller.getState().workoutStatus, 'paused');
  assert.match(harness.controller.getState().statusMessage, /camera|reconnect|resume/i);
  assert.equal(harness.cameraStops, 1);
});

test('pause and resume reuse the current stream and tracker', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.controller.pause();
  await harness.controller.resume();

  assert.equal(harness.cameraStarts, 1);
  assert.equal(harness.trackers.length, 1);
  assert.equal(harness.trackers[0].pauseCalls, 1);
  assert.equal(harness.trackers[0].resumeCalls, 1);
  assert.equal(harness.controller.getState().workoutStatus, 'running');
});

test('Resume after a camera interruption creates a new stream and tracker', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.tracks[0].listeners.get('ended')();
  await harness.controller.resume();

  assert.equal(harness.cameraStarts, 2);
  assert.equal(harness.trackers.length, 2);
  assert.equal(harness.trackers[0].stopCalls, 1);
  assert.equal(harness.controller.getState().workoutStatus, 'running');
});

test('pausing a plank excludes the paused interval from elapsed time', async () => {
  const harness = createHarness({
    createAnalyzers: () => ({
      squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
      plank: createPlankAnalyzer(),
    }),
  });
  const landmarks = Array.from({ length: 33 }, () => ({}));
  for (const [index, x] of [[11, 0.2], [23, 0.4], [27, 0.6]]) {
    landmarks[index] = { x, y: 0.5, visibility: 0.95 };
  }
  harness.controller.selectExercise('plank');
  await harness.controller.start();
  const onPose = harness.trackers[0].callbacks.onPose;
  onPose(landmarks, 1000);
  onPose(landmarks, 1100);
  assert.equal(harness.controller.getState().elapsedMs, 100);

  harness.controller.pause();
  await harness.controller.resume();
  onPose(landmarks, 5000);
  onPose(landmarks, 5100);

  assert.equal(harness.controller.getState().elapsedMs, 200);
});

test('starting after End creates a new tracker instance', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.controller.end();
  await harness.controller.start();

  assert.equal(harness.trackers.length, 2);
  assert.equal(harness.trackers[0].stopCalls, 1);
  assert.equal(harness.cameraStarts, 2);
  assert.equal(harness.controller.getState().workoutStatus, 'running');
});

test('late camera acquisition after End cannot release the new session resources', async () => {
  const pendingAcquisitions = [];
  const harness = createHarness({
    startCamera: ({ video }) => new Promise((resolve) => {
      pendingAcquisitions.push((stream) => {
        video.srcObject = stream;
        resolve(stream);
      });
    }),
  });
  const makeStream = () => {
    const track = { stop() { this.stopped = true; } };
    return {
      track,
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
  };

  const oldStart = harness.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingAcquisitions.length, 1);
  await harness.controller.end();

  const currentStart = harness.controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingAcquisitions.length, 2);
  const currentStream = makeStream();
  pendingAcquisitions[1](currentStream);
  await currentStart;

  const staleStream = makeStream();
  pendingAcquisitions[0](staleStream);
  await oldStart;

  assert.equal(harness.video.srcObject, currentStream);
  assert.equal(currentStream.track.stopped, undefined);
  assert.equal(harness.trackers[1].stopCalls, 0);
  assert.equal(staleStream.track.stopped, true);
});

test('Home navigation ends an active workout and releases its camera', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.controller.goHome();

  assert.equal(harness.controller.getState().view, 'home');
  assert.equal(harness.controller.getState().workoutStatus, 'idle');
  assert.equal(harness.cameraStops, 1);
  assert.equal(harness.trackers[0].stopCalls, 1);
});
