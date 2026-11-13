import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlankAnalyzer } from '../src/exercises/plank.js';
import { translateMessage } from '../src/feedback/messages.js';
import { createWorkoutController, mountApp, voiceOptions } from '../src/ui/app.js';
import { EXERCISES } from '../src/ui/exercise-content.js';
import viteConfig from '../vite.config.js';

function createReadyLandmarks(exerciseId) {
  const landmarks = Array.from({ length: 33 }, () => null);
  const point = (x, y) => ({ x, y, visibility: 0.9, presence: 0.9 });
  if (exerciseId === 'jumping-jacks') {
    Object.assign(landmarks, {
      0: point(0.5, 0.18),
      11: point(0.4, 0.3),
      12: point(0.6, 0.3),
      13: point(0.42, 0.42),
      14: point(0.58, 0.42),
      15: point(0.42, 0.5),
      16: point(0.58, 0.5),
      23: point(0.4, 0.5),
      24: point(0.6, 0.5),
      25: point(0.45, 0.65),
      26: point(0.55, 0.65),
      27: point(0.47, 0.82),
      28: point(0.53, 0.82),
    });
    return landmarks;
  }
  if (exerciseId === 'plank') {
    Object.assign(landmarks, {
      0: point(0.17, 0.55),
      11: point(0.32, 0.55),
      12: point(0.35, 0.55),
      13: point(0.3, 0.6),
      14: point(0.33, 0.6),
      15: point(0.28, 0.65),
      16: point(0.31, 0.65),
      23: point(0.53, 0.55),
      24: point(0.56, 0.55),
      25: point(0.65, 0.55),
      26: point(0.68, 0.55),
      27: point(0.82, 0.55),
      28: point(0.85, 0.55),
    });
    return landmarks;
  }
  if (exerciseId === 'push-ups') {
    Object.assign(landmarks, {
      0: point(0.18, 0.5),
      11: point(0.25, 0.5),
      12: point(0.26, 0.5),
      13: point(0.35, 0.5),
      14: point(0.36, 0.5),
      15: point(0.45, 0.5),
      16: point(0.46, 0.5),
      23: point(0.55, 0.5),
      24: point(0.56, 0.5),
      27: point(0.85, 0.5),
      28: point(0.86, 0.5),
    });
    return landmarks;
  }
  if (exerciseId === 'sit-ups') {
    Object.assign(landmarks, {
      0: point(0.18, 0.5),
      11: point(0.25, 0.5),
      12: point(0.26, 0.5),
      23: point(0.55, 0.5),
      24: point(0.56, 0.5),
      25: point(0.75, 0.52),
      26: point(0.76, 0.52),
    });
    return landmarks;
  }
  if (exerciseId === 'lunges') {
    Object.assign(landmarks, {
      0: point(0.47, 0.18),
      11: point(0.43, 0.25),
      12: point(0.51, 0.25),
      23: point(0.43, 0.5),
      24: point(0.51, 0.5),
      25: point(0.43, 0.65),
      26: point(0.51, 0.65),
      27: point(0.43, 0.84),
      28: point(0.51, 0.84),
    });
    return landmarks;
  }
  Object.assign(landmarks, {
    0: point(0.5, 0.2),
    11: point(0.49, 0.32),
    12: point(0.51, 0.32),
    23: point(0.49, 0.5),
    24: point(0.51, 0.5),
    25: point(0.49, 0.65),
    26: point(0.51, 0.65),
    27: point(0.49, 0.84),
    28: point(0.51, 0.84),
  });
  return landmarks;
}

function createMovementLandmarks(exerciseId) {
  const landmarks = createReadyLandmarks(exerciseId);
  const move = (index, x, y) => {
    landmarks[index] = { ...landmarks[index], x, y };
  };

  if (exerciseId === 'squats') {
    move(27, 0.7, 0.65);
  } else if (exerciseId === 'jumping-jacks') {
    move(13, 0.42, 0.32);
    move(14, 0.58, 0.32);
    move(15, 0.4, 0.1);
    move(16, 0.6, 0.1);
    move(27, 0.3, 0.82);
    move(28, 0.7, 0.82);
  } else if (exerciseId === 'plank') {
    move(23, 0.53, 0.72);
    move(24, 0.56, 0.72);
  } else if (exerciseId === 'push-ups') {
    move(15, 0.35, 0.6);
  } else if (exerciseId === 'sit-ups') {
    move(11, 0.5, 0.2);
    move(12, 0.51, 0.2);
  } else if (exerciseId === 'lunges') {
    move(27, 0.62, 0.65);
  }

  return landmarks;
}

function emitReadyFrames(onPose, exerciseId, timestamp = 0) {
  const landmarks = createReadyLandmarks(exerciseId);
  for (let frame = 0; frame < 3; frame += 1) {
    onPose(landmarks, timestamp + frame * 33);
  }
}

function createHarness({
  startCamera: acquireCamera,
  startTracker,
  autoReadiness = true,
  diagnosticsEnabled,
  createAnalyzers = () => ({
    squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
    'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
    plank: { reset() {}, update: () => ({ elapsedMs: 0, active: false, state: 'aligned' }) },
    'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
    'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
    lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
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
          await startTracker?.(this);
          if (autoReadiness) {
            emitReadyFrames(
              this.callbacks.onPose,
              controller.getState().selectedExercise,
            );
          }
        },
        pause() {
          this.pauseCalls += 1;
        },
        resume() {
          this.resumeCalls += 1;
          if (autoReadiness) {
            emitReadyFrames(
              this.callbacks.onPose,
              controller.getState().selectedExercise,
              globalThis.performance?.now?.() ?? Date.now(),
            );
          }
        },
        stop() {
          this.stopCalls += 1;
        },
      };
      trackers.push(tracker);
      return tracker;
    },
    createAnalyzers,
    ...(diagnosticsEnabled === undefined ? {} : { diagnosticsEnabled }),
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

test('controller publishes landmark diagnostics when enabled', async () => {
  const harness = createHarness({
    autoReadiness: false,
    diagnosticsEnabled: true,
  });
  await harness.controller.start();

  emitReadyFrames(
    harness.trackers[0].callbacks.onPose,
    'squats',
  );

  assert.deepEqual(harness.controller.getState().diagnosticLandmarks[11], {
    index: 11,
    x: 0.49,
    y: 0.32,
    visibility: 0.9,
    presence: 0.9,
    confidence: 0.9,
    visible: true,
  });
});

test('controller does not publish landmark diagnostics by default', async () => {
  const harness = createHarness({ autoReadiness: false });
  await harness.controller.start();

  emitReadyFrames(
    harness.trackers[0].callbacks.onPose,
    'squats',
  );

  assert.deepEqual(harness.controller.getState().diagnosticLandmarks, []);
});

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

test('workout starts analyzing when tracker startup completes without a ready pose', async () => {
  let analyzerCalls = 0;
  let observedLandmarks;
  let observedWorldLandmarks;
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: {
        reset() {},
        invalidatePhase() {},
        update(landmarks, _timestamp, worldLandmarks) {
          analyzerCalls += 1;
          observedLandmarks = landmarks;
          observedWorldLandmarks = worldLandmarks;
          return { count: 0, state: 'standing' };
        },
      },
    }),
  });

  await harness.controller.start();
  assert.equal(harness.controller.getState().workoutStatus, 'running');
  const landmarks = [];
  const worldLandmarks = [{ x: 0.1, y: 0.2, z: 0.3 }];
  harness.trackers[0].callbacks.onPose(landmarks, 33, worldLandmarks);
  assert.equal(analyzerCalls, 1);
  assert.equal(observedLandmarks, landmarks);
  assert.equal(observedWorldLandmarks, worldLandmarks);
});

test('goal completion follows analyzer count without form-valid gating', async () => {
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: {
        reset() {},
        invalidatePhase() {},
        update() {
          return { count: 1, formValid: false, state: 'standing' };
        },
      },
    }),
  });
  harness.controller.setGoal(1);
  await harness.controller.start();
  harness.trackers[0].callbacks.onPose(createReadyLandmarks('squats'), 33);
  assert.equal(harness.controller.getState().workoutStatus, 'completed');
  assert.equal(harness.controller.getState().completedWorkouts.length, 1);
});

test('running frames reach the selected analyzers directly', async () => {
  const exerciseIds = [
    'squats',
    'jumping-jacks',
    'plank',
    'push-ups',
    'sit-ups',
    'lunges',
  ];

  for (const exerciseId of exerciseIds) {
    const observed = Object.fromEntries(exerciseIds.map((id) => [id, []]));
    const harness = createHarness({
      createAnalyzers: () =>
        Object.fromEntries(
          exerciseIds.map((id) => [
            id,
            {
              reset() {},
              update(landmarks) {
                observed[id].push(landmarks);
                return id === 'plank'
                  ? { elapsedMs: 1000, active: false, formValid: false, state: 'paused' }
                  : { count: 1, formValid: true, state: 'moving' };
              },
            },
          ]),
        ),
    });

    harness.controller.selectExercise(exerciseId);
    await harness.controller.start();
    const onPose = harness.trackers[0].callbacks.onPose;
    const movementLandmarks = createMovementLandmarks(exerciseId);
    const previousCalls = observed[exerciseId].length;

    onPose(movementLandmarks, 1000);

    assert.equal(
      observed[exerciseId].length,
      previousCalls + 1,
      `${exerciseId} analyzer should receive the movement frame`,
    );
    assert.equal(observed[exerciseId].at(-1), movementLandmarks);
    if (exerciseId === 'plank') {
      assert.equal(harness.controller.getState().elapsedMs, 1000);
      assert.equal(harness.controller.getState().formValid, false);
      assert.equal(
        harness.controller.getState().diagnosticMetrics.exercise.timerState,
        'paused',
      );
    } else {
      assert.equal(harness.controller.getState().count, 1);
    }

    await harness.controller.end();
  }
});

test('all six exercises record a capped goal result and stop tracking once', async () => {
  const exerciseIds = [
    'squats',
    'jumping-jacks',
    'plank',
    'push-ups',
    'sit-ups',
    'lunges',
  ];
  for (const exerciseId of exerciseIds) {
    const harness = createHarness({
      createAnalyzers: () => Object.fromEntries(
        exerciseIds.map((id) => [
          id,
          {
            reset() {},
            invalidatePhase() {},
            update: () => id === 'plank'
              ? { elapsedMs: 2500, active: true, formValid: true, state: 'aligned' }
              : { count: 3, formValid: true, state: 'complete' },
          },
        ]),
      ),
    });
    harness.controller.selectExercise(exerciseId);
    harness.controller.setGoal(1);
    await harness.controller.start();

    harness.trackers[0].callbacks.onPose(
      createReadyLandmarks(exerciseId),
      1000,
    );
    const completed = harness.controller.getState();
    assert.equal(completed.workoutStatus, 'completed', `${exerciseId} should complete`);
    assert.equal(completed.completedWorkouts.length, 1);
    assert.deepEqual(
      {
        exerciseId: completed.completedWorkouts[0].exerciseId,
        exerciseName: completed.completedWorkouts[0].exerciseName,
        target: completed.completedWorkouts[0].target,
        unit: completed.completedWorkouts[0].unit,
        achieved: completed.completedWorkouts[0].achieved,
      },
      {
        exerciseId,
        exerciseName: completed.exercise.name,
        target: 1,
        unit: exerciseId === 'plank' ? 'seconds' : 'reps',
        achieved: 1,
      },
    );
    assert.equal(Number.isFinite(completed.completedWorkouts[0].completedAt), true);
    assert.equal(
      exerciseId === 'plank' ? completed.elapsedMs : completed.count,
      exerciseId === 'plank' ? 1000 : 1,
    );
    assert.equal(harness.cameraStops, 1);
    assert.equal(harness.trackers[0].stopCalls, 1);

    for (let frame = 0; frame < 5; frame += 1) {
      harness.trackers[0].callbacks.onPose(
        createReadyLandmarks(exerciseId),
        200 + frame * 33,
      );
    }
    const afterStaleFrames = harness.controller.getState();
    assert.equal(afterStaleFrames.completedWorkouts.length, 1);
    assert.equal(afterStaleFrames.count, completed.count);
    assert.equal(afterStaleFrames.elapsedMs, completed.elapsedMs);
    const completionFeedback = exerciseId === 'plank'
      ? 'plank-completed'
      : 'exercise-completed';
    assert.equal(
      harness.states.filter(({ feedbackId }) => feedbackId === completionFeedback).length,
      1,
    );
  }
});

test('plank goal completion follows elapsed time without form-valid gating', async () => {
  let elapsedMs = 999;
  let formValid = true;
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: { reset() {}, update: () => ({ count: 0 }) },
      'jumping-jacks': { reset() {}, update: () => ({ count: 0 }) },
      plank: {
        reset() {},
        invalidatePhase() {},
        update: () => ({ elapsedMs, active: formValid, formValid, state: 'aligned' }),
      },
      'push-ups': { reset() {}, update: () => ({ count: 0 }) },
      'sit-ups': { reset() {}, update: () => ({ count: 0 }) },
      lunges: { reset() {}, update: () => ({ count: 0 }) },
    }),
  });
  harness.controller.selectExercise('plank');
  harness.controller.setGoal(1);
  await harness.controller.start();
  const onPose = harness.trackers[0].callbacks.onPose;
  const readyPose = createReadyLandmarks('plank');
  emitReadyFrames(onPose, 'plank', 1000);
  assert.equal(harness.controller.getState().workoutStatus, 'running');
  assert.equal(harness.controller.getState().elapsedMs, 999);
  assert.equal(harness.controller.getState().completedWorkouts.length, 0);

  elapsedMs = 1000;
  formValid = false;
  onPose(readyPose, 1200);
  assert.equal(harness.controller.getState().workoutStatus, 'completed');
  assert.equal(harness.controller.getState().completedWorkouts[0].achieved, 1);
  assert.equal(harness.controller.getState().elapsedMs, 1000);
});

test('manual End does not record a successful workout', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.controller.end();

  assert.equal(harness.controller.getState().workoutStatus, 'idle');
  assert.deepEqual(harness.controller.getState().completedWorkouts, []);
});

test('plank tracking loss preserves earned time in the controller', async () => {
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: { reset() {}, invalidatePhase() {}, update: () => ({ count: 0 }) },
      'jumping-jacks': { reset() {}, invalidatePhase() {}, update: () => ({ count: 0 }) },
      plank: createPlankAnalyzer(),
    }),
  });
  harness.controller.selectExercise('plank');
  await harness.controller.start();
  const onPose = harness.trackers[0].callbacks.onPose;
  const readyPose = createReadyLandmarks('plank');
  emitReadyFrames(onPose, 'plank', 1000);
  onPose(readyPose, 1099);
  onPose(readyPose, 1132);
  onPose(readyPose, 1165);
  onPose(readyPose, 1400);
  onPose(readyPose, 1433);
  const earnedTime = harness.controller.getState().elapsedMs;
  assert.ok(earnedTime > 0);

  onPose([], 1466);
  assert.equal(harness.controller.getState().elapsedMs, earnedTime);
  assert.equal(harness.controller.getState().formValid, false);
});

test('controller resolves mounted video and canvas before requesting camera access', async () => {
  const mountedVideo = { id: 'workout-video' };
  const mountedCanvas = { id: 'pose-overlay' };
  let cameraVideo;
  let trackerElements;
  const controller = createWorkoutController({
    getMediaElements: () => ({ video: mountedVideo, canvas: mountedCanvas }),
    startCamera: async (video) => {
      cameraVideo = video;
      return { getTracks: () => [], getVideoTracks: () => [] };
    },
    stopCamera() {},
    createPoseTracker: () => ({
      async start(video, canvas) { trackerElements = { video, canvas }; },
      stop() {},
    }),
  });

  await controller.start();

  assert.equal(cameraVideo, mountedVideo);
  assert.deepEqual(trackerElements, { video: mountedVideo, canvas: mountedCanvas });
});

test('coach personality defaults to Friendly Coach and persists across controllers', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const first = createWorkoutController({ storage });

  assert.equal(first.getState().personality, 'friendly');
  first.setPersonality('energetic');
  assert.equal(first.getState().personality, 'energetic');

  const second = createWorkoutController({ storage });
  assert.equal(second.getState().personality, 'energetic');
});

test('language and voice preferences persist without enabling voice by default', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const first = createWorkoutController({ storage });
  assert.equal(first.getState().voiceEnabled, false);
  first.setLanguage('ig');
  first.setVoiceEnabled(true);
  first.setVoiceVolume(0.45);
  first.setVoiceId('igbo-voice');
  first.setCountEachRep(true);

  const second = createWorkoutController({ storage });
  assert.equal(second.getState().language, 'ig');
  assert.equal(second.getState().voiceEnabled, true);
  assert.equal(second.getState().voiceVolume, 0.45);
  assert.equal(second.getState().voiceId, 'igbo-voice');
  assert.equal(second.getState().countEachRep, true);
});

test('coach personality remains active and reports a blocked storage write', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('storage unavailable'); },
  };
  const controller = createWorkoutController({ storage });

  controller.setPersonality('quiet');

  assert.equal(controller.getState().personality, 'quiet');
  assert.match(controller.getState().personalityStorageWarning, /session|storage/i);
});

test('quiet coach speaks essential corrections but not general praise', async () => {
  const spoken = [];
  const feedback = ['great-job', 'adjust-alignment'];
  let onPose;
  const controller = createWorkoutController({
    video: { srcObject: null },
    canvas: {},
    speechCoach: {
      setEnabled() {},
      speak(...args) { spoken.push(args); },
      cancel() {},
    },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {}, pause() {}, resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update() { return { count: 0, state: 'standing', feedbackId: feedback.shift() }; } },
      'jumping-jacks': { reset() {}, update() { return { count: 0, state: 'closed' }; } },
      plank: { reset() {}, update() { return { elapsedMs: 0, state: 'waiting' }; } },
    }),
  });
  controller.setPersonality('quiet');
  controller.setVoiceEnabled(true);
  await controller.start();
  emitReadyFrames(onPose, 'squats', 1000);
  onPose(createReadyLandmarks('squats'), 1100);

  assert.deepEqual(spoken.map(([messageId]) => messageId), [
    'workout-countdown',
    'adjust-alignment',
  ]);
});

test('energetic coach resolves localized variant text and metadata', () => {
  const controller = createWorkoutController();
  controller.setPersonality('energetic');
  controller.setLanguage('yo');

  assert.equal(controller.getState().personality, 'energetic');
  assert.equal(controller.getState().feedback, 'O ti setan. Bẹrẹ gbigbe nigbati ara rẹ ba balẹ.');
  assert.equal(controller.getState().translationStatus, 'unverified');
});

for (const language of ['yo', 'ig', 'ha', 'pcm']) {
  test(`short ${language} coaching audio includes an existing localized continuation`, async () => {
    let request;
    const voice = `${language}-voice`;
    const controller = createWorkoutController({
      storage: { getItem() { return null; }, setItem() {} },
      audioCoach: {
        async listVoices() {
          return [{ id: voice, languages: [language], isDefault: true }];
        },
        async synthesizeAudio(payload) {
          request = payload;
          return new Blob(['audio'], { type: 'audio/mpeg' });
        },
      },
      voicePlayback: { setMuted() {}, stop() {} },
      speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
    });

    controller.setLanguage(language);
    controller.setVoiceEnabled(true);
    await controller.refreshVoiceCatalog();
    assert.equal(await controller.generateVoiceTest('great-job'), true);

    const greeting = translateMessage('great-job', language).text;
    const continuation = translateMessage('keep-going', language).text;
    assert.deepEqual(request, {
      text: `${greeting} ${continuation}`,
      language,
      voice,
    });
    assert.ok(Array.from(request.text).length >= 20);
    assert.match(controller.getState().voiceStatus, /Audio generated/);
    assert.match(controller.getState().voiceStatus, new RegExp(voice));
  });

  test(`localized ${language} coaching waits for a compatible voice during first-use discovery`, async () => {
    const synthesisRequests = [];
    let resolveVoices;
    const voiceId = `${language}-voice`;
    const voicesPromise = new Promise((resolve) => {
      resolveVoices = resolve;
    });
    const controller = createWorkoutController({
      video: { srcObject: null },
      canvas: {},
      audioCoach: {
        listVoices() { return voicesPromise; },
        async synthesizeAudio(payload) {
          synthesisRequests.push(payload);
          return new Blob(['audio']);
        },
      },
      voicePlayback: { async play() { return true; }, setMuted() {}, stop() {} },
      speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
      startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
      stopCamera() {},
      createPoseTracker: () => ({
        async start() {},
        stop() {},
        pause() {},
        resume() {},
      }),
    });
    controller.setLanguage(language);
    controller.setVoiceEnabled(true);
    await controller.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(synthesisRequests.length, 0);

    resolveVoices([{ id: voiceId, languages: [language], isDefault: true }]);
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(synthesisRequests.length > 0);
    assert.ok(synthesisRequests.every(({ language: code, voice }) =>
      code === language && voice === voiceId,
    ));
  });
}

test('localized audio is requested once for an eligible analyzer event only', async () => {
  const calls = [];
  const playCalls = [];
  let onPose;
  const feedback = ['great-job', 'adjust-alignment', 'adjust-alignment'];
  const controller = createWorkoutController({
    video: { srcObject: null },
    canvas: {},
    storage: { getItem() { return null; }, setItem() {} },
    audioCoach: {
      async listVoices() { return [{ id: 'yoruba-voice', languages: ['yo'] }]; },
      async synthesizeAudio(payload) {
        calls.push(payload);
        return new Blob(['audio']);
      },
    },
    voicePlayback: {
      async play(audio, options) { playCalls.push(options); return true; },
      setMuted() {},
      stop() {},
    },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {}, pause() {}, resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update() { return { count: 0, state: 'standing', feedbackId: feedback.shift() }; } },
      'jumping-jacks': { reset() {}, update() { return { count: 0, state: 'closed' }; } },
      plank: { reset() {}, update() { return { elapsedMs: 0, state: 'waiting' }; } },
    }),
  });
  controller.setPersonality('quiet');
  controller.setLanguage('yo');
  controller.setVoiceId('yoruba-voice');
  controller.setVoiceEnabled(true);
  await controller.start();
  emitReadyFrames(onPose, 'squats', 1000);
  onPose(createReadyLandmarks('squats'), 1100);
  onPose(createReadyLandmarks('squats'), 1200);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.map(({ text }) => text), [
    'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
    'Ṣe atunṣe díẹ sí ìdúró ara rẹ.',
  ]);
  const correction = calls.find(({ text }) => text === 'Ṣe atunṣe díẹ sí ìdúró ara rẹ.');
  assert.equal(correction.language, 'yo');
  assert.equal(correction.voice, 'yoruba-voice');
  assert.ok(playCalls.some(({ eventKey }) => /adjust-alignment/.test(eventKey)));
});

test('optional spoken rep counts follow analyzer increments and completion takes precedence', async () => {
  const calls = [];
  let onPose;
  let count = 0;
  const controller = createWorkoutController({
    video: { srcObject: null },
    canvas: {},
    audioCoach: {
      async listVoices() { return [{ id: 'yoruba-voice', languages: ['yo'] }]; },
      async synthesizeAudio(payload) {
        calls.push(payload);
        return new Blob(['audio']);
      },
    },
    voicePlayback: { async play() { return true; }, setMuted() {}, stop() {} },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {}, pause() {}, resume() {},
    }),
    createAnalyzers: () => ({
      squats: {
        reset() { count = 0; },
        update() {
          count += 1;
          return { count, formValid: true, state: 'standing' };
        },
      },
      'jumping-jacks': { reset() {}, update() { return { count: 0, state: 'closed' }; } },
      plank: { reset() {}, update() { return { elapsedMs: 0, state: 'waiting' }; } },
    }),
  });
  assert.equal(controller.getState().countEachRep, false);
  controller.setGoal(3);
  controller.setLanguage('yo');
  controller.setVoiceEnabled(true);
  controller.setCountEachRep(true);
  await controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  emitReadyFrames(onPose, 'squats', 1000);
  onPose(createReadyLandmarks('squats'), 1100);
  onPose(createReadyLandmarks('squats'), 1200);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.map(({ text }) => text), [
    'Ẹ káàbọ̀. Ẹ jẹ́ ká máa rìn ní ìyára tó bá yín mu.',
    'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
    '1. Tẹsiwaju ni iyara ti o ba ọ mu.',
    '2. Tẹsiwaju ni iyara ti o ba ọ mu.',
    'O ti pari adaṣe. O ṣeun!',
  ]);
});

test('mounted app sends localized speech text to same-origin YarnGPT routes', async (t) => {
  const requests = [];
  const played = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/coach/voices') {
      return new Response(JSON.stringify({
        voices: [{ id: 'yoruba-voice', name: 'Yoruba Voice', languages: ['yo'] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const root = {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const controller = mountApp(root, {
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      stop() {},
      async play(blob, options) { played.push({ blob, options }); return true; },
    },
  });

  controller.setLanguage('yo');
  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));
  controller.setVoiceId('yoruba-voice');
  await controller.playVoiceTest('great-job');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(requests.map(({ url }) => url), [
    '/api/coach/voices',
    '/api/coach/audio',
  ]);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    text: 'O ṣe dáadáa! Tẹsiwaju ni iyara ti o ba ọ mu.',
    language: 'yo',
    voice: 'yoruba-voice',
  });
  assert.equal(played.length, 1);
  assert.equal(played[0].options.priority, 100);
});

test('Test Voice reports failure when browser playback does not begin', async () => {
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() { return [{ id: 'pidgin-voice', languages: ['pcm'] }]; },
      async synthesizeAudio() { return new Blob(['audio']); },
    },
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      async play() { return false; },
    },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
  });
  controller.setLanguage('pcm');
  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));

  const played = await controller.playVoiceTest('great-job');

  assert.equal(played, false);
  assert.match(controller.getState().voiceStatus, /playback failed|did not start|blocked/i);
});

test('browser audio diagnostic plays locally and does not request YarnGPT', async () => {
  const playbackCalls = [];
  const controller = createWorkoutController({
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      async play(blob, options) {
        playbackCalls.push({ blob, options });
        return true;
      },
    },
    audioCoach: {
      async synthesizeAudio() { throw new Error('YarnGPT must not be called'); },
    },
  });

  const result = await controller.playBrowserAudioTest();

  assert.equal(result, true);
  assert.equal(playbackCalls.length, 1);
  assert.equal(playbackCalls[0].blob.type, 'audio/wav');
  assert.equal(playbackCalls[0].options.allowMuted, true);
  assert.match(controller.getState().voiceStatus, /local audio.*no YarnGPT request/i);
});

test('NaijaLingo connection check discovers speakers without generating speech', async () => {
  let listCalls = 0;
  let synthesisCalls = 0;
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() {
        listCalls += 1;
        return [{ id: 'pidgin-voice', name: 'Pidgin Voice', languages: ['pcm'] }];
      },
      async synthesizeAudio() {
        synthesisCalls += 1;
        return new Blob(['audio']);
      },
    },
  });

  controller.setLanguage('pcm');
  const voices = await controller.refreshVoiceCatalog();

  assert.equal(listCalls, 1);
  assert.equal(synthesisCalls, 0);
  assert.equal(voices.length, 1);
  assert.match(controller.getState().voiceCatalogStatus, /available for Nigerian Pidgin/i);
});

test('voice selector labels recommended speakers with gender and conversation domain', () => {
  const options = voiceOptions({
    language: 'yo',
    voiceId: 'abimbola_yo',
    availableVoices: [
      {
        id: 'abimbola_yo',
        name: 'Abimbola',
        languages: ['yo'],
        gender: 'female',
        domain: 'Everyday Conversation',
        isRecommended: true,
      },
      {
        id: 'babatunde_yo',
        name: 'Babatunde',
        languages: ['yo'],
        gender: 'male',
        domain: 'Everyday Conversation',
        isRecommended: true,
      },
    ],
  });

  assert.match(options, /Abimbola.*Female.*Everyday Conversation.*Recommended/i);
  assert.match(options, /Babatunde.*Male.*Everyday Conversation.*Recommended/i);
  assert.match(options, /value="abimbola_yo" selected/);
});

test('English Test Voice uses browser speech when NaijaLingo has no English speaker', async () => {
  const spoken = [];
  let synthesisCalls = 0;
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() { return []; },
      async synthesizeAudio() {
        synthesisCalls += 1;
        return new Blob(['audio']);
      },
    },
    speechCoach: {
      setEnabled() {},
      speak(messageId, text, language) {
        spoken.push({ messageId, text, language });
        return true;
      },
      cancel() {},
    },
  });
  controller.setVoiceEnabled(true);

  const played = await controller.generateVoiceTest('great-job');

  assert.equal(played, true);
  assert.equal(synthesisCalls, 0);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].language, 'en');
  assert.match(controller.getState().voiceStatus, /browser speech/i);
});

test('English Play Test Voice does not require generated audio bytes', async () => {
  const spoken = [];
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() { return []; },
      async synthesizeAudio() {
        throw new Error('English should not use NaijaLingo');
      },
    },
    speechCoach: {
      setEnabled() {},
      speak(messageId, text, language) {
        spoken.push({ messageId, text, language });
        return true;
      },
      cancel() {},
    },
  });
  controller.setVoiceEnabled(true);

  const played = await controller.playVoiceTest('great-job');

  assert.equal(played, true);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].language, 'en');
});

test('prepared Test Voice audio can be replayed without another synthesis call', async () => {
  let synthesisCalls = 0;
  const playbackCalls = [];
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() { return [{ id: 'pidgin-voice', languages: ['pcm'] }]; },
      async synthesizeAudio() {
        synthesisCalls += 1;
        return new Blob(['mp3-data'], { type: 'audio/mpeg' });
      },
    },
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      async play(blob, options) {
        playbackCalls.push({ blob, options });
        return true;
      },
    },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
  });
  controller.setLanguage('pcm');
  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await controller.generateVoiceTest('great-job'), true);
  assert.equal(await controller.playPreparedVoiceTest(), true);
  assert.equal(await controller.playPreparedVoiceTest(), true);
  assert.equal(synthesisCalls, 1);
  assert.equal(playbackCalls.length, 2);
  assert.match(controller.getState().voiceStatus, /Playing|Completed/i);
});

test('Test Voice refuses to generate paid audio when volume is zero', async () => {
  let synthesisCalls = 0;
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() { return [{ id: 'pidgin-voice', languages: ['pcm'] }]; },
      async synthesizeAudio() {
        synthesisCalls += 1;
        return new Blob(['audio']);
      },
    },
    voicePlayback: { setMuted() {}, setVolume() {}, stop() {}, async play() { return true; } },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
  });
  controller.setLanguage('pcm');
  controller.setVoiceVolume(0);
  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));

  const played = await controller.playVoiceTest('great-job');

  assert.equal(played, false);
  assert.equal(synthesisCalls, 0);
  assert.match(controller.getState().voiceStatus, /volume.*zero|increase.*volume/i);
});

test('English workout start uses browser speech without calling NaijaLingo', async () => {
  const speechEvents = [];
  let synthesisCalls = 0;
  let onPose;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    audioCoach: {
      async listVoices() { return []; },
      async synthesizeAudio() {
        synthesisCalls += 1;
        return new Blob(['audio']);
      },
    },
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      stop() {},
      async play() { return true; },
    },
    speechCoach: {
      setEnabled() {},
      speak(messageId) { speechEvents.push(messageId); return true; },
      cancel() {},
    },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {}, pause() {}, resume() {},
    }),
  });
  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));
  await controller.start();
  emitReadyFrames(onPose, 'squats');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(speechEvents, [
    'welcome',
    'workout-countdown',
    'return-to-start',
  ]);
  assert.equal(synthesisCalls, 0);
});

test('changing language refreshes compatible voices and cancels current playback', async () => {
  let listCalls = 0;
  let stopCalls = 0;
  const controller = createWorkoutController({
    audioCoach: {
      async listVoices() {
        listCalls += 1;
        return listCalls === 1
          ? [{ id: 'english-voice', languages: ['en'], default: true }]
          : [{ id: 'yoruba-voice', languages: ['yo'], default: true }];
      },
    },
    voicePlayback: {
      setMuted() {},
      setVolume() {},
      stop() { stopCalls += 1; },
    },
    speechCoach: { setEnabled() {}, speak() {}, cancel() {} },
  });

  controller.setVoiceEnabled(true);
  await new Promise((resolve) => setImmediate(resolve));
  controller.setLanguage('yo');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(listCalls, 2);
  assert.equal(controller.getState().voiceId, 'yoruba-voice');
  assert.ok(stopCalls >= 1);
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
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
      plank: createPlankAnalyzer(),
    }),
  });
  harness.controller.selectExercise('plank');
  await harness.controller.start();
  const onPose = harness.trackers[0].callbacks.onPose;
  const landmarks = createReadyLandmarks('plank');
  const baseTime = globalThis.performance?.now?.() ?? Date.now();
  emitReadyFrames(onPose, 'plank', baseTime);
  onPose(landmarks, baseTime + 100);
  onPose(landmarks, baseTime + 200);
  onPose(landmarks, baseTime + 300);
  onPose(landmarks, baseTime + 400);
  onPose(landmarks, baseTime + 500);
  const earnedTime = harness.controller.getState().elapsedMs;
  assert.ok(earnedTime > 0);

  harness.controller.pause();
  await harness.controller.resume();
  onPose(landmarks, baseTime + 5000);
  assert.equal(harness.controller.getState().elapsedMs, earnedTime);
  onPose(landmarks, baseTime + 5100);
  onPose(landmarks, baseTime + 5200);
  onPose(landmarks, baseTime + 5300);
  onPose(landmarks, baseTime + 5400);
  onPose(landmarks, baseTime + 5500);

  assert.ok(harness.controller.getState().elapsedMs > earnedTime);
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

test('Vite proxies only backend coaching routes, not shared frontend source imports', () => {
  assert.deepEqual(Object.keys(viteConfig.server.proxy), ['/api/coach']);
  assert.equal(viteConfig.server.proxy['/api/coach'].target, 'http://127.0.0.1:8000');
});

test('squat workout instructions require a side-on view with visible joints', () => {
  const listeners = new Map();
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  mountApp(root);
  listeners.get('click')({
    target: {
      closest: () => ({
        dataset: { action: 'choose-exercise', exercise: 'squats' },
      }),
    },
  });

  assert.match(root.innerHTML, /Stand side-on to the camera/);
  assert.match(root.innerHTML, /hip, knee, and ankle/);
  assert.doesNotMatch(root.innerHTML, /facing the camera/);
});

test('home exercise cards show the matching picture and requested benefit', () => {
  const root = {
    innerHTML: '',
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  mountApp(root);

  for (const exercise of Object.values(EXERCISES)) {
    assert.ok(root.innerHTML.includes(`src="${exercise.media.src}"`));
    assert.ok(root.innerHTML.includes(exercise.benefits));
    assert.ok(root.innerHTML.includes(`alt="${exercise.media.alt}"`));
  }
});

test('initial plank progress metadata uses elapsed time', () => {
  const listeners = new Map();
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  mountApp(root);
  listeners.get('click')({
    target: {
      closest: () => ({
        dataset: { action: 'choose-exercise', exercise: 'plank' },
      }),
    },
  });

  assert.match(root.innerHTML, /data-progress-meta>0\/30 • 30 remaining • 0%/);
});

test('each exercise opens its matching picture and instructions before Start', async () => {
  const listeners = new Map();
  let cameraStarts = 0;
  const tracks = [];
  const video = { srcObject: null };
  const canvas = {};
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      return selector === 'video' ? video : selector === 'canvas' ? canvas : null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const click = (action, dataset = {}) => listeners.get('click')({
    target: {
      closest: () => ({ dataset: { action, ...dataset } }),
    },
  });

  const controller = mountApp(root, {
    controllerOptions: {
      startCamera: async (videoElement) => {
        cameraStarts += 1;
        const track = { stop() {} };
        tracks.push(track);
        const stream = {
          getTracks: () => tracks,
          getVideoTracks: () => tracks,
        };
        videoElement.srcObject = stream;
        return stream;
      },
      stopCamera: (_stream, videoElement) => {
        videoElement.srcObject = null;
      },
      createPoseTracker: () => ({
        async start() {},
        stop() {},
      }),
    },
  });

  for (const [exerciseId, exercise] of Object.entries(EXERCISES)) {
    click('home');
    click('choose-exercise', { exercise: exerciseId });
    assert.ok(root.innerHTML.includes(`src="${exercise.media.src}"`));
    assert.ok(root.innerHTML.includes(exercise.benefits));
    assert.ok(root.innerHTML.includes(exercise.instructions));
    assert.ok(root.innerHTML.includes('data-action="start"'));
    assert.ok(root.innerHTML.includes('Workout goal'));
    assert.equal(cameraStarts, 0);
  }

  click('start');
  await controller.start();
  assert.equal(cameraStarts, 1);
  assert.ok(video.srcObject);
  await controller.end();
});
