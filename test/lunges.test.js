import assert from 'node:assert/strict';
import test from 'node:test';

import { createLungeAnalyzer } from '../src/exercises/lunges.js';

function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function kneePose(hipX, kneeAngle, hipDrop = 0) {
  const knee = point(hipX, 0.7);
  const angle = ((-90 + kneeAngle) * Math.PI) / 180;
  return {
    hip: point(hipX, 0.55 + hipDrop),
    knee,
    ankle: point(
      knee.x + 0.15 * Math.cos(angle),
      knee.y + 0.15 * Math.sin(angle),
    ),
  };
}

function standingPose() {
  return makeLungePose(180, 180);
}

function lungePose(side, { workingAngle = 100, hipDrop = 0.06 } = {}) {
  return side === 'left'
    ? makeLungePose(workingAngle, 150, hipDrop)
    : makeLungePose(150, workingAngle, hipDrop);
}

function makeLungePose(leftAngle, rightAngle, hipDrop = 0) {
  const left = kneePose(0.42, leftAngle, hipDrop);
  const right = kneePose(0.51, rightAngle, hipDrop);
  const landmarks = Array.from({ length: 33 }, () => null);
  Object.assign(landmarks, {
    11: point(0.4, 0.25),
    12: point(0.49, 0.25),
    23: left.hip,
    24: right.hip,
    25: left.knee,
    26: right.knee,
    27: left.ankle,
    28: right.ankle,
  });
  return landmarks;
}

function feed(analyzer, landmarks, startMs, frames = 5) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, startMs + frame * 33);
  }
  return result;
}

function feedResults(analyzer, landmarks, startMs, frames = 5) {
  return Array.from({ length: frames }, (_, frame) =>
    analyzer.update(landmarks, startMs + frame * 33),
  );
}

test('lunges count consecutive same-side moderate-depth cycles', () => {
  const analyzer = createLungeAnalyzer();
  assert.equal(analyzer.update(standingPose(), 0).count, 0);
  assert.equal(analyzer.update(lungePose('left', { workingAngle: 125 }), 33).count, 0);
  assert.equal(analyzer.update(standingPose(), 66).count, 1);
  assert.equal(analyzer.update(lungePose('left', { workingAngle: 125 }), 99).count, 1);
  assert.equal(analyzer.update(standingPose(), 132).count, 1);
  analyzer.update(standingPose(), 600);
  analyzer.update(lungePose('left', { workingAngle: 125 }), 633);
  assert.equal(analyzer.update(standingPose(), 666).count, 2);
});

test('lunges count when only one side is available', () => {
  const analyzer = createLungeAnalyzer();
  const oneSide = (pose) => {
    pose[24] = null;
    pose[26] = null;
    pose[28] = null;
    return pose;
  };
  assert.equal(analyzer.update(oneSide(standingPose()), 0).count, 0);
  assert.equal(analyzer.update(oneSide(lungePose('left', { workingAngle: 125 })), 33).count, 0);
  assert.equal(analyzer.update(oneSide(standingPose()), 66).count, 1);
});

test('lunges ignore finite landmarks when both legs are not visible', () => {
  const analyzer = createLungeAnalyzer();
  const setInvisible = (pose) => {
    for (const index of [23, 24, 25, 26, 27, 28]) {
      pose[index].visibility = 0.1;
    }
    return pose;
  };
  assert.equal(analyzer.update(setInvisible(standingPose()), 0).count, 0);
  assert.equal(analyzer.update(setInvisible(lungePose('left')), 33).count, 0);
  assert.equal(analyzer.update(setInvisible(standingPose()), 66).count, 0);
});

test('lunges need a standing start, knee bend, and hip drop', () => {
  const startsBent = createLungeAnalyzer();
  assert.equal(startsBent.update(lungePose('left'), 0).count, 0);
  assert.equal(startsBent.update(standingPose(), 33).count, 0);

  const kneeOnly = createLungeAnalyzer();
  kneeOnly.update(standingPose(), 0);
  kneeOnly.update(lungePose('left', { workingAngle: 125, hipDrop: 0 }), 33);
  assert.equal(kneeOnly.update(standingPose(), 66).count, 0);
});

test('lunge cooldown blocks rapid duplicate cycles', () => {
  const analyzer = createLungeAnalyzer();
  const standing = () => standingPose();
  const lunge = () => lungePose('left', { workingAngle: 125 });
  analyzer.update(standing(), 0);
  analyzer.update(lunge(), 33);
  assert.equal(analyzer.update(standing(), 66).count, 1);

  analyzer.update(lunge(), 100);
  assert.equal(analyzer.update(standing(), 133).count, 1);
  analyzer.update(standing(), 600);
  analyzer.update(lunge(), 633);
  assert.equal(analyzer.update(standing(), 666).count, 2);
});

test('lunges count complete alternating left-right and right-left cycles', () => {
  for (const order of [['left', 'right'], ['right', 'left']]) {
    const analyzer = createLungeAnalyzer();
    feed(analyzer, standingPose(), 0);
    feed(analyzer, lungePose(order[0]), 165);
    feed(analyzer, standingPose(), 330);
    feed(analyzer, standingPose(), 900);
    feed(analyzer, lungePose(order[1]), 1065);
    const result = feed(analyzer, standingPose(), 1230);
    assert.equal(result.count, 2);
  }
});

test('lunges do not count a bend without a return', () => {
  const incomplete = createLungeAnalyzer();
  incomplete.update(standingPose(), 0);
  const result = incomplete.update(lungePose('left', { workingAngle: 125 }), 33);
  assert.equal(result.count, 0);
});

test('lunges skip missing landmarks and discard cycles after tracking loss', () => {
  const missingPose = standingPose();
  for (const index of [23, 24, 25, 26, 27, 28]) {
    missingPose[index] = null;
  }
  const analyzer = createLungeAnalyzer();
  const missing = feed(analyzer, missingPose, 0);
  assert.equal(missing.count, 0);
  assert.equal(missing.rejectionReasonId, 'missing-landmarks');

  const lost = createLungeAnalyzer();
  feed(lost, standingPose(), 0);
  feed(lost, lungePose('left', { workingAngle: 125 }), 165);
  lost.update([], 700);
  assert.equal(feed(lost, standingPose(), 800).count, 0);
});
