import { distance, isVisible } from './geometry.js';

const REQUIRED_POINTS = [11, 12, 15, 16, 23, 24, 27, 28];
const OPEN_FEET_RATIO = 1.35;
const CLOSED_FEET_RATIO = 1.15;
const COUNT_COOLDOWN_MS = 500;
const TRACKING_GAP_MS = 500;

function measurePose(landmarks) {
  if (
    !Array.isArray(landmarks) ||
    !REQUIRED_POINTS.every((index) => isVisible(landmarks[index]))
  ) {
    return null;
  }

  const hipWidth = distance(landmarks[23], landmarks[24]);
  const ankleWidth = distance(landmarks[27], landmarks[28]);
  if (hipWidth === null || ankleWidth === null || hipWidth === 0) {
    return null;
  }

  const feetRatio = ankleWidth / hipWidth;
  const armsOpen =
    landmarks[15].y < landmarks[11].y &&
    landmarks[16].y < landmarks[12].y;
  const armsClosed =
    landmarks[15].y >= landmarks[11].y &&
    landmarks[16].y >= landmarks[12].y;
  return {
    open: armsOpen && feetRatio > OPEN_FEET_RATIO,
    closed: armsClosed && feetRatio < CLOSED_FEET_RATIO,
    feetRatio,
  };
}

export function createJumpingJackAnalyzer() {
  let count = 0;
  let ready = false;
  let opened = false;
  let cooldownUntil = -Infinity;
  let lastUsableAt = null;

  function invalidatePhase() {
    ready = false;
    opened = false;
    lastUsableAt = null;
  }

  function reset() {
    count = 0;
    cooldownUntil = -Infinity;
    invalidatePhase();
  }

  function output({
    formValid = true,
    rejectionReasonId = null,
    feedbackId,
    metrics = {},
  } = {}) {
    const state = opened ? 'open' : 'closed';
    return {
      count,
      state,
      phase: state,
      formValid,
      rejectionReasonId,
      feedbackId,
      metrics,
    };
  }

  function update(
    landmarks,
    timestamp = globalThis.performance?.now?.() ?? Date.now(),
  ) {
    const pose = measurePose(landmarks);
    if (!pose) {
      if (
        lastUsableAt !== null &&
        (timestamp < lastUsableAt ||
          timestamp - lastUsableAt >= TRACKING_GAP_MS)
      ) {
        invalidatePhase();
      }
      return output({
        formValid: false,
        rejectionReasonId: 'missing-landmarks',
        feedbackId: 'body-not-visible',
      });
    }

    if (
      lastUsableAt !== null &&
      (timestamp < lastUsableAt ||
        timestamp - lastUsableAt >= TRACKING_GAP_MS)
    ) {
      invalidatePhase();
    }
    lastUsableAt = timestamp;

    if (pose.closed && timestamp >= cooldownUntil && !opened) {
      ready = true;
    } else if (ready && pose.open) {
      opened = true;
      ready = false;
    } else if (opened && pose.closed) {
      if (timestamp >= cooldownUntil) {
        count += 1;
        cooldownUntil = timestamp + COUNT_COOLDOWN_MS;
        opened = false;
        return output({
          feedbackId: 'jumping-jack-completed',
          metrics: { feetRatio: pose.feetRatio },
        });
      }
      opened = false;
      ready = false;
    }

    return output({
      formValid: pose.open || pose.closed,
      rejectionReasonId: pose.open || pose.closed ? null : 'incomplete-pose',
      feedbackId: opened ? 'jack-return-closed' : 'return-to-start',
      metrics: { feetRatio: pose.feetRatio },
    });
  }

  return { update, reset, invalidatePhase };
}
