import assert from 'node:assert/strict';
import test from 'node:test';

import { createSitUpAnalyzer } from '../src/exercises/sit-ups.js';

function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function poseAtTrunkAngle(angleDegrees, confidence = 0.9) {
  const angle = (angleDegrees * Math.PI) / 180;
  const hip = point(0.5, 0.6, confidence);
  const shoulder = point(
    hip.x - 0.3 * Math.cos(angle),
    hip.y - 0.3 * Math.sin(angle),
    confidence,
  );
  const landmarks = Array.from({ length: 33 }, () => null);
  Object.assign(landmarks, {
    11: shoulder,
    12: point(shoulder.x + 0.01, shoulder.y, confidence),
    23: hip,
    24: point(hip.x + 0.01, hip.y, confidence),
    25: point(0.7, 0.6, confidence),
    26: point(0.71, 0.6, confidence),
  });
  return landmarks;
}

const loweredPose = () => poseAtTrunkAngle(0);
const risingPose = () => poseAtTrunkAngle(40);
const uprightPose = () => poseAtTrunkAngle(90);

function feed(analyzer, landmarks, startMs, frames = 5) {
  let result;
  for (let frame = 0; frame < frames; frame += 1) {
    result = analyzer.update(landmarks, startMs + frame * 33);
  }
  return result;
}

test('sit-up requires a lying start and a clear trunk rise before returning', () => {
  const analyzer = createSitUpAnalyzer();
  assert.equal(analyzer.update(uprightPose(), 0).count, 0);
  assert.equal(analyzer.update(loweredPose(), 33).count, 0);
  analyzer.update(poseAtTrunkAngle(10), 66);
  assert.equal(analyzer.update(poseAtTrunkAngle(35), 99).count, 0);
  assert.equal(analyzer.update(poseAtTrunkAngle(10), 132).count, 0);
  analyzer.update(poseAtTrunkAngle(60), 165);
  assert.equal(analyzer.update(poseAtTrunkAngle(10), 198).count, 1);
  assert.equal(analyzer.update(poseAtTrunkAngle(10), 231).count, 1);
});

test('sit-up cooldown requires a fresh lying-to-raised cycle', () => {
  const analyzer = createSitUpAnalyzer();
  analyzer.update(loweredPose(), 0);
  analyzer.update(poseAtTrunkAngle(60), 33);
  assert.equal(analyzer.update(loweredPose(), 66).count, 1);

  analyzer.update(poseAtTrunkAngle(60), 100);
  assert.equal(analyzer.update(loweredPose(), 133).count, 1);
  analyzer.update(loweredPose(), 600);
  analyzer.update(poseAtTrunkAngle(60), 633);
  assert.equal(analyzer.update(loweredPose(), 666).count, 2);
});

test('sit-up ignores finite but invisible shoulder and hip landmarks', () => {
  const analyzer = createSitUpAnalyzer();
  assert.equal(analyzer.update(poseAtTrunkAngle(0, 0.2), 0).count, 0);
  assert.equal(analyzer.update(poseAtTrunkAngle(60, 0.2), 33).count, 0);
  assert.equal(analyzer.update(poseAtTrunkAngle(10, 0.2), 66).count, 0);
  assert.equal(analyzer.update(poseAtTrunkAngle(45), 99).count, 0);
});

test('sit-up uses either available shoulder and hip pair', () => {
  const analyzer = createSitUpAnalyzer();
  const oneSide = (angle) => {
    const landmarks = poseAtTrunkAngle(angle);
    landmarks[12] = null;
    landmarks[24] = null;
    return landmarks;
  };
  assert.equal(analyzer.update(oneSide(0), 0).count, 0);
  assert.equal(analyzer.update(oneSide(60), 33).count, 0);
  assert.equal(analyzer.update(oneSide(10), 66).count, 1);
});

test('sit-up clears a pending rise after a sustained tracking gap', () => {
  const lost = createSitUpAnalyzer();
  lost.update(loweredPose(), 0);
  lost.update(risingPose(), 33);
  lost.update([], 533);
  assert.equal(lost.update(loweredPose(), 566).count, 0);
});
