const FULL_BODY_LANDMARK_INDICES = [0, 11, 12, 23, 24, 25, 26, 27, 28];

function isPoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function angleAt(a, b, c) {
  if (![a, b, c].every(isPoint)) {
    return null;
  }

  const firstX = a.x - b.x;
  const firstY = a.y - b.y;
  const secondX = c.x - b.x;
  const secondY = c.y - b.y;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);

  if (firstLength === 0 || secondLength === 0) {
    return null;
  }

  const cosine =
    (firstX * secondX + firstY * secondY) / (firstLength * secondLength);
  const clampedCosine = Math.max(-1, Math.min(1, cosine));
  return (Math.acos(clampedCosine) * 180) / Math.PI;
}

export function getLandmarkConfidence(landmark) {
  if (landmark === null || typeof landmark !== 'object') {
    return null;
  }

  const scores = [landmark.visibility, landmark.presence].filter(
    Number.isFinite,
  );
  return scores.length ? Math.min(...scores) : null;
}

export function isVisible(landmark, threshold = 0.6) {
  if (
    !isPoint(landmark) ||
    landmark.x < 0 ||
    landmark.x > 1 ||
    landmark.y < 0 ||
    landmark.y > 1
  ) {
    return false;
  }

  const confidence = getLandmarkConfidence(landmark);
  return confidence !== null && confidence >= threshold;
}

export function distance(a, b) {
  if (![a, b].every(isPoint)) {
    return null;
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function hasFullBodyVisible(landmarks) {
  return (
    Array.isArray(landmarks) &&
    FULL_BODY_LANDMARK_INDICES.every((index) =>
      isVisible(landmarks[index], 0.55),
    )
  );
}

export function createLandmarkSmoother() {
  const windowSize = 3;
  let samples = [];
  let lastTimestamp = null;

  function reset() {
    samples = [];
    lastTimestamp = null;
  }

  function update(landmarks, timestamp) {
    if (!Array.isArray(landmarks) || !Number.isFinite(timestamp)) {
      reset();
      return landmarks;
    }

    if (
      lastTimestamp !== null &&
      (timestamp < lastTimestamp || timestamp - lastTimestamp >= 500)
    ) {
      reset();
    }
    lastTimestamp = timestamp;

    return landmarks.map((landmark, index) => {
      if (!isVisible(landmark)) {
        samples[index] = [];
        return landmark;
      }

      const history = samples[index] ?? (samples[index] = []);
      history.push({ x: landmark.x, y: landmark.y });
      if (history.length > windowSize) {
        history.shift();
      }

      const position =
        history.length === 2
          ? history[0]
          : {
              x: median(history.map((sample) => sample.x)),
              y: median(history.map((sample) => sample.y)),
            };

      return {
        ...landmark,
        x: position.x,
        y: position.y,
      };
    });
  }

  return { update, reset };
}
