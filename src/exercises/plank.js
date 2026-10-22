import { angleAt, isVisible } from './geometry.js';

const VISIBILITY_THRESHOLD = 0.55;
const ALIGNMENT_TOLERANCE_DEGREES = 20;
const MAX_INTERVAL_MS = 200;

const SIDES = [
  { shoulder: 11, hip: 23, ankle: 27 },
  { shoulder: 12, hip: 24, ankle: 28 },
];

function sideAngle(landmarks, indices) {
  const points = [
    landmarks?.[indices.shoulder],
    landmarks?.[indices.hip],
    landmarks?.[indices.ankle],
  ];

  if (!points.every((point) => isVisible(point, VISIBILITY_THRESHOLD))) {
    return null;
  }

  return angleAt(points[0], points[1], points[2]);
}

function plankAngle(landmarks) {
  for (const side of SIDES) {
    const angle = sideAngle(landmarks, side);
    if (angle !== null) {
      return angle;
    }
  }
  return null;
}

export function createPlankAnalyzer() {
  let elapsedMs = 0;
  let previousAlignedAt = null;

  function update(landmarks, nowMs) {
    const angle = plankAngle(landmarks);

    if (angle === null) {
      previousAlignedAt = null;
      return {
        elapsedMs,
        active: false,
        state: 'body-not-visible',
        feedbackId: 'body-not-visible',
      };
    }

    if (Math.abs(angle - 180) > ALIGNMENT_TOLERANCE_DEGREES) {
      previousAlignedAt = null;
      return {
        elapsedMs,
        active: false,
        state: 'adjust-alignment',
        feedbackId: 'adjust-alignment',
      };
    }

    if (Number.isFinite(nowMs)) {
      if (previousAlignedAt !== null) {
        const interval = nowMs - previousAlignedAt;
        elapsedMs += Math.max(0, Math.min(MAX_INTERVAL_MS, interval));
      }
      previousAlignedAt = nowMs;
    } else {
      previousAlignedAt = null;
    }

    return {
      elapsedMs,
      active: true,
      state: 'aligned',
      feedbackId: 'aligned',
    };
  }

  function reset() {
    elapsedMs = 0;
    previousAlignedAt = null;
  }

  return { update, reset };
}
