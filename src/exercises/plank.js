import { angleAt, isVisible } from './geometry.js';

const START_ANGLE = 150;
const LOST_ANGLE = 135;
const STABLE_HOLD_MS = 400;
const ALIGNMENT_GRACE_MS = 300;
const TRACKING_GRACE_MS = 500;
const MAX_INTERVAL_MS = 200;

const SIDES = [
  { name: 'left', shoulder: 11, hip: 23, ankle: 27 },
  { name: 'right', shoulder: 12, hip: 24, ankle: 28 },
];

function measurePlank(landmarks) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  let verticalMeasurement = null;
  for (const side of SIDES) {
    const shoulder = landmarks[side.shoulder];
    const hip = landmarks[side.hip];
    const ankle = landmarks[side.ankle];
    if (![shoulder, hip, ankle].every((landmark) => isVisible(landmark))) {
      continue;
    }
    const angle = angleAt(shoulder, hip, ankle);
    if (angle === null) {
      continue;
    }

    const horizontalDisplacement = Math.abs(shoulder.x - ankle.x);
    const verticalDisplacement = Math.abs(shoulder.y - ankle.y);
    const measurement = {
      side: side.name,
      angle:
        horizontalDisplacement > verticalDisplacement
          ? angle
          : 0,
      orientationValid: horizontalDisplacement > verticalDisplacement,
      horizontalDisplacement,
      verticalDisplacement,
    };
    if (measurement.orientationValid) {
      return measurement;
    }
    verticalMeasurement ??= measurement;
  }
  return verticalMeasurement;
}

export function createPlankAnalyzer() {
  let elapsedMs = 0;
  let active = false;
  let alignedSince = null;
  let belowPauseSince = null;
  let missingSince = null;
  let lastValidAt = null;

  function invalidatePhase() {
    active = false;
    alignedSince = null;
    belowPauseSince = null;
    missingSince = null;
    lastValidAt = null;
  }

  function reset() {
    elapsedMs = 0;
    invalidatePhase();
  }

  function output({
    formValid = false,
    state = active ? 'aligned' : 'paused',
    rejectionReasonId = null,
    feedbackId,
    metrics = {},
  } = {}) {
    return {
      elapsedMs,
      active,
      state,
      phase: active ? 'holding' : 'paused',
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
    if (!Number.isFinite(timestamp)) {
      alignedSince = null;
      lastValidAt = null;
      return output({
        state: 'invalid-timestamp',
        rejectionReasonId: 'invalid-timestamp',
      });
    }

    const measurement = measurePlank(landmarks);
    if (!measurement) {
      alignedSince = null;
      missingSince ??= timestamp;
      lastValidAt = null;
      if (timestamp < missingSince) {
        invalidatePhase();
      } else if (active && timestamp - missingSince >= TRACKING_GRACE_MS) {
        active = false;
      }
      return output({
        state: 'tracking-lost',
        rejectionReasonId: 'missing-landmarks',
        feedbackId: 'body-not-visible',
      });
    }

    missingSince = null;
    const aligned =
      measurement.orientationValid && measurement.angle >= START_ANGLE;
    if (!active) {
      belowPauseSince = null;
      if (aligned) {
        alignedSince ??= timestamp;
        if (timestamp - alignedSince >= STABLE_HOLD_MS) {
          active = true;
          alignedSince = null;
          lastValidAt = timestamp;
        }
      } else {
        alignedSince = null;
      }
    } else if (
      !measurement.orientationValid ||
      measurement.angle < LOST_ANGLE
    ) {
      alignedSince = null;
      belowPauseSince ??= timestamp;
      lastValidAt = null;
      if (timestamp - belowPauseSince >= ALIGNMENT_GRACE_MS) {
        active = false;
        belowPauseSince = null;
      }
    } else if (active) {
      belowPauseSince = null;
      if (lastValidAt !== null) {
        elapsedMs += Math.max(
          0,
          Math.min(timestamp - lastValidAt, MAX_INTERVAL_MS),
        );
      }
      lastValidAt = timestamp;
    }

    const formValid = aligned;
    return output({
      formValid,
      state: active ? 'aligned' : 'paused',
      rejectionReasonId: formValid
        ? null
        : measurement.orientationValid
          ? 'alignment-invalid'
          : 'orientation-invalid',
      feedbackId: active ? 'plank-hold' : 'adjust-alignment',
      metrics: {
        side: measurement.side,
        alignmentAngle: measurement.angle,
        horizontalToVerticalRatio:
          measurement.verticalDisplacement === 0
            ? Infinity
            : measurement.horizontalDisplacement /
              measurement.verticalDisplacement,
      },
    });
  }

  return { update, reset, invalidatePhase };
}
