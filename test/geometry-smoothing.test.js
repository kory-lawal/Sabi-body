import assert from 'node:assert/strict';
import test from 'node:test';

import { createLandmarkSmoother } from '../src/exercises/geometry.js';

function point(x, y, confidence = 0.95) {
  return { x, y, visibility: confidence, presence: confidence };
}

test('landmark smoothing dampens a one-frame coordinate spike', () => {
  const smoother = createLandmarkSmoother();
  const frame = (x) => Object.assign(Array.from({ length: 33 }, () => null), {
    23: point(x, 0.5),
  });

  smoother.update(frame(0.5), 0);
  const spike = smoother.update(frame(0.9), 33);
  const recovered = smoother.update(frame(0.5), 66);

  assert.equal(spike[23].x, 0.5);
  assert.equal(recovered[23].x, 0.5);
});

test('landmark smoothing restarts after a long tracking gap', () => {
  const smoother = createLandmarkSmoother();
  const frame = (x) => Object.assign(Array.from({ length: 33 }, () => null), {
    23: point(x, 0.5),
  });

  smoother.update(frame(0.5), 0);
  const next = smoother.update(frame(0.9), 600);

  assert.equal(next[23].x, 0.9);
});
