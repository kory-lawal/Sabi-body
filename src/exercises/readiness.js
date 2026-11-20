export function createStartPoseGate(
  measureStartPose,
  { stableMs = 400, gapMs = 500 } = {},
) {
  if (typeof measureStartPose !== 'function') {
    throw new TypeError('measureStartPose must be a function.');
  }

  let readySince = null;
  let lastTimestamp = null;

  function reset() {
    readySince = null;
    lastTimestamp = null;
  }

  function check(landmarks, timestamp) {
    const measurement = measureStartPose(landmarks);
    if (measurement === null || typeof measurement !== 'object') {
      throw new TypeError('measureStartPose must return a measurement object.');
    }

    if (!Number.isFinite(timestamp) || !measurement.poseReady) {
      reset();
      return { ...measurement, ready: false };
    }

    if (
      lastTimestamp !== null &&
      (timestamp < lastTimestamp || timestamp - lastTimestamp >= gapMs)
    ) {
      readySince = timestamp;
    } else {
      readySince ??= timestamp;
    }
    lastTimestamp = timestamp;

    return {
      ...measurement,
      ready: timestamp - readySince >= stableMs,
    };
  }

  return { check, reset };
}
