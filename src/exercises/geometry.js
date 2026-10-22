const FULL_BODY_LANDMARK_INDICES = [0, 11, 12, 23, 24, 25, 26, 27, 28];

export function angleAt(a, b, c) {
  if (![a, b, c].every(
    (point) =>
      point !== null &&
      typeof point === 'object' &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y),
  )) {
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

export function isVisible(landmark, threshold = 0.55) {
  if (
    landmark === null ||
    typeof landmark !== 'object' ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y)
  ) {
    return false;
  }

  const scores = [landmark.visibility, landmark.presence].filter(
    Number.isFinite,
  );
  return scores.length > 0 && Math.max(...scores) >= threshold;
}

export function hasFullBodyVisible(landmarks) {
  return (
    Array.isArray(landmarks) &&
    FULL_BODY_LANDMARK_INDICES.every((index) =>
      isVisible(landmarks[index]),
    )
  );
}
