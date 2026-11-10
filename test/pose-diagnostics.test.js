import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPoseDiagnostics,
  serializeLandmarkDiagnostics,
} from '../src/pose/pose-diagnostics.js';

test('landmark diagnostics preserve confidence and visibility evidence by index', () => {
  const landmarks = [
    { x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8 },
    { x: 0.4, y: 0.3, visibility: 0.4, presence: 0.8 },
    null,
    { x: Number.NaN, y: Number.POSITIVE_INFINITY, visibility: undefined, presence: 0.9 },
  ];

  assert.deepEqual(serializeLandmarkDiagnostics(landmarks), [
    { index: 0, x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8, confidence: 0.8, visible: true },
    { index: 1, x: 0.4, y: 0.3, visibility: 0.4, presence: 0.8, confidence: 0.4, visible: false },
    { index: 2, x: null, y: null, visibility: null, presence: null, confidence: null, visible: false },
    { index: 3, x: null, y: null, visibility: null, presence: 0.9, confidence: 0.9, visible: false },
  ]);
});

test('landmark diagnostics retain sparse indices and represent absent pose data as empty', () => {
  const landmarks = [];
  landmarks.length = 2;
  landmarks[1] = { x: 0.5, y: 0.5, visibility: 0.7 };

  assert.deepEqual(serializeLandmarkDiagnostics(landmarks), [
    { index: 0, x: null, y: null, visibility: null, presence: null, confidence: null, visible: false },
    { index: 1, x: 0.5, y: 0.5, visibility: 0.7, presence: null, confidence: 0.7, visible: true },
  ]);
  assert.deepEqual(serializeLandmarkDiagnostics(undefined), []);
});

test('landmark diagnostics apply minimum confidence and normalized bounds', () => {
  const [lowConfidence, outOfBounds] = serializeLandmarkDiagnostics([
    { x: 0.5, y: 0.5, visibility: 0.55, presence: 0.9 },
    { x: 1.01, y: 0.5, visibility: 0.9, presence: 0.9 },
  ]);

  assert.equal(lowConfidence.confidence, 0.55);
  assert.equal(lowConfidence.visible, false);
  assert.equal(outOfBounds.visible, false);
});

test('pose diagnostics preserve existing fields and add serialized landmarks', () => {
  const state = {
    cameraStatus: 'ready',
    readinessState: 'ready',
    readinessReady: true,
    readinessReasonId: null,
    movementPhase: 'standing',
    formValid: true,
    rejectionReasonId: null,
    diagnosticMetrics: { exercise: { kneeAngle: 170 } },
    diagnosticLandmarks: serializeLandmarkDiagnostics([
      { x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8 },
    ]),
  };

  assert.deepEqual(createPoseDiagnostics(state), {
    cameraStatus: 'ready',
    readinessState: 'ready',
    readinessReady: true,
    readinessReasonId: null,
    movementPhase: 'standing',
    formValid: true,
    rejectionReasonId: null,
    metrics: { exercise: { kneeAngle: 170 } },
    landmarks: [
      { index: 0, x: 0.4, y: 0.3, visibility: 0.9, presence: 0.8, confidence: 0.8, visible: true },
    ],
  });
});
