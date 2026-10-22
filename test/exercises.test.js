import assert from 'node:assert/strict';
import test from 'node:test';

import {
  angleAt,
  hasFullBodyVisible,
  isVisible,
} from '../src/exercises/geometry.js';
import { createSquatAnalyzer } from '../src/exercises/squat.js';

const REQUIRED_FULL_BODY_INDICES = [0, 11, 12, 23, 24, 25, 26, 27, 28];

function createLandmarks(kneeAngle = 170) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0.9,
  }));

  for (const index of [24, 26, 28]) {
    landmarks[index].visibility = 0.1;
  }

  landmarks[23] = { x: 0, y: 0, visibility: 0.9 };
  landmarks[25] = { x: 0, y: 1, visibility: 0.9 };
  const radians = (kneeAngle * Math.PI) / 180;
  landmarks[27] = {
    x: Math.sin(radians),
    y: 1 - Math.cos(radians),
    visibility: 0.9,
  };

  return landmarks;
}

test('angleAt returns the interior angle at its middle point', () => {
  assert.ok(
    Math.abs(
      angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }) - 90,
    ) < 1e-10,
  );
});

test('angleAt returns null for coincident points and missing inputs', () => {
  assert.equal(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), null);
  assert.equal(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  assert.equal(angleAt({ x: 1, y: 0 }, null, { x: 0, y: 1 }), null);
  assert.equal(angleAt(undefined, { x: 0, y: 0 }, { x: 0, y: 1 }), null);
});

test('isVisible requires finite coordinates and reliable visibility evidence', () => {
  assert.equal(isVisible({ x: 0, y: 0 }), false);
  assert.equal(isVisible({ x: 0, y: 0, visibility: 0.54 }), false);
  assert.equal(isVisible({ x: Infinity, y: 0, visibility: 0.9 }), false);
  assert.equal(isVisible({ x: 0, y: NaN, visibility: 0.9 }), false);
  assert.equal(isVisible({ x: 0, y: 0, presence: 0.55 }), true);
  assert.equal(
    isVisible({ x: 0, y: 0, visibility: 0.2, presence: 0.8 }),
    true,
  );
});

test('hasFullBodyVisible requires every listed landmark to be reliable', () => {
  const landmarks = createLandmarks();
  assert.equal(hasFullBodyVisible(landmarks), false);

  for (const index of REQUIRED_FULL_BODY_INDICES) {
    landmarks[index] = { x: 0, y: 0, visibility: 0.9 };
  }
  assert.equal(hasFullBodyVisible(landmarks), true);

  for (const index of REQUIRED_FULL_BODY_INDICES) {
    const original = landmarks[index];
    landmarks[index] = { ...original, visibility: 0.1 };
    assert.equal(hasFullBodyVisible(landmarks), false, `index ${index}`);
    landmarks[index] = original;
    delete landmarks[index];
    assert.equal(hasFullBodyVisible(landmarks), false, `missing index ${index}`);
    landmarks[index] = original;
  }
});

test('a complete squat cycle counts exactly once', () => {
  const analyzer = createSquatAnalyzer();
  let result;
  for (const angle of [170, 145, 105, 140, 170]) {
    result = analyzer.update(createLandmarks(angle));
  }

  assert.deepEqual(result, {
    count: 1,
    state: 'standing',
    feedbackId: 'great-job',
  });
});

test('a squat without reaching depth does not count', () => {
  const analyzer = createSquatAnalyzer();
  let result;
  for (const angle of [170, 145, 170]) {
    result = analyzer.update(createLandmarks(angle));
  }

  assert.equal(result.count, 0);
});

test('repeated low-angle frames do not count repeatedly', () => {
  const analyzer = createSquatAnalyzer();
  let result;
  for (const angle of [170, 105, 100, 105, 100, 140, 170, 170]) {
    result = analyzer.update(createLandmarks(angle));
  }

  assert.equal(result.count, 1);
});

test('an unreliable frame neither advances nor resets a squat phase', () => {
  const analyzer = createSquatAnalyzer();
  analyzer.update(createLandmarks(170));
  const lowering = analyzer.update(createLandmarks(145));
  const unreliable = createLandmarks(105);
  unreliable[25].visibility = 0.1;

  assert.deepEqual(analyzer.update(unreliable), {
    count: 0,
    state: 'lowering',
    feedbackId: 'body-not-visible',
  });
  assert.equal(lowering.state, 'lowering');

  analyzer.update(createLandmarks(105));
  analyzer.update(createLandmarks(140));
  const result = analyzer.update(createLandmarks(170));
  assert.equal(result.count, 1);
});

test('reset clears the count and restores the initial phase', () => {
  const analyzer = createSquatAnalyzer();
  for (const angle of [170, 145, 105, 140, 170]) {
    analyzer.update(createLandmarks(angle));
  }

  analyzer.reset();
  assert.deepEqual(analyzer.update(createLandmarks(145)), {
    count: 0,
    state: 'waiting-for-standing',
    feedbackId: 'return-to-start',
  });
});
