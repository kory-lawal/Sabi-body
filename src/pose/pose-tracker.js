import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { drawPose } from './draw-pose.js';

const WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

function asError(error, prefix) {
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`, { cause: error });
  }
  return new Error(`${prefix}: ${String(error)}`, { cause: error });
}

export function createPoseTracker({ onPose, onError } = {}) {
  let state = 'idle';
  let paused = false;
  let frameHandle = null;
  let startPromise = null;
  let landmarker = null;
  let videoElement = null;
  let canvasElement = null;
  let lastVideoTime = -1;

  function cancelFrame() {
    if (frameHandle !== null) {
      globalThis.cancelAnimationFrame?.(frameHandle);
      frameHandle = null;
    }
  }

  function closeLandmarker() {
    if (!landmarker) {
      return;
    }

    const activeLandmarker = landmarker;
    landmarker = null;
    try {
      activeLandmarker.close();
    } catch {
      // Resource cleanup should not mask the original tracking error.
    }
  }

  function reportError(error) {
    try {
      onError?.(error);
    } catch {
      // Consumer callbacks must not interrupt tracker cleanup.
    }
  }

  function fail(error, prefix) {
    if (state === 'stopped' || state === 'failed') {
      return;
    }

    state = 'failed';
    cancelFrame();
    closeLandmarker();
    reportError(asError(error, prefix));
  }

  function scheduleFrame() {
    if (state !== 'running' || frameHandle !== null) {
      return;
    }

    if (typeof globalThis.requestAnimationFrame !== 'function') {
      throw new Error('Animation frames are unavailable in this browser.');
    }

    frameHandle = globalThis.requestAnimationFrame(() => {
      frameHandle = null;
      if (state !== 'running') {
        return;
      }

      try {
        const readyStateThreshold = videoElement.HAVE_CURRENT_DATA ?? 2;
        if (
          videoElement.readyState >= readyStateThreshold &&
          videoElement.currentTime !== lastVideoTime
        ) {
          const timestamp = globalThis.performance.now();
          const result = landmarker.detectForVideo(videoElement, timestamp);
          lastVideoTime = videoElement.currentTime;
          const landmarks = result.landmarks?.[0] ?? [];

          drawPose(canvasElement, landmarks, videoElement);
          onPose?.(landmarks, timestamp);
        }

        scheduleFrame();
      } catch (error) {
        fail(error, 'Unable to process a camera frame');
      }
    });
  }

  async function start(video, canvas) {
    if (state === 'stopped') {
      throw new Error('Cannot start a stopped pose tracker.');
    }
    if (state === 'failed') {
      throw new Error('Cannot restart a failed pose tracker.');
    }
    if (startPromise) {
      return startPromise;
    }
    if (state === 'running' || state === 'paused') {
      return;
    }

    videoElement = video;
    canvasElement = canvas;
    state = 'initializing';

    startPromise = (async () => {
      try {
        if (!videoElement || !canvasElement) {
          throw new Error('A video element and canvas are required.');
        }

        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        if (state === 'stopped') {
          throw new Error('Pose tracker stopped during initialization.');
        }

        const initializedLandmarker = await PoseLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: { modelAssetPath: MODEL_ASSET_PATH },
            runningMode: 'VIDEO',
            numPoses: 1,
          },
        );

        if (state === 'stopped') {
          initializedLandmarker.close();
          throw new Error('Pose tracker stopped during initialization.');
        }

        landmarker = initializedLandmarker;
        state = paused ? 'paused' : 'running';
        scheduleFrame();
      } catch (error) {
        if (state !== 'stopped') {
          state = 'failed';
          cancelFrame();
          closeLandmarker();
          reportError(asError(error, 'Unable to initialize MediaPipe pose tracking'));
        }
        throw asError(error, 'Unable to initialize MediaPipe pose tracking');
      }
    })();

    return startPromise;
  }

  function pause() {
    paused = true;
    if (state === 'running') {
      state = 'paused';
      cancelFrame();
    }
  }

  function resume() {
    if (state === 'stopped' || state === 'failed') {
      return;
    }

    paused = false;
    if (state === 'paused' && landmarker) {
      state = 'running';
      scheduleFrame();
    }
  }

  function stop() {
    if (state === 'stopped') {
      return;
    }

    state = 'stopped';
    cancelFrame();
    closeLandmarker();
  }

  return { start, pause, resume, stop };
}
