import assert from 'node:assert/strict';
import test from 'node:test';

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { startCamera, stopCamera } from '../src/camera/camera.js';
import { drawPose } from '../src/pose/draw-pose.js';
import { createPoseTracker } from '../src/pose/pose-tracker.js';

let activeCanvasCalls = [];

class TestPath2D {
  moveTo(...args) { activeCanvasCalls.push(['moveTo', ...args]); }
  lineTo(...args) { activeCanvasCalls.push(['lineTo', ...args]); }
  arc(...args) { activeCanvasCalls.push(['arc', ...args]); }
}

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
  activeCanvasCalls = calls;
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
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
  };
  context.canvas = canvas;

  return {
    calls,
    canvas,
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
    assert.deepEqual(requests, [{ video: { facingMode: { ideal: 'user' } }, audio: false }]);
    assert.equal(video.srcObject, stream);
    assert.equal(played, true);
  } finally {
    restore();
  }
});

test('startCamera falls back to an available camera when the preferred constraint is unsupported', async () => {
  const stream = createMediaStream();
  const requests = [];
  const restore = installGlobals({
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          requests.push(constraints);
          if (requests.length === 1) {
            const error = new Error('facing mode unsupported');
            error.name = 'OverconstrainedError';
            throw error;
          }
          return stream;
        },
      },
    },
  });
  const video = {
    srcObject: null,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    async play() {
      this.readyState = 2;
      this.videoWidth = 640;
      this.videoHeight = 480;
    },
  };

  try {
    assert.equal(await startCamera(video), stream);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { video: true, audio: false });
  } finally {
    restore();
  }
});

test('startCamera waits until video metadata and a decoded frame are available', async () => {
  const stream = createMediaStream();
  const restore = installGlobals({
    navigator: {
      mediaDevices: {
        async getUserMedia() { return stream; },
      },
    },
  });
  let releaseReadiness;
  const video = {
    srcObject: null,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    listeners: new Map(),
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
      if (name === 'loadeddata') {
        releaseReadiness = () => {
          this.readyState = 2;
          this.videoWidth = 640;
          this.videoHeight = 480;
          callback();
        };
      }
    },
    removeEventListener(name) { this.listeners.delete(name); },
    async play() {},
  };

  try {
    let settled = false;
    const start = startCamera(video).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseReadiness();
    assert.equal(await start, stream);
  } finally {
    restore();
  }
});

test('camera permission failures expose a blocked status', async () => {
  const restore = installGlobals({
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          const error = new Error('permission denied');
          error.name = 'NotAllowedError';
          throw error;
        },
      },
    },
  });

  try {
    await assert.rejects(startCamera({}), (error) => {
      assert.equal(error.cameraStatus, 'Camera Blocked');
      return true;
    });
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
  landmarks[13] = { x: 0.2, y: 0.6, visibility: 0.9 };
  const restore = installGlobals({
    devicePixelRatio: 2,
    CanvasRenderingContext2D: Object,
    OffscreenCanvasRenderingContext2D: class {},
    Path2D: TestPath2D,
  });

  try {
    drawPose(canvas, landmarks, video, {
      readinessReady: true,
      formValid: true,
    });
  } finally {
    restore();
  }

  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 960);
  assert.equal(canvas.style.width, '320px');
  assert.equal(canvas.style.height, '240px');
  assert.equal(calls.some(([name, ...args]) => name === 'scale' && args[0] === -1), false);
  assert.equal(calls.filter(([name]) => name === 'arc').length, 3);
  assert.ok(calls.some(([name, value]) => name === 'strokeStyle' && value === '#61d095'));
  assert.ok(calls.some(([name, value]) => name === 'fillStyle' && value === '#61d095'));
  assert.ok(calls.some(([name, ...args]) => name === 'moveTo' && args[0] === 320));
  assert.ok(calls.some(([name, ...args]) => name === 'lineTo' && args[0] === 256));
});

test('drawPose omits landmarks without visibility or presence evidence', () => {
  const { canvas, calls } = createCanvasHarness();
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));

  const restore = installGlobals({
    CanvasRenderingContext2D: Object,
    OffscreenCanvasRenderingContext2D: class {},
    Path2D: TestPath2D,
  });

  try {
    drawPose(canvas, landmarks, {
      videoWidth: 640,
      videoHeight: 480,
      clientWidth: 320,
      clientHeight: 240,
    });
    assert.equal(calls.filter(([name]) => name === 'arc').length, 0);
    assert.equal(calls.filter(([name]) => name === 'moveTo').length, 0);
  } finally {
    restore();
  }
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
          worldLandmarks: [[{ x: 0.1, y: 0.2, z: -0.3, visibility: 1 }]],
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
    onPose(landmarks, timestamp, worldLandmarks) {
      poses.push({ landmarks, timestamp, worldLandmarks });
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
    assert.deepEqual(poses[0].worldLandmarks, [
      { x: 0.1, y: 0.2, z: -0.3, visibility: 1 },
    ]);
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

test('createPoseTracker uses local WASM and retries CPU when GPU initialization fails', async () => {
  const originalForVisionTasks = FilesetResolver.forVisionTasks;
  const originalCreateFromOptions = PoseLandmarker.createFromOptions;
  const wasmPaths = [];
  const delegates = [];
  FilesetResolver.forVisionTasks = async (path) => {
    wasmPaths.push(path);
    return { wasm: true };
  };
  PoseLandmarker.createFromOptions = async (_fileset, options) => {
    delegates.push(options.baseOptions.delegate);
    if (options.baseOptions.delegate === 'GPU') {
      throw new Error('GPU delegate unavailable');
    }
    return { detectForVideo: () => ({ landmarks: [] }), close() {} };
  };
  const restore = installGlobals({ requestAnimationFrame: () => 1, cancelAnimationFrame() {} });
  const tracker = createPoseTracker();

  try {
    await tracker.start(
      { readyState: 2, currentTime: 1, videoWidth: 640, videoHeight: 480 },
      createCanvasHarness().canvas,
    );
    assert.deepEqual(wasmPaths, ['/mediapipe/wasm']);
    assert.deepEqual(delegates, ['GPU', 'CPU']);
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
