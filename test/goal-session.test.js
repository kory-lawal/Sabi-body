import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultTarget,
  getMilestoneThresholds,
  normalizeGoalTarget,
} from '../src/ui/app.js';

test('default targets follow the approved exercise defaults', () => {
  assert.equal(getDefaultTarget('squats'), 10);
  assert.equal(getDefaultTarget('jumping-jacks'), 10);
  assert.equal(getDefaultTarget('plank'), 30);
  assert.equal(getDefaultTarget('push-ups'), 5);
  assert.equal(getDefaultTarget('sit-ups'), 6);
  assert.equal(getDefaultTarget('lunges'), 10);
});

test('custom goals are bounded and validated per exercise type', () => {
  assert.equal(normalizeGoalTarget('squats', 25), 25);
  assert.equal(normalizeGoalTarget('plank', 45), 45);
  assert.equal(normalizeGoalTarget('squats', 0), 10);
  assert.equal(normalizeGoalTarget('plank', 5000), 30);
  assert.equal(normalizeGoalTarget('push-ups', 12), 12);
  assert.equal(normalizeGoalTarget('sit-ups', 201), 6);
  assert.equal(normalizeGoalTarget('lunges', 0), 10);
});

test('milestones are deduplicated and include the final target-minus-one cue', () => {
  assert.deepEqual(getMilestoneThresholds(20), [5, 10, 15, 19]);
  assert.deepEqual(getMilestoneThresholds(8), [2, 4, 6, 7]);
});
