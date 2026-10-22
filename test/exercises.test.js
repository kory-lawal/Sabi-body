import assert from 'node:assert/strict';
import test from 'node:test';

import {
  angleAt,
  hasFullBodyVisible,
  isVisible,
} from '../src/exercises/geometry.js';
import { createJumpingJackAnalyzer } from '../src/exercises/jumping-jacks.js';
import { createPlankAnalyzer } from '../src/exercises/plank.js';
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

function createJumpingJackLandmarks(pose) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.9,
  }));

  landmarks[11] = { x: 0.4, y: 0.4, visibility: 0.9 };
  landmarks[12] = { x: 0.6, y: 0.4, visibility: 0.9 };
  landmarks[23] = { x: 0.4, y: 0.6, visibility: 0.9 };
  landmarks[24] = { x: 0.6, y: 0.6, visibility: 0.9 };

  if (pose === 'closed') {
    landmarks[15] = { x: 0.4, y: 0.5, visibility: 0.9 };
    landmarks[16] = { x: 0.6, y: 0.5, visibility: 0.9 };
    landmarks[27] = { x: 0.39, y: 0.8, visibility: 0.9 };
    landmarks[28] = { x: 0.61, y: 0.8, visibility: 0.9 };
  } else {
    landmarks[15] = { x: 0.4, y: 0.2, visibility: 0.9 };
    landmarks[16] = { x: 0.6, y: 0.2, visibility: 0.9 };
    landmarks[27] = { x: 0.33, y: 0.8, visibility: 0.9 };
    landmarks[28] = { x: 0.67, y: 0.8, visibility: 0.9 };
  }

  return landmarks;
}

function createPlankLandmarks({ aligned = true, side = 'left' } = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.1,
  }));
  const indices =
    side === 'left'
      ? { shoulder: 11, hip: 23, ankle: 27 }
      : { shoulder: 12, hip: 24, ankle: 28 };

  landmarks[indices.shoulder] = {
    x: 0.2,
    y: 0.5,
    visibility: 0.9,
  };
  landmarks[indices.hip] = { x: 0.5, y: 0.5, visibility: 0.9 };
  landmarks[indices.ankle] = aligned
    ? { x: 0.8, y: 0.5, visibility: 0.9 }
    : { x: 0.5, y: 0.2, visibility: 0.9 };

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

test('a complete jumping-jack cycle counts exactly once', () => {
  const analyzer = createJumpingJackAnalyzer();
  let result;
  for (const pose of ['closed', 'open', 'closed']) {
    result = analyzer.update(createJumpingJackLandmarks(pose));
  }

  assert.deepEqual(result, {
    count: 1,
    state: 'closed',
    feedbackId: 'great-job',
  });
});

test('open frames alone and partial open poses do not count a jumping jack', () => {
  const openAlone = createJumpingJackAnalyzer();
  assert.equal(
    openAlone.update(createJumpingJackLandmarks('open')).count,
    0,
  );

  const partial = createJumpingJackAnalyzer();
  partial.update(createJumpingJackLandmarks('closed'));
  const partialOpen = createJumpingJackLandmarks('closed');
  partialOpen[15].y = 0.2;
  partialOpen[16].y = 0.2;

  assert.deepEqual(partial.update(partialOpen), {
    count: 0,
    state: 'closed',
    feedbackId: 'return-to-start',
  });
});

test('repeated closed frames after a jumping jack do not add counts', () => {
  const analyzer = createJumpingJackAnalyzer();
  let result;
  for (const pose of ['closed', 'open', 'closed', 'closed', 'closed']) {
    result = analyzer.update(createJumpingJackLandmarks(pose));
  }

  assert.equal(result.count, 1);
  assert.equal(result.state, 'closed');
});

test('unreliable jumping-jack landmarks do not advance the phase', () => {
  const analyzer = createJumpingJackAnalyzer();
  analyzer.update(createJumpingJackLandmarks('closed'));
  const unreliable = createJumpingJackLandmarks('open');
  unreliable[15].visibility = 0.1;

  assert.deepEqual(analyzer.update(unreliable), {
    count: 0,
    state: 'closed',
    feedbackId: 'body-not-visible',
  });

  const missingAnkle = createJumpingJackLandmarks('open');
  delete missingAnkle[28];
  assert.deepEqual(analyzer.update(missingAnkle), {
    count: 0,
    state: 'closed',
    feedbackId: 'body-not-visible',
  });
});

test('a straight side-on plank accrues elapsed milliseconds', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  const result = analyzer.update(createPlankLandmarks(), 1100);

  assert.deepEqual(result, {
    elapsedMs: 100,
    active: true,
    state: 'aligned',
    feedbackId: 'aligned',
  });
});

test('plank analysis falls back to a reliable right-side pose', () => {
  const analyzer = createPlankAnalyzer();
  const result = analyzer.update(
    createPlankLandmarks({ side: 'right' }),
    1000,
  );

  assert.deepEqual(result, {
    elapsedMs: 0,
    active: true,
    state: 'aligned',
    feedbackId: 'aligned',
  });
});

test('a bent plank does not accrue time and prompts for alignment', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  const result = analyzer.update(createPlankLandmarks({ aligned: false }), 1100);

  assert.deepEqual(result, {
    elapsedMs: 0,
    active: false,
    state: 'adjust-alignment',
    feedbackId: 'adjust-alignment',
  });
});

test('unreliable plank landmarks pause timing without counting the gap', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  analyzer.update(createPlankLandmarks(), 1100);
  const unreliable = createPlankLandmarks();
  unreliable[11].visibility = 0.1;

  assert.deepEqual(analyzer.update(unreliable, 1500), {
    elapsedMs: 100,
    active: false,
    state: 'body-not-visible',
    feedbackId: 'body-not-visible',
  });
  assert.equal(analyzer.update(createPlankLandmarks(), 2000).elapsedMs, 100);
  assert.equal(analyzer.update(createPlankLandmarks(), 2100).elapsedMs, 200);
});

test('reset clears accumulated plank time', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  analyzer.update(createPlankLandmarks(), 1100);
  analyzer.reset();

  assert.equal(analyzer.update(createPlankLandmarks(), 2000).elapsedMs, 0);
});

test('plank timing caps a single elapsed interval at 200 milliseconds', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);

  assert.equal(analyzer.update(createPlankLandmarks(), 5000).elapsedMs, 200);
});
