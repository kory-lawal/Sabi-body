import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlankAnalyzer } from '../src/exercises/plank.js';
import { EXERCISE_INSTRUCTION_IDS, translateMessage } from '../src/feedback/messages.js';
import { createSpeechQueue } from '../src/feedback/speech-queue.js';
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
    speechQueue: createSpeechQueue({ delay: async () => {} }),
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

async function flushSpeechQueue() {
  for (let turn = 0; turn < 12; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

test('goal presets and custom input stay synchronized with the selected workout target', () => {
  const listeners = new Map();
  const goalLabel = { textContent: '' };
  const progressValue = { textContent: '' };
  const progressMeta = { textContent: '' };
  const customInput = {
    value: '10',
    validity: { valid: true },
    matches(selector) {
      return selector === '[data-action="goal-custom"]';
    },
  };
  const presetButtons = [5, 10, 15, 20, 25, 30, 50].map((target) => {
    const button = {
      dataset: { action: 'set-goal', target: String(target) },
      selected: false,
      ariaPressed: 'false',
      classList: {
        toggle(name, enabled) {
          if (name === 'is-selected') {
            button.selected = enabled;
          }
        },
      },
      setAttribute(name, value) {
        if (name === 'aria-pressed') {
          button.ariaPressed = value;
        }
      },
    };
    return button;
  });
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      if (selector === '[data-goal-target]') {
        return goalLabel;
      }
      if (selector === '[data-progress]') {
        return progressValue;
      }
      if (selector === '[data-progress-meta]') {
        return progressMeta;
      }
      if (selector === '[data-action="goal-custom"]') {
        return customInput;
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-action="set-goal"]' || selector === '[data-action]'
        ? presetButtons
        : [];
    },
  };
  const click = (action, dataset = {}) => listeners.get('click')({
    target: {
      closest: () => ({ dataset: { action, ...dataset } }),
    },
  });
  const controller = mountApp(root);

  click('choose-exercise', { exercise: 'squats' });
  assert.equal(controller.getState().target, 10);

  for (const target of [5, 10, 15, 20, 25, 30, 50]) {
    click('set-goal', { target: String(target) });
    assert.equal(controller.getState().target, target);
    assert.equal(goalLabel.textContent, `${target} reps`);
    assert.equal(progressValue.textContent, `0 / ${target} reps`);
    assert.equal(progressMeta.textContent, `0/${target} • ${target} remaining • 0%`);
    assert.equal(customInput.value, String(target));
    assert.deepEqual(
      presetButtons.filter((button) => button.selected).map((button) => Number(button.dataset.target)),
      [target],
    );
    assert.equal(presetButtons.find((button) => Number(button.dataset.target) === target).ariaPressed, 'true');
  }

  customInput.value = '17';
  listeners.get('input')({ target: customInput });
  assert.equal(controller.getState().target, 17);
  assert.equal(goalLabel.textContent, '17 reps');
  assert.equal(progressValue.textContent, '0 / 17 reps');
  assert.equal(progressMeta.textContent, '0/17 • 17 remaining • 0%');
  assert.equal(customInput.value, '17');
  assert.deepEqual(presetButtons.filter((button) => button.selected), []);

  click('set-goal', { target: '15' });
  assert.equal(controller.getState().target, 15);
  assert.equal(goalLabel.textContent, '15 reps');
  assert.equal(progressValue.textContent, '0 / 15 reps');
  assert.equal(progressMeta.textContent, '0/15 • 15 remaining • 0%');
  assert.equal(customInput.value, '15');
  assert.deepEqual(
    presetButtons.filter((button) => button.selected).map((button) => Number(button.dataset.target)),
    [15],
  );
});

test('selected goal becomes the actual target for workout completion', async () => {
  let count = 0;
  const harness = createHarness({
    autoReadiness: false,
    createAnalyzers: () => ({
      squats: {
        reset() {
          count = 0;
        },
        invalidatePhase() {},
        update() {
          count += 1;
          return { count, formValid: false, state: 'standing' };
        },
      },
    }),
  });

  harness.controller.setGoal(3);
  assert.equal(harness.controller.getState().progressTarget, 3);
  await harness.controller.start();
  const onPose = harness.trackers[0].callbacks.onPose;
  for (let frame = 0; frame < 3; frame += 1) {
    onPose(createReadyLandmarks('squats'), frame * 33);
  }

  const state = harness.controller.getState();
  assert.equal(state.workoutStatus, 'completed');
  assert.equal(state.completedWorkouts[0].target, 3);
});

test('a selected 30-rep goal stays visible and drives the active workout target', async () => {
  const listeners = new Map();
  const progressValue = { textContent: '' };
  const progressMeta = { textContent: '' };
  const goalTarget = { textContent: '' };
  const customInput = { value: '10' };
  const video = { srcObject: null };
  const canvas = {};
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      return {
        video,
        canvas,
        '[data-progress]': progressValue,
        '[data-progress-meta]': progressMeta,
        '[data-goal-target]': goalTarget,
        '[data-action="goal-custom"]': customInput,
      }[selector] ?? null;
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
  let count = 0;
  let onPose;
  const controller = mountApp(root, {
    controllerOptions: {
      startCamera: async (videoElement) => {
        const track = { stop() {} };
        const stream = {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        };
        videoElement.srcObject = stream;
        return stream;
      },
      stopCamera(_stream, videoElement) {
        videoElement.srcObject = null;
      },
      createPoseTracker(callbacks) {
        return {
          async start() {
            onPose = callbacks.onPose;
          },
          pause() {},
          resume() {},
          stop() {},
        };
      },
      createAnalyzers: () => ({
        squats: {
          reset() {
            count = 0;
          },
          invalidatePhase() {},
          update() {
            count += 1;
            return { count, state: 'standing' };
          },
        },
      }),
    },
  });

  click('choose-exercise', { exercise: 'squats' });
  click('set-goal', { target: '30' });
  assert.equal(controller.getState().target, 30);
  assert.equal(goalTarget.textContent, '30 reps');

  click('start');
  await controller.start();
  assert.equal(progressValue.textContent, '0 / 30 reps');
  assert.match(progressMeta.textContent, /^0\/30 • 30 remaining • 0%$/);

  onPose(createReadyLandmarks('squats'), 33);
  assert.equal(progressValue.textContent, '1 / 30 reps');
  assert.match(progressMeta.textContent, /^1\/30 • 29 remaining • 3%$/);

  for (let frame = 2; frame <= 30; frame += 1) {
    onPose(createReadyLandmarks('squats'), frame * 33);
  }
  const state = controller.getState();
  assert.equal(state.workoutStatus, 'completed');
  assert.equal(state.completedWorkouts[0].target, 30);
  assert.equal(state.completedWorkouts[0].achieved, 30);
});

test('mobile settings menu opens, closes on outside click and Escape, and applies selections', () => {
  const rootListeners = new Map();
  const documentListeners = new Map();
  const settingsToggle = {
    expanded: 'false',
    setAttribute(name, value) {
      if (name === 'aria-expanded') {
        this.expanded = value;
      }
    },
  };
  const settingsPanel = { dataset: { open: 'false' } };
  const inside = {};
  const settingsRoot = { contains: (target) => target === inside };
  const document = {
    body: { classList: { toggle() {} } },
    addEventListener(name, callback) {
      documentListeners.set(name, callback);
    },
  };
  const root = {
    innerHTML: '',
    ownerDocument: document,
    addEventListener(name, callback) {
      rootListeners.set(name, callback);
    },
    querySelector(selector) {
      return {
        '[data-action="toggle-mobile-settings"]': settingsToggle,
        '[data-mobile-settings]': settingsPanel,
        '[data-mobile-settings-root]': settingsRoot,
      }[selector] ?? null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const click = (action) => rootListeners.get('click')({
    target: { closest: () => ({ dataset: { action } }) },
  });
  const controller = mountApp(root);

  assert.match(root.innerHTML, /data-action="toggle-mobile-settings"/);
  assert.match(root.innerHTML, /aria-expanded="false"/);
  assert.equal(settingsPanel.dataset.open, 'false');

  click('toggle-mobile-settings');
  assert.equal(settingsPanel.dataset.open, 'true');
  assert.equal(settingsToggle.expanded, 'true');

  rootListeners.get('change')({
    target: {
      value: 'yo',
      matches: (selector) => selector === '[data-action="language"]',
    },
  });
  assert.equal(controller.getState().language, 'yo');
  assert.equal(settingsPanel.dataset.open, 'false');
  assert.equal(settingsToggle.expanded, 'false');

  click('toggle-mobile-settings');
  documentListeners.get('pointerdown')({ target: inside });
  assert.equal(settingsPanel.dataset.open, 'true');
  documentListeners.get('pointerdown')({ target: {} });
  assert.equal(settingsPanel.dataset.open, 'false');

  click('toggle-mobile-settings');
  documentListeners.get('keydown')({ key: 'Escape' });
  assert.equal(settingsPanel.dataset.open, 'false');
  assert.equal(settingsToggle.expanded, 'false');
});

test('active workout keeps voice controls available through its mobile disclosure', () => {
  const listeners = new Map();
  const voiceToggle = {
    expanded: 'false',
    setAttribute(name, value) {
      if (name === 'aria-expanded') {
        this.expanded = value;
      }
    },
  };
  const voicePanel = { dataset: { open: 'false' } };
  const root = {
    innerHTML: '',
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      return {
        '[data-action="toggle-mobile-voice-settings"]': voiceToggle,
        '[data-mobile-voice-settings]': voicePanel,
      }[selector] ?? null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const click = (action, dataset = {}) => listeners.get('click')({
    target: { closest: () => ({ dataset: { action, ...dataset } }) },
  });

  mountApp(root);
  click('choose-exercise', { exercise: 'squats' });

  for (const action of ['voice', 'voice-volume', 'voice-id', 'count-each-rep']) {
    assert.match(root.innerHTML, new RegExp(`data-action="${action}"`));
  }
  assert.match(root.innerHTML, /data-action="toggle-mobile-voice-settings"/);
  assert.match(root.innerHTML, /aria-controls="mobile-voice-settings"/);
  assert.match(root.innerHTML, /data-fullscreen-status/);

  click('toggle-mobile-voice-settings');
  assert.equal(voicePanel.dataset.open, 'true');
  assert.equal(voiceToggle.expanded, 'true');
});

test('mounted workout settings omit developer voice tests and translation disclaimer', () => {
  const root = {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const controller = mountApp(root);
  controller.selectExercise('squats');

  for (const action of ['language', 'personality', 'voice', 'voice-volume', 'voice-id']) {
    assert.match(root.innerHTML, new RegExp(`data-action="${action}"`));
  }
  assert.match(root.innerHTML, /Coach style/);
  assert.match(root.innerHTML, /Language/);
  assert.match(root.innerHTML, /Voice coaching/);
  assert.match(root.innerHTML, /Volume/);
  assert.match(root.innerHTML, /aria-label="Choose a discovered voice"/);
  assert.match(root.innerHTML, /data-voice-status/);
  assert.match(root.innerHTML, /data-voice-catalog-status/);

  const translationDisclaimer = [
    'Translation is an unverified',
    ' draft; review it with a fluent speaker.',
  ].join('');
  assert.doesNotMatch(root.innerHTML, new RegExp(translationDisclaimer));
  assert.doesNotMatch(root.innerHTML, /<summary>[^<]*(?:test|pronunciation)/i);
  assert.doesNotMatch(root.innerHTML, /data-action="(?:test|generate-test|play-test)-/);
  assert.doesNotMatch(root.innerHTML, /fluent speaker/i);
  assert.doesNotMatch(root.innerHTML, /data-translation-[\w-]+/);
  assert.doesNotMatch(root.innerHTML, new RegExp(['data-voice-', 'test-status'].join('')));
  for (const method of [
    ['generateVoice', 'Test'].join(''),
    ['playPreparedVoice', 'Test'].join(''),
    ['playVoice', 'Test'].join(''),
    ['playBrowserAudio', 'Test'].join(''),
  ]) {
    assert.equal(controller[method], undefined);
  }
});

test('mobile Start requests fullscreen without waiting for it before starting', async () => {
  const listeners = new Map();
  const events = [];
  const bodyClasses = new Set();
  const pageClasses = new Set();
  const status = { hidden: true, textContent: '' };
  const video = { srcObject: null };
  const canvas = {};
  const page = {
    classList: {
      toggle(name, enabled) {
        enabled ? pageClasses.add(name) : pageClasses.delete(name);
      },
    },
    querySelector(selector) {
      return selector === '[data-fullscreen-status]' ? status : null;
    },
  };
  const document = {
    fullscreenElement: null,
    body: {
      classList: {
        toggle(name, enabled) {
          enabled ? bodyClasses.add(name) : bodyClasses.delete(name);
        },
      },
    },
    defaultView: { matchMedia: () => ({ matches: true }) },
    addEventListener() {},
    exitFullscreen() {
      events.push('exit-fullscreen');
      this.fullscreenElement = null;
      return Promise.resolve();
    },
  };
  let resolveFullscreen;
  page.requestFullscreen = () => {
    events.push('fullscreen');
    return new Promise((resolve) => {
      resolveFullscreen = resolve;
    });
  };
  const root = {
    innerHTML: '',
    ownerDocument: document,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      if (selector === '.workout-page') {
        return root.innerHTML.includes('class="workout-page"') ? page : null;
      }
      if (selector === '[data-fullscreen-status]') {
        return root.innerHTML.includes('data-fullscreen-status') ? status : null;
      }
      if (selector === 'video') {
        return root.innerHTML.includes('<video') ? video : null;
      }
      if (selector === 'canvas') {
        return root.innerHTML.includes('<canvas') ? canvas : null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const click = (action, dataset = {}) => listeners.get('click')({
    target: { closest: () => ({ dataset: { action, ...dataset } }) },
  });
  const controller = mountApp(root, {
    controllerOptions: {
      startCamera: async (cameraVideo) => {
        events.push('camera');
        const track = { stop() {} };
        const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        cameraVideo.srcObject = stream;
        return stream;
      },
      stopCamera(_stream, cameraVideo) {
        cameraVideo.srcObject = null;
      },
      createPoseTracker: () => ({
        async start() {},
        pause() {},
        resume() {},
        stop() {},
      }),
    },
  });

  click('choose-exercise', { exercise: 'squats' });
  click('start');

  assert.deepEqual(events, ['fullscreen', 'camera']);
  assert.equal(controller.getState().workoutStatus, 'loading');
  assert.ok(bodyClasses.has('workout-active'));
  assert.ok(pageClasses.has('is-active'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().workoutStatus, 'running');

  controller.reset();
  assert.ok(bodyClasses.has('workout-active'));
  controller.pause();
  assert.ok(bodyClasses.has('workout-active'));
  await controller.resume();
  assert.ok(bodyClasses.has('workout-active'));

  document.fullscreenElement = page;
  resolveFullscreen();
  await new Promise((resolve) => setImmediate(resolve));
  await controller.end();
  assert.deepEqual(events, ['fullscreen', 'camera', 'exit-fullscreen']);
  assert.equal(bodyClasses.has('workout-active'), false);
});

test('fullscreen rejection and unsupported fullscreen keep mobile camera startup available', async () => {
  for (const requestFullscreen of [
    undefined,
    () => Promise.reject(new Error('fullscreen denied')),
  ]) {
    const listeners = new Map();
    const status = { hidden: true, textContent: '' };
    const video = { srcObject: null };
    const canvas = {};
    let cameraStarted = false;
    const page = {
      querySelector: (selector) => selector === '[data-fullscreen-status]' ? status : null,
      ...(requestFullscreen ? { requestFullscreen } : {}),
    };
    const root = {
      innerHTML: '',
      ownerDocument: {
        body: { classList: { toggle() {} } },
        defaultView: { matchMedia: () => ({ matches: true }) },
        addEventListener() {},
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      querySelector(selector) {
        if (selector === '.workout-page') {
          return root.innerHTML.includes('class="workout-page"') ? page : null;
        }
        if (selector === '[data-fullscreen-status]') {
          return root.innerHTML.includes('data-fullscreen-status') ? status : null;
        }
        if (selector === 'video') {
          return root.innerHTML.includes('<video') ? video : null;
        }
        return selector === 'canvas' && root.innerHTML.includes('<canvas') ? canvas : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const click = (action, dataset = {}) => listeners.get('click')({
      target: { closest: () => ({ dataset: { action, ...dataset } }) },
    });
    const controller = mountApp(root, {
      controllerOptions: {
        startCamera: async (cameraVideo) => {
          cameraStarted = true;
          const track = { stop() {} };
          const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
          cameraVideo.srcObject = stream;
          return stream;
        },
        stopCamera(_stream, cameraVideo) {
          cameraVideo.srcObject = null;
        },
        createPoseTracker: () => ({
          async start() {},
          stop() {},
        }),
      },
    });

    click('choose-exercise', { exercise: 'squats' });
    click('start');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(cameraStarted, true);
    assert.equal(controller.getState().workoutStatus, 'running');
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Fullscreen unavailable/);
    await controller.end();
  }
});

test('workout completion exits mobile fullscreen and releases scroll lock', async () => {
  const listeners = new Map();
  const bodyClasses = new Set();
  const pageClasses = new Set();
  const video = { srcObject: null };
  const canvas = {};
  const page = {
    classList: {
      toggle(name, enabled) {
        enabled ? pageClasses.add(name) : pageClasses.delete(name);
      },
    },
    querySelector() {
      return null;
    },
    requestFullscreen() {
      document.fullscreenElement = page;
      return Promise.resolve();
    },
  };
  const document = {
    fullscreenElement: null,
    body: {
      classList: {
        toggle(name, enabled) {
          enabled ? bodyClasses.add(name) : bodyClasses.delete(name);
        },
      },
    },
    defaultView: { matchMedia: () => ({ matches: true }) },
    addEventListener() {},
    exitFullscreen() {
      this.fullscreenElement = null;
      return Promise.resolve();
    },
  };
  const root = {
    innerHTML: '',
    ownerDocument: document,
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    querySelector(selector) {
      if (selector === '.workout-page') {
        return root.innerHTML.includes('class="workout-page"') ? page : null;
      }
      if (selector === 'video') {
        return root.innerHTML.includes('<video') ? video : null;
      }
      if (selector === 'canvas') {
        return root.innerHTML.includes('<canvas') ? canvas : null;
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const click = (action, dataset = {}) => listeners.get('click')({
    target: { closest: () => ({ dataset: { action, ...dataset } }) },
  });
  let onPose;
  let count = 0;
  const controller = mountApp(root, {
    controllerOptions: {
      startCamera: async (cameraVideo) => {
        const track = { stop() {} };
        const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        cameraVideo.srcObject = stream;
        return stream;
      },
      stopCamera(_stream, cameraVideo) {
        cameraVideo.srcObject = null;
      },
      createPoseTracker: (callbacks) => {
        onPose = callbacks.onPose;
        return {
          async start() {},
          stop() {},
        };
      },
      createAnalyzers: () => ({
        squats: {
          reset() {
            count = 0;
          },
          invalidatePhase() {},
          update() {
            count += 1;
            return { count, state: 'standing' };
          },
        },
      }),
    },
  });

  click('choose-exercise', { exercise: 'squats' });
  controller.setGoal(1);
  click('start');
  await controller.start();
  assert.equal(document.fullscreenElement, page);
  assert.ok(bodyClasses.has('workout-active'));

  for (let frame = 0; frame < 5 && controller.getState().workoutStatus === 'running'; frame += 1) {
    onPose(createReadyLandmarks('squats'), frame * 33);
  }

  assert.equal(controller.getState().workoutStatus, 'completed');
  assert.equal(document.fullscreenElement, null);
  assert.equal(bodyClasses.has('workout-active'), false);
  assert.ok(root.innerHTML.includes('Workout Completed!'));
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
    speechQueue: createSpeechQueue({ delay: async () => {} }),
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

  await flushSpeechQueue();
  assert.deepEqual(spoken.map(([messageId]) => messageId), [
    'workout-countdown',
    'adjust-alignment',
    'instruction-squats',
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

test('localized audio is requested once for an eligible analyzer event only', async () => {
  const calls = [];
  const queue = createSpeechQueue({ delay: async () => {} });
  const queuedEvents = [];
  let onPose;
  const feedback = ['great-job', 'adjust-alignment', 'adjust-alignment'];
  const controller = createWorkoutController({
    video: { srcObject: null },
    canvas: {},
    speechQueue: {
      enqueue(item) {
        queuedEvents.push(item);
        return queue.enqueue(item);
      },
      clearPending: () => queue.clearPending(),
      cancel: () => queue.cancel(),
    },
    storage: { getItem() { return null; }, setItem() {} },
    audioCoach: {
      async listVoices() { return [{ id: 'yoruba-voice', languages: ['yo'] }]; },
      async synthesizeAudio(payload) {
        calls.push(payload);
        return new Blob(['audio']);
      },
    },
    voicePlayback: {
      async play() { return true; },
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
  await flushSpeechQueue();

  assert.deepEqual(calls.map(({ text }) => text), [
    'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
    'Ṣe atunṣe díẹ sí ìdúró ara rẹ.',
    'Tẹ eékún rẹ kí o sì ti ìgbáròkó rẹ sẹ́yìn, lẹ́yìn náà dìde dúró.',
  ]);
  const correction = calls.find(({ text }) => text === 'Ṣe atunṣe díẹ sí ìdúró ara rẹ.');
  assert.equal(correction.language, 'yo');
  assert.equal(correction.voice, 'yoruba-voice');
  assert.ok(queuedEvents.some(({ eventKey }) => /adjust-alignment/.test(eventKey)));
});

test('optional spoken rep counts follow analyzer increments and completion takes precedence', async () => {
  const calls = [];
  let onPose;
  let count = 0;
  const controller = createWorkoutController({
    video: { srcObject: null },
    canvas: {},
    speechQueue: createSpeechQueue({ delay: async () => {} }),
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
  await flushSpeechQueue();

  assert.deepEqual(calls.map(({ text }) => text), [
    'Ẹ káàbọ̀. Ẹ jẹ́ ká máa rìn ní ìyára tó bá yín mu.',
    'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
    'Tẹ eékún rẹ kí o sì ti ìgbáròkó rẹ sẹ́yìn, lẹ́yìn náà dìde dúró.',
    '1. Tẹsiwaju ni iyara ti o ba ọ mu.',
    'O ti pari adaṣe. O ṣeun!',
    '2. Tẹsiwaju ni iyara ti o ba ọ mu.',
  ]);
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
      {
        id: 'hausa-voice',
        name: 'Hausa Voice',
        languages: ['ha'],
      },
    ],
  });

  assert.match(options, /Abimbola.*Female.*Everyday Conversation.*Recommended/i);
  assert.match(options, /Babatunde.*Male.*Everyday Conversation.*Recommended/i);
  assert.match(options, /value="abimbola_yo" selected/);
  assert.doesNotMatch(options, /hausa-voice/);
});

test('English workout start uses browser speech without calling NaijaLingo', async () => {
  const speechEvents = [];
  let synthesisCalls = 0;
  let onPose;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    speechQueue: createSpeechQueue({ delay: async () => {} }),
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
  await flushSpeechQueue();

  assert.deepEqual(speechEvents, [
    'welcome',
    'return-to-start',
    'workout-countdown',
    'instruction-squats',
  ]);
  assert.equal(synthesisCalls, 0);
});

test('shared speech queue serializes coaching and prioritizes completion', async () => {
  const queue = createSpeechQueue({ delay: async () => {} });
  const speechEvents = [];
  const finishers = [];
  let activeAdapters = 0;
  let maximumActiveAdapters = 0;
  let onPose;
  let completedCount = 0;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    speechQueue: queue,
    speechCoach: {
      setEnabled() {},
      speak(messageId, text, language) {
        activeAdapters += 1;
        maximumActiveAdapters = Math.max(maximumActiveAdapters, activeAdapters);
        speechEvents.push({ messageId, text, language });
        return new Promise((resolve) => {
          finishers.push(() => {
            activeAdapters -= 1;
            resolve(true);
          });
        });
      },
      cancel() {},
    },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {},
      pause() {},
      resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update() { return { count: completedCount, state: 'standing' }; } },
      'jumping-jacks': { reset() {}, update() { return { count: 0, state: 'closed' }; } },
      plank: { reset() {}, update() { return { elapsedMs: 0, state: 'waiting' }; } },
      'push-ups': { reset() {}, update() { return { count: 0, state: 'top' }; } },
      'sit-ups': { reset() {}, update() { return { count: 0, state: 'lowered' }; } },
      lunges: { reset() {}, update() { return { count: 0, state: 'standing' }; } },
    }),
  });
  controller.setGoal(1);
  controller.setVoiceEnabled(true);
  await controller.start();
  emitReadyFrames(onPose, 'squats');
  completedCount = 1;
  onPose(createReadyLandmarks('squats'), 200);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(controller.getState().workoutStatus, 'completed');
  assert.deepEqual(speechEvents.map(({ messageId }) => messageId), ['welcome']);
  assert.equal(activeAdapters, 1);
  assert.equal(maximumActiveAdapters, 1);

  finishers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(speechEvents[1]?.messageId, 'exercise-completed');
  assert.equal(activeAdapters, 1);
  assert.equal(maximumActiveAdapters, 1);

  while (finishers.length) {
    finishers.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(maximumActiveAdapters, 1);
});

test('reset and end clear pending coaching without cancelling the active announcement', async () => {
  for (const action of ['reset', 'end']) {
    const queue = createSpeechQueue({ delay: async () => {} });
    const speechEvents = [];
    let releaseActive;
    let cancellationCount = 0;
    let onPose;
    const controller = createWorkoutController({
      video: {},
      canvas: {},
      speechQueue: queue,
      speechCoach: {
        setEnabled() {},
        speak(messageId) {
          speechEvents.push(messageId);
          if (messageId === 'welcome') {
            return new Promise((resolve) => { releaseActive = resolve; });
          }
          return true;
        },
        cancel() { cancellationCount += 1; },
      },
      startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
      stopCamera() {},
      createPoseTracker: (callbacks) => ({
        async start() { onPose = callbacks.onPose; },
        stop() {},
        pause() {},
        resume() {},
      }),
      createAnalyzers: () => ({
        squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
        'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
        plank: { reset() {}, update: () => ({ elapsedMs: 0, state: 'waiting' }) },
        'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
        'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
        lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      }),
    });
    controller.setVoiceEnabled(true);
    await controller.start();
    emitReadyFrames(onPose, 'squats');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(speechEvents, ['welcome']);

    if (action === 'reset') {
      controller.reset();
    } else {
      await controller.end();
    }
    assert.equal(cancellationCount, 0);
    releaseActive(true);
    await flushSpeechQueue();
    assert.deepEqual(speechEvents, ['welcome']);
  }
});

test('rep event keys preserve distinct counts and the queue suppresses duplicate feedback', async () => {
  const queue = createSpeechQueue({ delay: async () => {} });
  const enqueueResults = [];
  const speechEvents = [];
  let releaseWelcome;
  let onPose;
  let count = 0;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    speechQueue: {
      enqueue(item) {
        const accepted = queue.enqueue(item);
        enqueueResults.push({ eventKey: item.eventKey, accepted });
        return accepted;
      },
      clearPending: () => queue.clearPending(),
      cancel: () => queue.cancel(),
    },
    speechCoach: {
      setEnabled() {},
      speak(messageId, text, language) {
        speechEvents.push({ messageId, text, language });
        if (messageId === 'welcome') {
          return new Promise((resolve) => { releaseWelcome = resolve; });
        }
        return true;
      },
      cancel() {},
    },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {},
      pause() {},
      resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update() { return { count, state: 'standing', feedbackId: 'adjust-alignment' }; } },
      'jumping-jacks': { reset() {}, update() { return { count: 0, state: 'closed' }; } },
      plank: { reset() {}, update() { return { elapsedMs: 0, state: 'waiting' }; } },
      'push-ups': { reset() {}, update() { return { count: 0, state: 'top' }; } },
      'sit-ups': { reset() {}, update() { return { count: 0, state: 'lowered' }; } },
      lunges: { reset() {}, update() { return { count: 0, state: 'standing' }; } },
    }),
  });
  controller.setGoal(10);
  controller.setCountEachRep(true);
  controller.setVoiceEnabled(true);
  await controller.start();
  await new Promise((resolve) => setImmediate(resolve));
  emitReadyFrames(onPose, 'squats');
  count = 1;
  onPose(createReadyLandmarks('squats'), 200);
  onPose(createReadyLandmarks('squats'), 233);
  count = 2;
  onPose(createReadyLandmarks('squats'), 266);
  onPose(createReadyLandmarks('squats'), 299);

  const repetitionKeys = enqueueResults
    .map(({ eventKey }) => JSON.parse(eventKey))
    .filter(([messageId]) => messageId === 'repetition-count');
  assert.equal(repetitionKeys.length, 2);
  assert.deepEqual(repetitionKeys.map(([, , , parameters]) => parameters.count), [1, 2]);
  const correctionResults = enqueueResults.filter(({ eventKey }) =>
    JSON.parse(eventKey)[0] === 'adjust-alignment',
  );
  assert.equal(correctionResults.filter(({ accepted }) => accepted).length, 1);
  assert.ok(correctionResults.some(({ accepted }) => !accepted));

  releaseWelcome(true);
  await flushSpeechQueue();
  assert.deepEqual(
    speechEvents.filter(({ messageId }) => messageId === 'repetition-count').map(({ text }) => text),
    ['1.', '2.'],
  );
  assert.equal(speechEvents.filter(({ messageId }) => messageId === 'adjust-alignment').length, 1);
});

test('workout instructions use the selected exercise phrase for all six exercises', async () => {
  const exercises = Object.entries(EXERCISE_INSTRUCTION_IDS);
  for (const [exerciseId, instructionId] of exercises) {
    const speechEvents = [];
    let onPose;
    const controller = createWorkoutController({
      video: {},
      canvas: {},
      speechQueue: createSpeechQueue({ delay: async () => {} }),
      speechCoach: {
        setEnabled() {},
        speak(messageId, text, language) {
          speechEvents.push({ messageId, text, language });
          return true;
        },
        cancel() {},
      },
      startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
      stopCamera() {},
      createPoseTracker: (callbacks) => ({
        async start() { onPose = callbacks.onPose; },
        stop() {},
        pause() {},
        resume() {},
      }),
      createAnalyzers: () => ({
        squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
        'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
        plank: { reset() {}, update: () => ({ elapsedMs: 0, state: 'waiting' }) },
        'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
        'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
        lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      }),
    });
    controller.selectExercise(exerciseId);
    controller.setVoiceEnabled(true);
    await controller.start();
    emitReadyFrames(onPose, exerciseId);
    await flushSpeechQueue();

    const instruction = speechEvents.find(({ messageId }) => messageId === instructionId);
    assert.ok(instruction, `${exerciseId} instruction was not spoken`);
    assert.equal(instruction.text, translateMessage(instructionId, 'en').text);
    for (const [, otherInstructionId] of exercises) {
      if (otherInstructionId !== instructionId) {
        assert.ok(!instruction.text.includes(translateMessage(otherInstructionId, 'en').text));
      }
    }
  }
});

test('workout speech uses the selected locale across all five supported languages', async () => {
  for (const language of ['en', 'yo', 'ig', 'ha', 'pcm']) {
    const browserSpeech = [];
    const synthesisRequests = [];
    const playedBlobs = [];
    const voice = `${language}-voice`;
    let onPose;
    const controller = createWorkoutController({
      video: {},
      canvas: {},
      speechQueue: createSpeechQueue({ delay: async () => {} }),
      audioCoach: {
        async listVoices() {
          return [{ id: voice, languages: [language], isDefault: true }];
        },
        async synthesizeAudio(payload) {
          synthesisRequests.push(payload);
          return new Blob(['audio']);
        },
      },
      voicePlayback: {
        async play(blob) { playedBlobs.push(blob); return true; },
        setMuted() {},
        setVolume() {},
      },
      speechCoach: {
        setEnabled() {},
        speak(messageId, text, languageCode) {
          browserSpeech.push({ messageId, text, languageCode });
          return true;
        },
        cancel() {},
      },
      startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
      stopCamera() {},
      createPoseTracker: (callbacks) => ({
        async start() { onPose = callbacks.onPose; },
        stop() {},
        pause() {},
        resume() {},
      }),
      createAnalyzers: () => ({
        squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
        'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
        plank: { reset() {}, update: () => ({ elapsedMs: 0, state: 'waiting' }) },
        'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
        'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
        lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      }),
    });
    controller.setLanguage(language);
    controller.setVoiceEnabled(true);
    await controller.refreshVoiceCatalog();
    await controller.start();
    emitReadyFrames(onPose, 'squats');
    await flushSpeechQueue();

    if (language === 'en') {
      assert.ok(browserSpeech.some(({ messageId, languageCode }) =>
        messageId === 'workout-countdown' && languageCode === language,
      ));
      assert.equal(synthesisRequests.length, 0);
    } else {
      assert.ok(synthesisRequests.length > 0);
      assert.ok(synthesisRequests.every((request) =>
        request.language === language && request.voice === voice,
      ));
      assert.equal(playedBlobs.length, synthesisRequests.length);
      assert.equal(browserSpeech.length, 0);
    }
  }
});

test('plank five-second cue uses elapsed progress and its actual target', async () => {
  const queue = createSpeechQueue({ delay: async () => {} });
  const queuedEvents = [];
  const speechEvents = [];
  let elapsedMs = 0;
  let onPose;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    speechQueue: {
      enqueue(item) {
        queuedEvents.push(item);
        return queue.enqueue(item);
      },
      clearPending: () => queue.clearPending(),
      cancel: () => queue.cancel(),
    },
    speechCoach: {
      setEnabled() {},
      speak(messageId, text, language) {
        speechEvents.push({ messageId, text, language });
        return true;
      },
      cancel() {},
    },
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {},
      pause() {},
      resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
      'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
      plank: { reset() {}, update: () => ({ elapsedMs, active: true, state: 'aligned' }) },
      'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
      'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
      lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
    }),
  });
  controller.selectExercise('plank');
  controller.setGoal(10);
  controller.setVoiceEnabled(true);
  await controller.start();
  emitReadyFrames(onPose, 'plank');
  elapsedMs = 4000;
  onPose(createReadyLandmarks('plank'), 100);
  elapsedMs = 5000;
  onPose(createReadyLandmarks('plank'), 200);
  await flushSpeechQueue();

  const cueEvent = queuedEvents.find(({ eventKey }) =>
    JSON.parse(eventKey)[0] === 'plank-five-seconds-left',
  );
  assert.ok(cueEvent);
  assert.deepEqual(JSON.parse(cueEvent.eventKey)[3], { count: 5, target: 10 });
  assert.ok(speechEvents.some(({ messageId }) => messageId === 'plank-five-seconds-left'));
});

test('language changes re-render the last coaching event with its parameters', async () => {
  let count = 0;
  let onPose;
  const controller = createWorkoutController({
    video: {},
    canvas: {},
    speechQueue: createSpeechQueue({ delay: async () => {} }),
    startCamera: async () => ({ getTracks: () => [], getVideoTracks: () => [] }),
    stopCamera() {},
    createPoseTracker: (callbacks) => ({
      async start() { onPose = callbacks.onPose; },
      stop() {},
      pause() {},
      resume() {},
    }),
    createAnalyzers: () => ({
      squats: { reset() {}, update() { return { count, state: 'standing' }; } },
      'jumping-jacks': { reset() {}, update: () => ({ count: 0, state: 'closed' }) },
      plank: { reset() {}, update: () => ({ elapsedMs: 0, state: 'waiting' }) },
      'push-ups': { reset() {}, update: () => ({ count: 0, state: 'top' }) },
      'sit-ups': { reset() {}, update: () => ({ count: 0, state: 'lowered' }) },
      lunges: { reset() {}, update: () => ({ count: 0, state: 'standing' }) },
    }),
  });
  controller.setGoal(4);
  await controller.start();
  emitReadyFrames(onPose, 'squats');
  count = 1;
  onPose(createReadyLandmarks('squats'), 100);

  assert.equal(controller.getState().feedbackId, 'milestone-reps');
  controller.setLanguage('yo');
  assert.equal(
    controller.getState().feedback,
    translateMessage('milestone-reps', 'yo', { count: 1, target: 4 }).text,
  );
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
