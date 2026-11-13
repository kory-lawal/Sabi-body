import { angleAt, isVisible } from './geometry.js';

const START_ANGLE = 165;
const BEND_ANGLE = 135;
const RETURN_ANGLE = 160;
const MIN_HIP_DROP = 0.03;
const HIP_RETURN_TOLERANCE = 0.04;
const COUNT_COOLDOWN_MS = 500;
const TRACKING_GAP_MS = 500;

const SIDES = [
  { name: 'left', hip: 23, knee: 25, ankle: 27 },
  { name: 'right', hip: 24, knee: 26, ankle: 28 },
];

export function createSquatAnalyzer() {
  let count = 0;
  let armed = false;
  let pendingSide = null;
  let baselineHipY = {};
  let cooldownUntil = -Infinity;
  let lastUsableAt = null;

  function invalidatePhase() {
    armed = false;
    pendingSide = null;
    baselineHipY = {};
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
    const state = pendingSide ? 'bent' : 'standing';
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
    const measurements = {};
    if (Array.isArray(landmarks)) {
      for (const side of SIDES) {
        const hip = landmarks[side.hip];
        const knee = landmarks[side.knee];
        const ankle = landmarks[side.ankle];
        if (![hip, knee, ankle].every((landmark) => isVisible(landmark))) {
          continue;
        }
        const angle = angleAt(hip, knee, ankle);
        if (angle !== null && Number.isFinite(hip?.y)) {
          measurements[side.name] = { angle, hipY: hip.y };
        }
      }
    }

    if (Object.keys(measurements).length === 0) {
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

    const standing = Object.values(measurements).every(
      ({ angle }) => angle >= START_ANGLE,
    );
    const returned = Object.values(measurements).every(
      ({ angle }) => angle >= RETURN_ANGLE,
    );
    if (pendingSide === null && timestamp >= cooldownUntil && standing) {
      armed = true;
      baselineHipY = Object.fromEntries(
        Object.entries(measurements).map(([side, { hipY }]) => [side, hipY]),
      );
    }

    if (armed) {
      const bentSides = Object.entries(measurements)
        .filter(
          ([side, { angle, hipY }]) =>
            angle <= BEND_ANGLE &&
            baselineHipY[side] !== undefined &&
            hipY - baselineHipY[side] >= MIN_HIP_DROP,
        )
        .sort((left, right) => left[1].angle - right[1].angle);
      if (bentSides.length) {
        pendingSide = bentSides[0][0];
        armed = false;
      }
    }

    if (
      pendingSide &&
      returned &&
      measurements[pendingSide].angle >= RETURN_ANGLE &&
      measurements[pendingSide].hipY <=
        baselineHipY[pendingSide] + HIP_RETURN_TOLERANCE
    ) {
      const completedSide = pendingSide;
      count += 1;
      pendingSide = null;
      armed = false;
      cooldownUntil = timestamp + COUNT_COOLDOWN_MS;
      return output({
        feedbackId: 'squat-completed',
        metrics: {
          ...Object.fromEntries(
            Object.entries(measurements).map(([side, value]) => [
              side,
              value.angle,
            ]),
          ),
          side: completedSide,
          kneeAngle: measurements[completedSide].angle,
        },
      });
    }

    return output({
      feedbackId: pendingSide ? 'squat-stand-up' : 'return-to-start',
      metrics: Object.fromEntries(
        Object.entries(measurements).map(([side, value]) => [
          side,
          value.angle,
        ]),
      ),
    });
  }

  return { update, reset, invalidatePhase };
}
