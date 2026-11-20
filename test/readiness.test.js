import assert from 'node:assert/strict';
import test from 'node:test';

import { createStartPoseGate } from '../src/exercises/readiness.js';

const readyMeasurement = {
  poseReady: true,
  feedbackId: null,
  rejectionReasonId: null,
  metrics: {},
};

test('start-pose gate becomes ready after a stable interval', () => {
  const gate = createStartPoseGate(() => readyMeasurement);

  assert.equal(gate.check([], 0).ready, false);
  assert.equal(gate.check([], 399).ready, false);
  assert.equal(gate.check([], 400).ready, true);
});

test('start-pose gate resets its interval when the pose becomes invalid', () => {
  const gate = createStartPoseGate((pose) => ({
    ...readyMeasurement,
    poseReady: pose.length > 0,
  }));

  gate.check([1], 0);
  assert.equal(gate.check([], 200).ready, false);
  assert.equal(gate.check([1], 201).ready, false);
  assert.equal(gate.check([1], 702).ready, false);
  assert.equal(gate.check([1], 1102).ready, true);
});

test('start-pose gate restarts after timestamp reversal or a tracking gap', () => {
  const gate = createStartPoseGate(() => readyMeasurement);

  gate.check([], 100);
  assert.equal(gate.check([], 50).ready, false);
  assert.equal(gate.check([], 449).ready, false);
  assert.equal(gate.check([], 450).ready, true);
  assert.equal(gate.check([], 1000).ready, false);
  assert.equal(gate.check([], 1400).ready, true);
});

test('start-pose gate rejects invalid timestamps and resets explicitly', () => {
  const gate = createStartPoseGate(() => readyMeasurement);

  assert.equal(gate.check([], Number.NaN).ready, false);
  assert.equal(gate.check([], 0).ready, false);
  assert.equal(gate.check([], 400).ready, true);
  gate.reset();
  assert.equal(gate.check([], 401).ready, false);
});
