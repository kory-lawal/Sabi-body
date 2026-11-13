import { isVisible } from './geometry.js';

const START_ANGLE = 20;
const RISE_ANGLE = 55;
const RETURN_ANGLE = 20;
const COUNT_COOLDOWN_MS = 500;
const TRACKING_GAP_MS = 500;

const SIDES = [
  { name: 'left', shoulder: 11, hip: 23 },
  { name: 'right', shoulder: 12, hip: 24 },
];

function measureTrunk(landmarks) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  for (const side of SIDES) {
    const shoulder = landmarks[side.shoulder];
    const hip = landmarks[side.hip];
    if (
      isVisible(shoulder) &&
      isVisible(hip)
    ) {
      const horizontal = Math.abs(shoulder.x - hip.x);
      const vertical = Math.abs(shoulder.y - hip.y);
      if (horizontal === 0 && vertical === 0) {
        continue;
      }
      return {
        side: side.name,
        angle: (Math.atan2(vertical, horizontal) * 180) / Math.PI,
      };
    }
  }
  return null;
}

export function createSitUpAnalyzer() {
  let count = 0;
  let armed = false;
  let raised = false;
  let cooldownUntil = -Infinity;
  let lastUsableAt = null;

  function invalidatePhase() {
    armed = false;
    raised = false;
    lastUsableAt = null;
  }

  function reset() {
    count = 0;
    cooldownUntil = -Infinity;
    invalidatePhase();
  }

  function output({
    formValid = true,
    feedbackId,
    rejectionReasonId = null,
    metrics = {},
  } = {}) {
    const state = raised ? 'raised' : 'lowered';
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
    const trunk = measureTrunk(landmarks);
    if (!trunk) {
      if (
        lastUsableAt !== null &&
        (timestamp < lastUsableAt ||
          timestamp - lastUsableAt >= TRACKING_GAP_MS)
      ) {
        invalidatePhase();
      }
      return output({
        formValid: false,
        feedbackId: 'body-not-visible',
        rejectionReasonId: 'missing-landmarks',
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

    if (!raised && timestamp >= cooldownUntil && trunk.angle <= START_ANGLE) {
      armed = true;
    }

    if (armed && trunk.angle >= RISE_ANGLE) {
      raised = true;
      armed = false;
    } else if (raised && trunk.angle <= RETURN_ANGLE) {
      count += 1;
      raised = false;
      armed = false;
      cooldownUntil = timestamp + COUNT_COOLDOWN_MS;
      return output({
        feedbackId: 'great-job',
        metrics: { side: trunk.side, trunkAngle: trunk.angle },
      });
    }

    return output({
      feedbackId: raised ? 'return-to-start' : 'great-job',
      metrics: { side: trunk.side, trunkAngle: trunk.angle },
    });
  }

  return { update, reset, invalidatePhase };
}
