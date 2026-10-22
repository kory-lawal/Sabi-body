import assert from 'node:assert/strict';
import test from 'node:test';

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { startCamera, stopCamera } from '../src/camera/camera.js';
import { drawPose } from '../src/pose/draw-pose.js';
import { createPoseTracker } from '../src/pose/pose-tracker.js';

function installGlobals(values) {
  const previous = new Map();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }

  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  };
}

function createMediaStream() {
  const tracks = [{ stopCount: 0 }, { stopCount: 0 }];

  for (const track of tracks) {
    track.stop = () => {
      track.stopCount += 1;
    };
  }

  return {
    tracks,
    getTracks: () => tracks,
  };
}

function createCanvasHarness() {
  const calls = [];
  const context = {
    beginPath: () => calls.push(['beginPath']),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    stroke: () => calls.push(['stroke']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => calls.push(['fill']),
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    set strokeStyle(value) {
      calls.push(['strokeStyle', value]);
    },
    set fillStyle(value) {
      calls.push(['fillStyle', value]);
    },
    set lineWidth(value) {
      calls.push(['lineWidth', value]);
    },
  };

  return {
    calls,
    canvas: {
      width: 0,
      height: 0,
      style: {},
      getContext: () => context,
    },
  };
}

test('startCamera requests user-facing video only and awaits playback', async () => {
  const stream = createMediaStream();
  const requests = [];
  let played = false;
  const restore = installGlobals({
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          requests.push(constraints);
          return stream;
        },
      },
    },
  });
  const video = {
    srcObject: null,
    async play() {
      played = true;
    },
  };

  try {
    assert.equal(await startCamera(video), stream);
    assert.deepEqual(requests, [{ video: { facingMode: 'user' }, audio: false }]);
    assert.equal(video.srcObject, stream);
    assert.equal(played, true);
  } finally {
    restore();
  }
});

test('startCamera stops acquired tracks and clears the source when playback fails', async () => {
  const stream = createMediaStream();
  const failure = new Error('playback blocked');
  const restore = installGlobals({
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          return stream;
        },
      },
    },
  });
  const video = {
    srcObject: null,
    async play() {
      throw failure;
    },
  };

  try {
    await assert.rejects(startCamera(video), /camera.*playback|playback.*camera/i);
    assert.equal(video.srcObject, null);
    assert.deepEqual(
      stream.tracks.map(({ stopCount }) => stopCount),
      [1, 1],
    );
  } finally {
    restore();
  }
});

test('stopCamera stops each track and clears the video source idempotently', () => {
  const stream = createMediaStream();
  const video = { srcObject: stream };

  stopCamera(stream, video);
  stopCamera(stream, video);

  assert.deepEqual(
    stream.tracks.map(({ stopCount }) => stopCount),
    [1, 1],
  );
  assert.equal(video.srcObject, null);
});

test('drawPose mirrors only visible pose points and uses device-pixel backing dimensions', () => {
  const { canvas, calls } = createCanvasHarness();
  const video = {
    videoWidth: 640,
    videoHeight: 480,
    clientWidth: 320,
    clientHeight: 240,
  };
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  landmarks[11] = { x: 0.25, y: 0.5, visibility: 0.9 };
  landmarks[12] = { x: 0.75, y: 0.5, visibility: 0.9 };
  const restore = installGlobals({ devicePixelRatio: 2 });

  try {
    drawPose(canvas, landmarks, video);
  } finally {
    restore();
  }

  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 960);
  assert.equal(canvas.style.width, '320px');
  assert.equal(canvas.style.height, '240px');
  assert.ok(calls.some(([name, ...args]) => name === 'scale' && args[0] === -1));
  assert.equal(calls.filter(([name]) => name === 'arc').length, 2);
  assert.ok(calls.some(([name, ...args]) => name === 'moveTo' && args[0] === 160));
  assert.ok(calls.some(([name, ...args]) => name === 'lineTo' && args[0] === 480));
});

test('drawPose omits landmarks without visibility or presence evidence', () => {
  const { canvas, calls } = createCanvasHarness();
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));

  drawPose(canvas, landmarks, {
    videoWidth: 640,
    videoHeight: 480,
    clientWidth: 320,
    clientHeight: 240,
  });

  assert.equal(calls.filter(([name]) => name === 'arc').length, 0);
  assert.equal(calls.filter(([name]) => name === 'moveTo').length, 0);
});

test('createPoseTracker initializes VIDEO mode once and maintains one resumable RAF loop', async () => {
  const originalForVisionTasks = FilesetResolver.forVisionTasks;
  const originalCreateFromOptions = PoseLandmarker.createFromOptions;
  const createdOptions = [];
  let closeCount = 0;
  let detectCount = 0;
  FilesetResolver.forVisionTasks = async () => ({ wasm: true });
  PoseLandmarker.createFromOptions = async (_fileset, options) => {
    createdOptions.push(options);
    return {
      detectForVideo(_video, timestamp) {
        detectCount += 1;
        return {
          landmarks: [[{ x: 0.5, y: 0.5, visibility: 1 }]],
          timestamp,
        };
      },
      close() {
        closeCount += 1;
      },
    };
  };

  let nextHandle = 1;
  const callbacks = new Map();
  const restore = installGlobals({
    requestAnimationFrame(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      callbacks.delete(handle);
    },
  });
  const { canvas } = createCanvasHarness();
  const video = {
    readyState: 2,
    currentTime: 1,
    videoWidth: 640,
    videoHeight: 480,
    clientWidth: 640,
    clientHeight: 480,
  };
  const poses = [];
  const tracker = createPoseTracker({
    onPose(landmarks, timestamp) {
      poses.push({ landmarks, timestamp });
    },
  });

  try {
    await tracker.start(video, canvas);
    assert.equal(createdOptions.length, 1);
    assert.equal(createdOptions[0].runningMode, 'VIDEO');
    assert.equal(createdOptions[0].numPoses, 1);
    assert.equal(callbacks.size, 1);

    const [firstHandle, firstCallback] = callbacks.entries().next().value;
    callbacks.delete(firstHandle);
    firstCallback(10);
    assert.equal(detectCount, 1);
    assert.equal(poses.length, 1);
    assert.equal(callbacks.size, 1);

    const [duplicateFrameHandle, duplicateFrameCallback] =
      callbacks.entries().next().value;
    callbacks.delete(duplicateFrameHandle);
    duplicateFrameCallback(20);
    assert.equal(detectCount, 1);

    video.currentTime = 2;
    const [newFrameHandle, newFrameCallback] = callbacks.entries().next().value;
    callbacks.delete(newFrameHandle);
    newFrameCallback(30);
    assert.equal(detectCount, 2);

    tracker.pause();
    assert.equal(callbacks.size, 0);
    tracker.resume();
    tracker.resume();
    assert.equal(callbacks.size, 1);

    tracker.stop();
    assert.equal(callbacks.size, 0);
    assert.equal(closeCount, 1);
  } finally {
    tracker.stop();
    restore();
    FilesetResolver.forVisionTasks = originalForVisionTasks;
    PoseLandmarker.createFromOptions = originalCreateFromOptions;
  }
});

test('createPoseTracker rejects initialization failures and reports them as errors', async () => {
  const originalForVisionTasks = FilesetResolver.forVisionTasks;
  const originalCreateFromOptions = PoseLandmarker.createFromOptions;
  const failure = new Error('WASM unavailable');
  FilesetResolver.forVisionTasks = async () => {
    throw failure;
  };
  PoseLandmarker.createFromOptions = async () => {
    throw new Error('must not create landmarker');
  };
  const errors = [];
  const tracker = createPoseTracker({
    onError(error) {
      errors.push(error);
    },
  });

  try {
    await assert.rejects(
      tracker.start({}, {}),
      /MediaPipe.*initialize|initialize.*MediaPipe/i,
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0].cause, failure);
  } finally {
    tracker.stop();
    FilesetResolver.forVisionTasks = originalForVisionTasks;
    PoseLandmarker.createFromOptions = originalCreateFromOptions;
  }
});

test('createPoseTracker closes the landmarker after inference fails and cannot silently restart', async () => {
  const originalForVisionTasks = FilesetResolver.forVisionTasks;
  const originalCreateFromOptions = PoseLandmarker.createFromOptions;
  const failure = new Error('frame decode failed');
  let closeCount = 0;
  FilesetResolver.forVisionTasks = async () => ({ wasm: true });
  PoseLandmarker.createFromOptions = async () => ({
    detectForVideo() {
      throw failure;
    },
    close() {
      closeCount += 1;
    },
  });

  let callback;
  const restore = installGlobals({
    requestAnimationFrame(nextCallback) {
      callback = nextCallback;
      return 1;
    },
    cancelAnimationFrame() {},
  });
  const errors = [];
  const tracker = createPoseTracker({
    onError(error) {
      errors.push(error);
    },
  });

  try {
    await tracker.start(
      {
        readyState: 2,
        currentTime: 1,
        videoWidth: 640,
        videoHeight: 480,
      },
      createCanvasHarness().canvas,
    );
    callback();

    assert.equal(errors.length, 1);
    assert.equal(errors[0].cause, failure);
    assert.equal(closeCount, 1);
    await assert.rejects(tracker.start({}, {}), /failed/i);
  } finally {
    tracker.stop();
    restore();
    FilesetResolver.forVisionTasks = originalForVisionTasks;
    PoseLandmarker.createFromOptions = originalCreateFromOptions;
  }
});
