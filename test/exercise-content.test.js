import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EXERCISES } from '../src/ui/exercise-content.js';

const expectedExercises = {
  squats: {
    filename: 'Squats.png',
    benefits: 'Helps strengthen your thighs, hips and glutes while improving lower-body strength.',
  },
  'jumping-jacks': {
    filename: 'Jumping Jacks.png',
    benefits: 'Gets your heart pumping, improves cardiovascular fitness and helps warm up your whole body.',
  },
  plank: {
    filename: 'Plank.png',
    benefits: 'Helps strengthen your core, improve stability and support better posture.',
  },
  'push-ups': {
    filename: 'Push-ups.png',
    benefits: 'Strengthens your chest, shoulders, arms and core.',
  },
  'sit-ups': {
    filename: 'Sit-ups.png',
    benefits: 'Works your abdominal muscles and helps build core strength.',
  },
  lunges: {
    filename: 'Lunges.png',
    benefits: 'Helps strengthen your legs and glutes while improving balance and stability.',
  },
};

test('all six exercises reference their matching imported pictures and requested benefits', () => {
  assert.deepEqual(Object.keys(EXERCISES), Object.keys(expectedExercises));

  for (const [exerciseId, expected] of Object.entries(expectedExercises)) {
    const exercise = EXERCISES[exerciseId];

    assert.equal(exercise.media.type, 'image');
    assert.equal(decodeURIComponent(exercise.media.src.split('/').at(-1)), expected.filename);
    assert.equal(existsSync(fileURLToPath(exercise.media.src)), true);
    assert.equal(exercise.benefits, expected.benefits);
    assert.ok(exercise.instructions.length > 0);
    assert.ok(exercise.instruction.length > 0);
    assert.ok(exercise.cameraInstruction.length > 0);
  }
});

test('every exercise refers to a distinct image file', () => {
  const imagePaths = Object.values(EXERCISES).map(({ media }) => media.src);
  assert.equal(new Set(imagePaths).size, Object.keys(EXERCISES).length);
});
