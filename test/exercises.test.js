import assert from 'node:assert/strict';
import test from 'node:test';

import {
  angleAt,
  distance,
  getLandmarkConfidence,
  hasFullBodyVisible,
  isVisible,
} from '../src/exercises/geometry.js';
import { createJumpingJackAnalyzer } from '../src/exercises/jumping-jacks.js';
import { createPlankAnalyzer } from '../src/exercises/plank.js';
import { createSquatAnalyzer } from '../src/exercises/squat.js';

const REQUIRED_FULL_BODY_INDICES = [0, 11, 12, 23, 24, 25, 26, 27, 28];

function createLandmarks(
  kneeAngle = 170,
  {
    hipBelowKnee = kneeAngle <= 105,
    hipPositionRatio = hipBelowKnee ? 0.125 : -0.25,
  } = {},
) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0.9,
  }));

  for (const index of [24, 26, 28]) {
    landmarks[index].visibility = 0.1;
  }

  const kneeY = 0.6;
  const shoulderY = 0.2;
  landmarks[11] = { x: 0.5, y: shoulderY, visibility: 0.9 };
  const hip = {
    x: 0.5,
    y: (kneeY - hipPositionRatio * shoulderY) / (1 - hipPositionRatio),
    visibility: 0.9,
  };
  landmarks[23] = hip;
  landmarks[25] = { x: 0.5, y: kneeY, visibility: 0.9 };
  const radians = (kneeAngle * Math.PI) / 180;
  const hipDirection = Math.atan2(
    hip.y - landmarks[25].y,
    hip.x - landmarks[25].x,
  );
  const ankleDirection = hipDirection + radians;
  landmarks[27] = {
    x: 0.5 + Math.cos(ankleDirection) * 0.2,
    y: 0.6 + Math.sin(ankleDirection) * 0.2,
    visibility: 0.9,
  };

  return landmarks;
}

function sendSquatFrames(analyzer, angle, timestamp, frames = 5, options) {
  let result;
  const frameResults = [];
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(
      createLandmarks(angle, options),
      timestamp + frame * 33,
    );
    frameResults.push(result);
  }
  return {
    result,
    frameResults,
    nextTimestamp: timestamp + frames * 33,
  };
}

function createMediaPipeSquatPose(position) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.1,
  }));
  const entries =
    position === 'standing'
      ? [
          [12, 0.416, 0.333],
          [24, 0.408, 0.572],
          [26, 0.426, 0.749],
          [28, 0.436, 0.917],
        ]
      : [
          [12, 0.522, 0.542],
          [24, 0.259, 0.722],
          [26, 0.512, 0.757],
          [28, 0.429, 0.928],
        ];
  for (const [index, x, y] of entries) {
    landmarks[index] = { x, y, visibility: 0.95, presence: 0.99 };
  }
  return landmarks;
}

function createMediaPipeJumpingJackPose(position) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.1,
  }));
  const entries =
    position === 'closed'
      ? [
          [0, 0.488, 0.223],
          [11, 0.652, 0.306],
          [12, 0.395, 0.302],
          [13, 0.687, 0.412],
          [14, 0.35, 0.407],
          [15, 0.757, 0.499],
          [16, 0.285, 0.494],
          [23, 0.599, 0.517],
          [24, 0.45, 0.518],
          [25, 0.602, 0.701],
          [26, 0.429, 0.698],
          [27, 0.55, 0.894],
          [28, 0.5, 0.887],
        ]
      : [
          [0, 0.372, 0.224],
          [11, 0.473, 0.284],
          [12, 0.248, 0.277],
          [13, 0.605, 0.196],
          [14, 0.128, 0.205],
          [15, 0.694, 0.1],
          [16, 0.05, 0.111],
          [23, 0.462, 0.501],
          [24, 0.297, 0.503],
          [25, 0.55, 0.687],
          [26, 0.185, 0.681],
          [27, 0.642, 0.89],
          [28, 0.105, 0.88],
        ];
  for (const [index, x, y] of entries) {
    landmarks[index] = { x, y, visibility: 0.95, presence: 0.99 };
  }
  return landmarks;
}

function createJumpingJackLandmarks(pose) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.9,
  }));

  landmarks[0] = { x: 0.5, y: 0.25, visibility: 0.9 };
  landmarks[11] = { x: 0.4, y: 0.4, visibility: 0.9 };
  landmarks[12] = { x: 0.6, y: 0.4, visibility: 0.9 };
  landmarks[13] = { x: 0.42, y: 0.45, visibility: 0.9 };
  landmarks[14] = { x: 0.58, y: 0.45, visibility: 0.9 };
  landmarks[23] = { x: 0.4, y: 0.6, visibility: 0.9 };
  landmarks[24] = { x: 0.6, y: 0.6, visibility: 0.9 };

  if (pose === 'closed') {
    landmarks[15] = { x: 0.4, y: 0.5, visibility: 0.9 };
    landmarks[16] = { x: 0.6, y: 0.5, visibility: 0.9 };
    landmarks[27] = { x: 0.47, y: 0.8, visibility: 0.9 };
    landmarks[28] = { x: 0.53, y: 0.8, visibility: 0.9 };
  } else {
    landmarks[13] = { x: 0.42, y: 0.32, visibility: 0.9 };
    landmarks[14] = { x: 0.58, y: 0.32, visibility: 0.9 };
    landmarks[15] = { x: 0.4, y: 0.2, visibility: 0.9 };
    landmarks[16] = { x: 0.6, y: 0.2, visibility: 0.9 };
    landmarks[27] = { x: 0.33, y: 0.8, visibility: 0.9 };
    landmarks[28] = { x: 0.67, y: 0.8, visibility: 0.9 };
  }

  return landmarks;
}

function sendJumpingJackFrames(analyzer, pose, timestamp, frames = 5) {
  let result;
  const frameResults = [];
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(
      createJumpingJackLandmarks(pose),
      timestamp + frame * 33,
    );
    frameResults.push(result);
  }
  return {
    result,
    frameResults,
    nextTimestamp: timestamp + frames * 33,
  };
}

function createPlankLandmarks({
  aligned = true,
  orientation = 'horizontal',
  side = 'left',
  hipDeviation = 0,
} = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0.1,
  }));
  const indices =
    side === 'left'
      ? { shoulder: 11, hip: 23, ankle: 27 }
      : { shoulder: 12, hip: 24, ankle: 28 };

  landmarks[indices.shoulder] =
    orientation === 'vertical'
      ? { x: 0.5, y: 0.2, visibility: 0.9 }
      : { x: 0.2, y: 0.5, visibility: 0.9 };
  landmarks[indices.hip] = {
    x: 0.5,
    y: 0.5 + hipDeviation,
    visibility: 0.9,
  };
  landmarks[indices.ankle] = aligned
    ? orientation === 'vertical'
      ? { x: 0.5, y: 0.8, visibility: 0.9 }
      : { x: 0.8, y: 0.5, visibility: 0.9 }
    : { x: 0.8, y: 0.8, visibility: 0.9 };

  return landmarks;
}

function sendPlankFrames(
  analyzer,
  landmarks,
  timestamp,
  frames = 3,
  interval = 100,
) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, timestamp + frame * interval);
  }
  return { result, nextTimestamp: timestamp + frames * interval };
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
  assert.equal(isVisible({ x: 0, y: 0, presence: 0.6 }), true);
  assert.equal(isVisible({ x: 0, y: 0, visibility: 0.9, presence: 0.4 }), false);
  assert.equal(
    isVisible({ x: 0, y: 0, visibility: 0.2, presence: 0.8 }),
    false,
  );
  assert.equal(isVisible({ x: -0.01, y: 0.5, visibility: 0.9 }), false);
  assert.equal(isVisible({ x: 0.5, y: 1.01, visibility: 0.9 }), false);
});

test('landmark confidence uses the weakest available confidence score', () => {
  assert.equal(
    getLandmarkConfidence({ visibility: 0.9, presence: 0.4 }),
    0.4,
  );
  assert.equal(getLandmarkConfidence({ visibility: 0.7 }), 0.7);
  assert.equal(getLandmarkConfidence({ x: 0.5, y: 0.5 }), null);
});

test('distance returns normalized point distances and rejects invalid points', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance({ x: 0, y: 0 }, { x: Infinity, y: 1 }), null);
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

test('squat counts a reasonable knee bend and return exactly once', () => {
  const analyzer = createSquatAnalyzer();
  assert.equal(analyzer.update(createLandmarks(180), 0).count, 0);
  assert.equal(
    analyzer.update(createLandmarks(130, { hipPositionRatio: 0.1 }), 33).count,
    0,
  );
  assert.equal(analyzer.update(createLandmarks(180), 66).count, 1);
  assert.equal(analyzer.update(createLandmarks(180), 99).count, 1);
});

test('squat ignores a bend without a starting stand or hip drop', () => {
  const startsBent = createSquatAnalyzer();
  assert.equal(startsBent.update(createLandmarks(130), 0).count, 0);
  assert.equal(startsBent.update(createLandmarks(180), 33).count, 0);

  const kneeOnly = createSquatAnalyzer();
  kneeOnly.update(createLandmarks(180), 0);
  kneeOnly.update(createLandmarks(130), 33);
  assert.equal(kneeOnly.update(createLandmarks(180), 66).count, 0);
});

test('squat cooldown blocks a rapid duplicate until a new stand-and-bend cycle', () => {
  const analyzer = createSquatAnalyzer();
  const standing = () => createLandmarks(180);
  const squat = () => createLandmarks(130, { hipPositionRatio: 0.1 });
  analyzer.update(standing(), 0);
  analyzer.update(squat(), 33);
  assert.equal(analyzer.update(standing(), 66).count, 1);

  analyzer.update(squat(), 100);
  assert.equal(analyzer.update(standing(), 133).count, 1);
  analyzer.update(standing(), 600);
  analyzer.update(squat(), 633);
  assert.equal(analyzer.update(standing(), 666).count, 2);
});

test('squat ignores finite landmarks when the leg joints are not visible', () => {
  const analyzer = createSquatAnalyzer();
  const lowConfidenceLandmarks = (angle, options) => {
    const landmarks = createLandmarks(angle, options);
    for (const index of [23, 25, 27]) {
      landmarks[index].visibility = 0.2;
    }
    return landmarks;
  };

  assert.equal(analyzer.update(lowConfidenceLandmarks(180), 0).count, 0);
  assert.equal(
    analyzer.update(
      lowConfidenceLandmarks(130, { hipPositionRatio: 0.1 }),
      33,
    ).count,
    0,
  );
  assert.equal(analyzer.update(lowConfidenceLandmarks(160), 66).count, 0);
});

test('a squat bend without a return does not count', () => {
  const analyzer = createSquatAnalyzer();
  analyzer.update(createLandmarks(180), 0);
  analyzer.update(
    createLandmarks(130, { hipPositionRatio: 0.1 }),
    33,
  );
  const result = analyzer.update(createLandmarks(145), 66);

  assert.equal(result.count, 0);
});

test('a 500 ms tracking gap discards an incomplete squat cycle', () => {
  const analyzer = createSquatAnalyzer();
  analyzer.update(createLandmarks(180), 0);
  analyzer.update(createLandmarks(130, { hipPositionRatio: 0.1 }), 33);
  analyzer.update(null, 100);
  analyzer.update(null, 600);
  const result = analyzer.update(createLandmarks(180), 633);

  assert.equal(result.count, 0);
});

test('phase invalidation preserves completed squat count but discards a pending cycle', () => {
  const analyzer = createSquatAnalyzer();
  analyzer.update(createLandmarks(180), 0);
  analyzer.update(createLandmarks(130, { hipPositionRatio: 0.1 }), 33);
  analyzer.update(createLandmarks(160), 66);
  analyzer.update(createLandmarks(130, { hipPositionRatio: 0.1 }), 99);
  analyzer.invalidatePhase();

  const result = analyzer.update(createLandmarks(160), 132);
  assert.equal(result.count, 1);
});

test('reset clears squat count and restores the initial phase', () => {
  const analyzer = createSquatAnalyzer();
  analyzer.update(createLandmarks(180), 0);
  analyzer.update(createLandmarks(130, { hipPositionRatio: 0.1 }), 33);
  analyzer.update(createLandmarks(160), 66);
  analyzer.reset();
  const result = analyzer.update(createLandmarks(180), 99);

  assert.equal(result.count, 0);
  assert.equal(result.state, 'standing');
});

test('a complete near-level squat counts with a small hip-landmark offset', () => {
  const analyzer = createSquatAnalyzer();
  let timestamp = 0;
  timestamp = sendSquatFrames(analyzer, 170, timestamp).nextTimestamp;
  timestamp = sendSquatFrames(analyzer, 130, timestamp, 5, {
    hipPositionRatio: 0.02,
  }).nextTimestamp;
  const result = sendSquatFrames(analyzer, 170, timestamp).result;

  assert.equal(result.count, 1);
});

test('a complete MediaPipe-detected deep squat counts', () => {
  const analyzer = createSquatAnalyzer();
  let timestamp = 0;
  for (const position of ['standing', 'lowered', 'standing']) {
    let result;
    for (let frame = 0; frame < 8; frame += 1) {
      result = analyzer.update(
        createMediaPipeSquatPose(position),
        timestamp,
      );
      timestamp += 33;
    }
    if (position === 'standing') {
      assert.equal(result.state, 'standing');
    }
  }

  assert.equal(analyzer.update(createMediaPipeSquatPose('standing'), timestamp).count, 1);
});

test('a complete jumping-jack cycle counts exactly once', () => {
  const analyzer = createJumpingJackAnalyzer();
  let timestamp = 0;
  let result;
  let completionEvent;
  for (const pose of ['closed', 'open', 'closed']) {
    const update = sendJumpingJackFrames(analyzer, pose, timestamp);
    result = update.result;
    completionEvent = update.frameResults.find(
      (frameResult) => frameResult.feedbackId === 'jumping-jack-completed',
    ) ?? completionEvent;
    timestamp = update.nextTimestamp;
  }

  assert.equal(result.count, 1);
  assert.equal(result.state, 'closed');
  assert.equal(completionEvent.feedbackId, 'jumping-jack-completed');
});

test('jumping jacks ignore finite landmarks when the limbs are not visible', () => {
  const analyzer = createJumpingJackAnalyzer();
  const closed = createJumpingJackLandmarks('closed');
  const open = createJumpingJackLandmarks('open');
  for (const pose of [closed, open]) {
    for (const index of [11, 12, 15, 16, 23, 24, 27, 28]) {
      pose[index].visibility = 0.1;
    }
  }

  assert.equal(analyzer.update(closed, 0).count, 0);
  assert.equal(analyzer.update(open, 33).count, 0);
  assert.equal(analyzer.update(closed, 66).count, 0);
});

test('jumping jacks require a closed start and enforce a short cooldown', () => {
  const analyzer = createJumpingJackAnalyzer();
  assert.equal(sendJumpingJackFrames(analyzer, 'open', 0).result.count, 0);
  assert.equal(sendJumpingJackFrames(analyzer, 'closed', 165).result.count, 0);

  assert.equal(sendJumpingJackFrames(analyzer, 'open', 330).result.count, 0);
  assert.equal(sendJumpingJackFrames(analyzer, 'closed', 495).result.count, 1);
  sendJumpingJackFrames(analyzer, 'open', 630);
  assert.equal(sendJumpingJackFrames(analyzer, 'closed', 795).result.count, 1);

  sendJumpingJackFrames(analyzer, 'closed', 1000);
  sendJumpingJackFrames(analyzer, 'open', 1150);
  assert.equal(sendJumpingJackFrames(analyzer, 'closed', 1300).result.count, 2);
});

test('a complete MediaPipe-detected jumping jack counts', () => {
  const analyzer = createJumpingJackAnalyzer();
  let timestamp = 0;
  let result;
  for (const position of ['closed', 'open', 'closed']) {
    for (let frame = 0; frame < 8; frame += 1) {
      result = analyzer.update(
        createMediaPipeJumpingJackPose(position),
        timestamp,
      );
      timestamp += 33;
    }
  }

  assert.equal(result.count, 1);
  assert.equal(result.state, 'closed');
});

test('a relaxed-open-pose jumping jack counts once', () => {
  const analyzer = createJumpingJackAnalyzer();
  const closed = createJumpingJackLandmarks('closed');
  const relaxedOpen = createJumpingJackLandmarks('open');
  relaxedOpen[15].y = 0.3;
  relaxedOpen[16].y = 0.3;
  relaxedOpen[27].x = 0.25;
  relaxedOpen[28].x = 0.55;
  const lowConfidenceOpen = relaxedOpen.map((landmark) => ({ ...landmark }));
  for (const index of [11, 12, 15, 16, 23, 24, 27, 28]) {
    lowConfidenceOpen[index].visibility = 0.2;
  }

  assert.equal(analyzer.update(closed, 0).count, 0);
  assert.equal(analyzer.update(relaxedOpen, 33).count, 0);
  assert.equal(analyzer.update(closed, 66).count, 1);
  assert.equal(analyzer.update(closed, 99).count, 1);

  const lowConfidence = createJumpingJackAnalyzer();
  assert.equal(lowConfidence.update(closed, 0).count, 0);
  assert.equal(lowConfidence.update(lowConfidenceOpen, 33).count, 0);
  assert.equal(lowConfidence.update(closed, 66).count, 0);
});

test('open frames alone and partial open poses do not count a jumping jack', () => {
  const openAlone = createJumpingJackAnalyzer();
  assert.equal(sendJumpingJackFrames(openAlone, 'open', 0).result.count, 0);

  const partial = createJumpingJackAnalyzer();
  sendJumpingJackFrames(partial, 'closed', 0);
  const feetOnly = createJumpingJackLandmarks('open');
  feetOnly[15].y = 0.5;
  feetOnly[16].y = 0.5;
  feetOnly[13].y = 0.45;
  feetOnly[14].y = 0.45;
  for (let frame = 0; frame < 5; frame += 1) {
    partial.update(feetOnly, 165 + frame * 33);
  }

  const result = partial.update(createJumpingJackLandmarks('closed'), 330);
  assert.equal(result.count, 0);
  assert.equal(result.state, 'closed');
});

test('repeated closed frames after a jumping jack do not add counts', () => {
  const analyzer = createJumpingJackAnalyzer();
  let timestamp = 0;
  let result;
  for (const pose of ['closed', 'open', 'closed', 'closed', 'closed']) {
    const update = sendJumpingJackFrames(analyzer, pose, timestamp);
    result = update.result;
    timestamp = update.nextTimestamp;
  }

  assert.equal(result.count, 1);
  assert.equal(result.state, 'closed');
});

test('missing jumping-jack landmarks skip the frame and a long gap clears the open phase', () => {
  const analyzer = createJumpingJackAnalyzer();
  const closed = createJumpingJackLandmarks('closed');
  const open = createJumpingJackLandmarks('open');
  analyzer.update(closed, 0);
  analyzer.update(open, 33);
  const missing = open.map(() => null);
  assert.equal(analyzer.update(missing, 100).rejectionReasonId, 'missing-landmarks');
  analyzer.update(missing, 533);
  assert.equal(analyzer.update(closed, 566).count, 0);
});

test('a tracking gap and phase jitter cannot complete a jumping jack', () => {
  const analyzer = createJumpingJackAnalyzer();
  const start = sendJumpingJackFrames(analyzer, 'closed', 0);
  for (let frame = 0; frame < 2; frame += 1) {
    analyzer.update(createJumpingJackLandmarks('open'), start.nextTimestamp + frame * 33);
  }
  const afterGap = analyzer.update(
    createJumpingJackLandmarks('open'),
    start.nextTimestamp + 533,
  );
  assert.equal(afterGap.count, 0);
  assert.equal(afterGap.state, 'closed');
});

test('plank requires a short stable hold before accumulating time', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks();
  const started = analyzer.update(landmarks, 1000);
  assert.equal(started.active, false);
  assert.equal(started.elapsedMs, 0);
  assert.equal(analyzer.update(landmarks, 1300).active, false);
  const stable = analyzer.update(landmarks, 1400);
  assert.equal(stable.active, true);
  assert.equal(stable.elapsedMs, 0);
  const result = analyzer.update(landmarks, 1500);
  assert.equal(result.elapsedMs, 100);
  assert.equal(result.active, true);
  assert.equal(result.formValid, true);
});

test('a brief aligned frame cannot accrue plank time', () => {
  const analyzer = createPlankAnalyzer();
  assert.equal(analyzer.update(createPlankLandmarks(), 1000).active, false);
  const lost = analyzer.update(
    createPlankLandmarks({ aligned: false }),
    1100,
  );
  assert.equal(lost.active, false);
  assert.equal(lost.elapsedMs, 0);
});

test('a straight vertical standing pose does not accrue plank time', () => {
  const analyzer = createPlankAnalyzer();
  const result = sendPlankFrames(
    analyzer,
    createPlankLandmarks({ orientation: 'vertical' }),
    1000,
  ).result;

  assert.equal(result.elapsedMs, 0);
  assert.equal(result.active, false);
  assert.equal(result.rejectionReasonId, 'orientation-invalid');
});

test('plank pauses after clear alignment loss and resumes without resetting time', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks();
  assert.equal(analyzer.update(landmarks, 1000).active, false);
  assert.equal(analyzer.update(landmarks, 1400).active, true);
  assert.equal(analyzer.update(landmarks, 1500).elapsedMs, 100);

  const lost = createPlankLandmarks({ hipDeviation: 0.2 });
  assert.equal(analyzer.update(lost, 1600).elapsedMs, 100);
  assert.equal(analyzer.update(lost, 1700).active, true);
  assert.equal(analyzer.update(lost, 1900).active, false);

  assert.equal(analyzer.update(landmarks, 2000).active, false);
  assert.equal(analyzer.update(landmarks, 2400).active, true);
  assert.equal(analyzer.update(landmarks, 2500).elapsedMs, 200);
});

test('a brief plank alignment loss does not trigger a pause', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  analyzer.update(createPlankLandmarks(), 1400);
  analyzer.update(createPlankLandmarks(), 1500);
  assert.equal(analyzer.update(createPlankLandmarks({ hipDeviation: 0.2 }), 1600).active, true);
  assert.equal(analyzer.update(createPlankLandmarks(), 1700).active, true);
  assert.equal(analyzer.update(createPlankLandmarks(), 1800).elapsedMs, 200);
});

test('plank ignores invisible landmarks and uses the visible side', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks({ side: 'right' });
  for (const index of [12, 24, 28]) {
    landmarks[index].visibility = 0.2;
  }
  assert.equal(analyzer.update(landmarks, 1000).active, false);
  assert.equal(analyzer.update(landmarks, 1400).active, false);

  const visibleSide = createPlankAnalyzer();
  const rightSide = createPlankLandmarks({ side: 'right' });
  for (const index of [11, 23, 27]) {
    rightSide[index] = null;
  }
  assert.equal(visibleSide.update(rightSide, 1000).active, false);
  assert.equal(visibleSide.update(rightSide, 1400).active, true);
});

test('missing plank landmarks stop accumulation and pause after 500 ms', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks();
  analyzer.update(landmarks, 1000);
  analyzer.update(landmarks, 1400);
  analyzer.update(landmarks, 1500);
  const missing = Array.from({ length: 33 }, () => null);
  assert.equal(analyzer.update(missing, 1600).elapsedMs, 100);
  const paused = analyzer.update(missing, 2100);
  assert.equal(paused.elapsedMs, 100);
  assert.equal(paused.active, false);
  assert.equal(paused.rejectionReasonId, 'missing-landmarks');
});

test('reset clears accumulated plank time', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks();
  analyzer.update(landmarks, 1000);
  analyzer.update(landmarks, 1400);
  analyzer.update(landmarks, 1500);
  analyzer.reset();

  assert.equal(analyzer.update(createPlankLandmarks(), 2000).elapsedMs, 0);
  assert.equal(analyzer.update(createPlankLandmarks(), 2400).active, true);
});

test('plank timing caps a single elapsed interval at 200 milliseconds', () => {
  const analyzer = createPlankAnalyzer();
  analyzer.update(createPlankLandmarks(), 1000);
  analyzer.update(createPlankLandmarks(), 1400);
  assert.equal(analyzer.update(createPlankLandmarks(), 5000).elapsedMs, 200);
});

test('plank time accumulates during aligned frames', () => {
  const analyzer = createPlankAnalyzer();
  let timestamp = 0;
  let result;
  for (let frame = 0; frame <= 100; frame += 1) {
    result = analyzer.update(createPlankLandmarks(), timestamp);
    timestamp += 100;
  }

  assert.equal(result.active, true);
  assert.equal(result.elapsedMs, 9600);
});

test('plank phase invalidation preserves earned time and restarts the timer', () => {
  const analyzer = createPlankAnalyzer();
  const landmarks = createPlankLandmarks();
  analyzer.update(landmarks, 1000);
  analyzer.update(landmarks, 1400);
  const beforeInvalidation = analyzer.update(landmarks, 1500);
  analyzer.invalidatePhase();

  const afterInvalidation = analyzer.update(landmarks, 1600);
  assert.equal(afterInvalidation.elapsedMs, beforeInvalidation.elapsedMs);
  assert.equal(afterInvalidation.active, false);
  assert.equal(analyzer.update(landmarks, 2000).active, true);
  assert.equal(analyzer.update(landmarks, 2100).elapsedMs, 200);
});
