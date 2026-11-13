import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushUpAnalyzer } from '../src/exercises/push-ups.js';

function point(x, y, confidence = 0.9) {
  return { x, y, visibility: confidence, presence: confidence };
}

function pose({
  elbowAngle = 180,
  hipOffset = 0,
  shoulderDrop = 0,
  confidence = 0.9,
} = {}) {
  const landmarks = Array.from({ length: 33 }, () => null);
  const shoulder = point(0.2, 0.5 + shoulderDrop, confidence);
  const elbow = point(0.4, 0.5 + shoulderDrop, confidence);
  const wristDirection = ((180 - elbowAngle) * Math.PI) / 180;
  const wrist = point(
    elbow.x + 0.2 * Math.cos(wristDirection),
    elbow.y + 0.2 * Math.sin(wristDirection),
    confidence,
  );
  Object.assign(landmarks, {
    11: shoulder,
    12: point(0.21, 0.5, confidence),
    13: elbow,
    15: wrist,
    23: point(0.5, 0.5 + hipOffset, confidence),
    24: point(0.51, 0.5 + hipOffset, confidence),
    27: point(0.8, 0.5, confidence),
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

test('push-up counts one complete extended-bent-extended cycle', () => {
  const analyzer = createPushUpAnalyzer();
  feed(analyzer, pose({ elbowAngle: 180 }), 0);
  feed(analyzer, pose({ elbowAngle: 90, shoulderDrop: 0.06 }), 165);
  const result = feed(analyzer, pose({ elbowAngle: 180 }), 330);
  assert.equal(result.count, 1);
  assert.equal(result.state, 'extended');
});

test('push-up counts a moderate elbow bend and extension once', () => {
  const analyzer = createPushUpAnalyzer();
  assert.equal(analyzer.update(pose({ elbowAngle: 180 }), 0).count, 0);
  assert.equal(
    analyzer.update(pose({ elbowAngle: 125, shoulderDrop: 0.06 }), 33).count,
    0,
  );
  assert.equal(analyzer.update(pose({ elbowAngle: 180 }), 66).count, 1);
  assert.equal(analyzer.update(pose({ elbowAngle: 180 }), 99).count, 1);
});

test('push-up requires an extended start and upper-body drop', () => {
  const startsBent = createPushUpAnalyzer();
  assert.equal(startsBent.update(pose({ elbowAngle: 100 }), 0).count, 0);
  assert.equal(startsBent.update(pose({ elbowAngle: 180 }), 33).count, 0);

  const armOnly = createPushUpAnalyzer();
  armOnly.update(pose({ elbowAngle: 180 }), 0);
  armOnly.update(pose({ elbowAngle: 100 }), 33);
  assert.equal(armOnly.update(pose({ elbowAngle: 180 }), 66).count, 0);
});

test('push-up cooldown blocks rapid duplicate elbow cycles', () => {
  const analyzer = createPushUpAnalyzer();
  const top = () => pose({ elbowAngle: 180 });
  const bottom = () => pose({ elbowAngle: 120, shoulderDrop: 0.06 });
  analyzer.update(top(), 0);
  analyzer.update(bottom(), 33);
  assert.equal(analyzer.update(top(), 66).count, 1);

  analyzer.update(bottom(), 100);
  assert.equal(analyzer.update(top(), 133).count, 1);
  analyzer.update(top(), 600);
  analyzer.update(bottom(), 633);
  assert.equal(analyzer.update(top(), 666).count, 2);
});

test('push-up ignores finite but invisible arm and torso landmarks', () => {
  const lowConfidence = createPushUpAnalyzer();
  assert.equal(lowConfidence.update(pose({ elbowAngle: 180, confidence: 0.2 }), 0).count, 0);
  assert.equal(lowConfidence.update(pose({ elbowAngle: 125, shoulderDrop: 0.06, confidence: 0.2 }), 33).count, 0);
  assert.equal(lowConfidence.update(pose({ elbowAngle: 160, confidence: 0.2 }), 66).count, 0);

  const oneSide = createPushUpAnalyzer();
  for (const [angle, shoulderDrop, time] of [
    [180, 0, 0],
    [125, 0.06, 33],
    [180, 0, 66],
  ]) {
    const landmarks = pose({ elbowAngle: angle, shoulderDrop });
    landmarks[12] = null;
    landmarks[14] = null;
    landmarks[16] = null;
    assert.equal(oneSide.update(landmarks, time).count, angle === 180 && time === 66 ? 1 : 0);
  }
});

test('push-up skips low-confidence or missing joints', () => {
  const lowConfidence = createPushUpAnalyzer();
  assert.equal(lowConfidence.update(pose({ elbowAngle: 180, confidence: 0.2 }), 0).count, 0);
  assert.equal(lowConfidence.update(pose({ elbowAngle: 90, shoulderDrop: 0.06, confidence: 0.2 }), 33).count, 0);
  assert.equal(lowConfidence.update(pose({ elbowAngle: 180, confidence: 0.2 }), 66).count, 0);

  const missing = createPushUpAnalyzer();
  const missingWrist = pose({ elbowAngle: 90 });
  missingWrist[15] = null;
  const missingResult = missing.update(missingWrist, 0);
  assert.equal(missingResult.count, 0);
  assert.equal(missingResult.rejectionReasonId, 'missing-landmarks');

  const lost = createPushUpAnalyzer();
  lost.update(pose({ elbowAngle: 180 }), 0);
  lost.update(pose({ elbowAngle: 90, shoulderDrop: 0.06 }), 33);
  lost.update([], 533);
  assert.equal(lost.update(pose({ elbowAngle: 180 }), 566).count, 0);
});
