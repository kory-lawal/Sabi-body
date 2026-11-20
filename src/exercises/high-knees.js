import { angleAt, isVisible } from './geometry.js';
import { createStartPoseGate } from './readiness.js';

const START_ANGLE = 145;
const RETURN_BELOW_HIP = 0.04;
const TRACKING_GAP_MS = 500;
const COUNT_COOLDOWN_MS = 250;

const SIDES = [
  { name: 'left', hip: 23, knee: 25, ankle: 27 },
  { name: 'right', hip: 24, knee: 26, ankle: 28 },
];

function measureLegs(landmarks) {
  const measurements = {};
  if (!Array.isArray(landmarks)) {
    return measurements;
  }

  for (const side of SIDES) {
    const hip = landmarks[side.hip];
    const knee = landmarks[side.knee];
    const ankle = landmarks[side.ankle];
    if (![hip, knee, ankle].every((landmark) => isVisible(landmark))) {
      continue;
    }

    const angle = angleAt(hip, knee, ankle);
    if (angle !== null) {
      measurements[side.name] = {
        hipY: hip.y,
        kneeY: knee.y,
        kneeToHip: hip.y - knee.y,
        kneeAngle: angle,
      };
    }
  }
  return measurements;
}

function measureStartPose(landmarks) {
  const legs = measureLegs(landmarks);
  const hasShoulders =
    Array.isArray(landmarks) &&
    isVisible(landmarks[11]) &&
    isVisible(landmarks[12]);
  const poseReady =
    hasShoulders &&
    Object.keys(legs).length === SIDES.length &&
    Object.values(legs).every(
      ({ kneeToHip, kneeAngle }) =>
        kneeToHip <= -RETURN_BELOW_HIP && kneeAngle >= START_ANGLE,
    );
  const missing = !hasShoulders || Object.keys(legs).length !== SIDES.length;

  return {
    poseReady,
    feedbackId: missing
      ? 'body-not-visible'
      : poseReady
        ? null
        : 'stand-straight',
    rejectionReasonId: missing
      ? 'missing-landmarks'
      : poseReady
        ? null
        : 'start-pose-invalid',
    metrics: Object.fromEntries(
      Object.entries(legs).map(([side, measurement]) => [
        side,
        measurement.kneeToHip,
      ]),
    ),
  };
}

export function createHighKneesAnalyzer() {
  const readinessGate = createStartPoseGate(measureStartPose);
  let count = 0;
  let armed = false;
  let pendingSide = null;
  let lastCompletedSide = null;
  let cooldownUntil = -Infinity;
  let lastUsableAt = null;

  function invalidatePhase() {
    readinessGate.reset();
    armed = false;
    pendingSide = null;
    lastUsableAt = null;
  }

  function reset() {
    count = 0;
    lastCompletedSide = null;
    cooldownUntil = -Infinity;
    invalidatePhase();
  }

  function output({
    formValid = true,
    feedbackId = 'return-to-start',
    rejectionReasonId = null,
    metrics = {},
  } = {}) {
    return {
      count,
      state: pendingSide ? 'knee-raised' : 'standing',
      phase: pendingSide ? 'knee-raised' : 'standing',
      formValid,
      rejectionReasonId,
      feedbackId,
      metrics: { activeSide: pendingSide, ...metrics },
    };
  }

  function update(
    landmarks,
    timestamp = globalThis.performance?.now?.() ?? Date.now(),
  ) {
    const legs = measureLegs(landmarks);
    if (Object.keys(legs).length === 0) {
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

    const neutral = Object.values(legs).every(
      ({ kneeToHip, kneeAngle }) =>
        kneeToHip <= -RETURN_BELOW_HIP && kneeAngle >= START_ANGLE,
    );
    if (pendingSide === null && timestamp >= cooldownUntil && neutral) {
      armed = true;
    }

    if (armed) {
      const liftedSide = SIDES.find(({ name }) => {
        const leg = legs[name];
        return (
          leg &&
          name !== lastCompletedSide &&
          leg.kneeToHip >= -0.02
        );
      });
      if (liftedSide) {
        pendingSide = liftedSide.name;
        armed = false;
      }
    }

    const pendingLeg = pendingSide ? legs[pendingSide] : null;
    if (
      pendingLeg &&
      pendingLeg.kneeToHip <= -RETURN_BELOW_HIP &&
      pendingLeg.kneeAngle >= START_ANGLE
    ) {
      lastCompletedSide = pendingSide;
      pendingSide = null;
      count += 1;
      cooldownUntil = timestamp + COUNT_COOLDOWN_MS;
      return output({
        feedbackId: 'great-job',
        metrics: {
          left: legs.left?.kneeToHip ?? null,
          right: legs.right?.kneeToHip ?? null,
          completedSide: lastCompletedSide,
        },
      });
    }

    return output({
      feedbackId: pendingSide ? 'high-knees-drive-knee' : 'return-to-start',
      metrics: {
        left: legs.left?.kneeToHip ?? null,
        right: legs.right?.kneeToHip ?? null,
      },
    });
  }

  function checkReady(landmarks, timestamp) {
    return readinessGate.check(landmarks, timestamp);
  }

  return { update, reset, invalidatePhase, checkReady };
}
