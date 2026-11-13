import { angleAt, isVisible } from './geometry.js';

const START_ANGLE = 165;
const BEND_ANGLE = 125;
const RETURN_ANGLE = 160;
const MIN_SHOULDER_DROP = 0.03;
const SHOULDER_RETURN_TOLERANCE = 0.03;
const COUNT_COOLDOWN_MS = 500;
const TRACKING_GAP_MS = 500;

const SIDES = [
  { name: 'left', shoulder: 11, elbow: 13, wrist: 15, hip: 23 },
  { name: 'right', shoulder: 12, elbow: 14, wrist: 16, hip: 24 },
];

export function createPushUpAnalyzer() {
  let count = 0;
  let armed = false;
  let pendingSide = null;
  let baselineTorsoOffset = {};
  let cooldownUntil = -Infinity;
  let lastUsableAt = null;

  function invalidatePhase() {
    armed = false;
    pendingSide = null;
    baselineTorsoOffset = {};
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
    const state = pendingSide ? 'bent' : 'extended';
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
        const shoulder = landmarks[side.shoulder];
        const elbow = landmarks[side.elbow];
        const wrist = landmarks[side.wrist];
        const hip = landmarks[side.hip];
        if (![shoulder, elbow, wrist, hip].every((landmark) => isVisible(landmark))) {
          continue;
        }
        const angle = angleAt(shoulder, elbow, wrist);
        if (angle !== null && Number.isFinite(shoulder?.y) && Number.isFinite(hip?.y)) {
          measurements[side.name] = {
            angle,
            torsoOffset: shoulder.y - hip.y,
          };
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

    const extended = Object.values(measurements).every(
      ({ angle }) => angle >= START_ANGLE,
    );
    const returned =
      pendingSide !== null &&
      measurements[pendingSide].angle >= RETURN_ANGLE &&
      measurements[pendingSide].torsoOffset <=
        baselineTorsoOffset[pendingSide] + SHOULDER_RETURN_TOLERANCE;
    if (pendingSide === null && timestamp >= cooldownUntil && extended) {
      armed = true;
      baselineTorsoOffset = Object.fromEntries(
        Object.entries(measurements).map(([side, { torsoOffset }]) => [
          side,
          torsoOffset,
        ]),
      );
    }

    if (armed) {
      const bentSides = Object.entries(measurements)
        .filter(
          ([side, { angle, torsoOffset }]) =>
            angle <= BEND_ANGLE &&
            baselineTorsoOffset[side] !== undefined &&
            torsoOffset - baselineTorsoOffset[side] >= MIN_SHOULDER_DROP,
        )
        .sort((left, right) => left[1].angle - right[1].angle);
      if (bentSides.length) {
        pendingSide = bentSides[0][0];
        armed = false;
      }
    }

    if (
      pendingSide &&
      returned
    ) {
      const completedSide = pendingSide;
      count += 1;
      pendingSide = null;
      armed = false;
      cooldownUntil = timestamp + COUNT_COOLDOWN_MS;
      return output({
        feedbackId: 'great-job',
        metrics: {
          ...Object.fromEntries(
            Object.entries(measurements).map(([side, value]) => [
              side,
              value.angle,
            ]),
          ),
          side: completedSide,
          elbowAngle: measurements[completedSide].angle,
        },
      });
    }

    return output({
      feedbackId: pendingSide ? 'return-to-start' : 'move-lower',
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
