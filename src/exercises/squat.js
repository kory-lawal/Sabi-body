import { angleAt, isVisible } from './geometry.js';

const STANDING_ANGLE = 160;
const SQUAT_DEPTH_ANGLE = 110;
const VISIBILITY_THRESHOLD = 0.55;

const LANDMARKS_BY_SIDE = [
  { hip: 23, knee: 25, ankle: 27 },
  { hip: 24, knee: 26, ankle: 28 },
];

function visibilityScore(landmark) {
  return Math.max(
    Number.isFinite(landmark.visibility) ? landmark.visibility : -Infinity,
    Number.isFinite(landmark.presence) ? landmark.presence : -Infinity,
  );
}

function reliableSide(landmarks, indices) {
  const hip = landmarks?.[indices.hip];
  const knee = landmarks?.[indices.knee];
  const ankle = landmarks?.[indices.ankle];
  const points = [hip, knee, ankle];

  if (!points.every((point) => isVisible(point, VISIBILITY_THRESHOLD))) {
    return null;
  }

  const kneeAngle = angleAt(hip, knee, ankle);
  if (kneeAngle === null) {
    return null;
  }

  return {
    angle: kneeAngle,
    confidence: Math.min(...points.map(visibilityScore)),
  };
}

export function createSquatAnalyzer() {
  let count = 0;
  let state = 'waiting-for-standing';

  function update(landmarks) {
    const sides = LANDMARKS_BY_SIDE
      .map((indices) => reliableSide(landmarks, indices))
      .filter(Boolean);

    if (sides.length === 0) {
      return { count, state, feedbackId: 'body-not-visible' };
    }

    const angle =
      sides.length === 2
        ? (sides[0].angle + sides[1].angle) / 2
        : sides.sort((a, b) => b.confidence - a.confidence)[0].angle;

    if (state === 'waiting-for-standing') {
      if (angle >= STANDING_ANGLE) {
        state = 'standing';
      }
    } else if (state === 'standing') {
      if (angle < STANDING_ANGLE) {
        state = 'lowering';
        if (angle <= SQUAT_DEPTH_ANGLE) {
          state = 'bottom';
        }
      }
    } else if (state === 'lowering') {
      if (angle <= SQUAT_DEPTH_ANGLE) {
        state = 'bottom';
      } else if (angle >= STANDING_ANGLE) {
        state = 'standing';
      }
    } else if (state === 'bottom') {
      if (angle > SQUAT_DEPTH_ANGLE) {
        state = 'returning';
      }
    } else if (state === 'returning') {
      if (angle <= SQUAT_DEPTH_ANGLE) {
        state = 'bottom';
      } else if (angle >= STANDING_ANGLE) {
        count += 1;
        state = 'standing';
        return { count, state, feedbackId: 'great-job' };
      }
    }

    const feedbackByState = {
      'waiting-for-standing': 'return-to-start',
      standing: 'return-to-start',
      lowering: 'move-lower',
      bottom: 'keep-going',
      returning: 'return-to-start',
    };

    return { count, state, feedbackId: feedbackByState[state] };
  }

  function reset() {
    count = 0;
    state = 'waiting-for-standing';
  }

  return { update, reset };
}
