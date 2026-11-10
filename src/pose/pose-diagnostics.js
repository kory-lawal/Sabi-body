import {
  getLandmarkConfidence,
  isVisible,
} from '../exercises/geometry.js';

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function serializeLandmarkDiagnostics(landmarks) {
  if (!Array.isArray(landmarks)) {
    return [];
  }

  return Array.from({ length: landmarks.length }, (_, index) => {
    const landmark = landmarks[index];
    return {
      index,
      x: finiteOrNull(landmark?.x),
      y: finiteOrNull(landmark?.y),
      visibility: finiteOrNull(landmark?.visibility),
      presence: finiteOrNull(landmark?.presence),
      confidence: getLandmarkConfidence(landmark),
      visible: isVisible(landmark),
    };
  });
}

export function createPoseDiagnostics(state) {
  return {
    cameraStatus: state.cameraStatus,
    readinessState: state.readinessState,
    readinessReady: state.readinessReady,
    readinessReasonId: state.readinessReasonId,
    movementPhase: state.movementPhase,
    formValid: state.formValid,
    rejectionReasonId: state.rejectionReasonId,
    metrics: state.diagnosticMetrics,
    landmarks: state.diagnosticLandmarks,
  };
}
