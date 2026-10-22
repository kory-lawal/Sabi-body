import { isVisible } from './geometry.js';

const VISIBILITY_THRESHOLD = 0.55;
const CLOSED_ANKLE_TO_HIP_WIDTH_RATIO = 1.15;
const OPEN_ANKLE_TO_HIP_WIDTH_RATIO = 1.35;
const REQUIRED_LANDMARK_INDICES = [11, 12, 15, 16, 23, 24, 27, 28];

function classifyPose(landmarks) {
  if (
    !Array.isArray(landmarks) ||
    !REQUIRED_LANDMARK_INDICES.every((index) =>
      isVisible(landmarks[index], VISIBILITY_THRESHOLD),
    )
  ) {
    return null;
  }

  const hipWidth = Math.abs(landmarks[23].x - landmarks[24].x);
  if (hipWidth === 0) {
    return null;
  }

  const ankleWidth = Math.abs(landmarks[27].x - landmarks[28].x);
  const ankleWidthRatio = ankleWidth / hipWidth;
  const armsClosed =
    landmarks[15].y > landmarks[11].y &&
    landmarks[16].y > landmarks[12].y;
  const armsOpen =
    landmarks[15].y < landmarks[11].y &&
    landmarks[16].y < landmarks[12].y;

  if (
    armsClosed &&
    ankleWidthRatio <= CLOSED_ANKLE_TO_HIP_WIDTH_RATIO
  ) {
    return 'closed';
  }
  if (armsOpen && ankleWidthRatio >= OPEN_ANKLE_TO_HIP_WIDTH_RATIO) {
    return 'open';
  }
  return 'partial';
}

export function createJumpingJackAnalyzer() {
  let count = 0;
  let state = 'waiting-for-closed';

  function update(landmarks) {
    const pose = classifyPose(landmarks);
    if (pose === null) {
      return { count, state, feedbackId: 'body-not-visible' };
    }

    if (state === 'waiting-for-closed') {
      if (pose === 'closed') {
        state = 'closed';
      }
    } else if (state === 'closed' && pose === 'open') {
      state = 'open';
    } else if (state === 'open' && pose === 'closed') {
      count += 1;
      state = 'closed';
      return { count, state, feedbackId: 'great-job' };
    }

    return {
      count,
      state,
      feedbackId: state === 'open' ? 'keep-going' : 'return-to-start',
    };
  }

  function reset() {
    count = 0;
    state = 'waiting-for-closed';
  }

  return { update, reset };
}
