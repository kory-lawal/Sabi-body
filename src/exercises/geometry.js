const FULL_BODY_LANDMARK_INDICES = [0, 11, 12, 23, 24, 25, 26, 27, 28];

function isPoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
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
