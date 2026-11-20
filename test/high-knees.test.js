import assert from 'node:assert/strict';
import test from 'node:test';

import { createHighKneesAnalyzer } from '../src/exercises/high-knees.js';

function point(x, y, confidence = 0.95) {
  return { x, y, visibility: confidence, presence: confidence };
}

function pose({
  leftKnee = [0.45, 0.7],
  rightKnee = [0.55, 0.7],
  leftAnkle = [0.45, 0.9],
  rightAnkle = [0.55, 0.9],
} = {}) {
  const landmarks = Array.from({ length: 33 }, () => null);
  Object.assign(landmarks, {
    11: point(0.45, 0.2),
    12: point(0.55, 0.2),
    23: point(0.45, 0.5),
    24: point(0.55, 0.5),
    25: point(...leftKnee),
    26: point(...rightKnee),
    27: point(...leftAnkle),
    28: point(...rightAnkle),
  });
  return landmarks;
}

const neutral = () => pose();
const leftLift = () => pose({ leftKnee: [0.37, 0.45], leftAnkle: [0.35, 0.64] });
const rightLift = () => pose({ rightKnee: [0.63, 0.45], rightAnkle: [0.65, 0.64] });

test('high knees require a stable upright pose and count alternating lift-return cycles', () => {
  const analyzer = createHighKneesAnalyzer();

  assert.equal(analyzer.checkReady(neutral(), 0).ready, false);
  assert.equal(analyzer.checkReady(neutral(), 400).ready, true);
  analyzer.update(neutral(), 0);
  analyzer.update(leftLift(), 33);
  assert.equal(analyzer.update(neutral(), 66).count, 1);
  analyzer.update(neutral(), 400);
  analyzer.update(rightLift(), 433);
  assert.equal(analyzer.update(neutral(), 466).count, 2);
});

test('high knees do not count an unreturned lift or duplicate neutral frames', () => {
  const analyzer = createHighKneesAnalyzer();
  analyzer.update(neutral(), 0);
  assert.equal(analyzer.update(leftLift(), 33).count, 0);
  assert.equal(analyzer.update(leftLift(), 66).count, 0);
  assert.equal(analyzer.update(neutral(), 99).count, 1);
  assert.equal(analyzer.update(neutral(), 132).count, 1);
});

test('high knees discard a pending lift after landmarks are lost', () => {
  const analyzer = createHighKneesAnalyzer();
  analyzer.update(neutral(), 0);
  analyzer.update(leftLift(), 33);
  analyzer.update([], 533);

  assert.equal(analyzer.update(neutral(), 566).count, 0);
});
