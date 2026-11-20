import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { EXERCISES } from '../src/ui/exercise-content.js';

const expectedExercises = {
  squats: {
    filename: 'Squats.png',
    description: 'A controlled lower-body exercise that bends the hips and knees before returning to standing.',
    targetMuscles: ['Quadriceps', 'Glutes', 'Hamstrings'],
    benefits: 'Helps strengthen your thighs, hips and glutes while improving lower-body strength.',
  },
  'jumping-jacks': {
    filename: 'Jumping Jacks.png',
    description: 'A full-body cardio movement that combines a jump with coordinated arm and leg movement.',
    targetMuscles: ['Calves', 'Shoulders', 'Glutes'],
    benefits: 'Gets your heart pumping, improves cardiovascular fitness and helps warm up your whole body.',
  },
  plank: {
    filename: 'Plank.png',
    description: 'A stationary core exercise that holds the body in a steady, straight line.',
    targetMuscles: ['Abdominals', 'Obliques', 'Shoulders'],
    benefits: 'Helps strengthen your core, improve stability and support better posture.',
  },
  'push-ups': {
    filename: 'Push-ups.png',
    description: 'A bodyweight press that lowers and raises the chest from a straight-arm plank.',
    targetMuscles: ['Chest', 'Shoulders', 'Triceps', 'Core'],
    benefits: 'Strengthens your chest, shoulders, arms and core.',
  },
  'sit-ups': {
    filename: 'Sit-ups.png',
    description: 'A trunk-flexion exercise that lifts the upper body from a lying position.',
    targetMuscles: ['Abdominals', 'Hip flexors'],
    benefits: 'Works your abdominal muscles and helps build core strength.',
  },
  lunges: {
    filename: 'Lunges.png',
    description: 'A single-leg exercise that bends both knees while one foot steps back.',
    targetMuscles: ['Quadriceps', 'Glutes', 'Hamstrings'],
    benefits: 'Helps strengthen your legs and glutes while improving balance and stability.',
  },
  'high-knees': {
    filename: 'High Knees.png',
    description: 'A standing cardio drill that alternately drives each knee toward hip height.',
    targetMuscles: ['Hip flexors', 'Quadriceps', 'Calves'],
    benefits: 'Builds cardiovascular endurance while challenging the hip flexors and legs.',
  },
};

test('all seven supported exercises reference their matching images and exercise content', () => {
  assert.deepEqual(Object.keys(EXERCISES), Object.keys(expectedExercises));

  for (const [exerciseId, expected] of Object.entries(expectedExercises)) {
    const exercise = EXERCISES[exerciseId];

    assert.equal(exercise.media.type, 'image');
    assert.equal(decodeURIComponent(exercise.media.src.split('/').at(-1)), expected.filename);
    assert.equal(existsSync(fileURLToPath(exercise.media.src)), true);
    assert.equal(exercise.description, expected.description);
    assert.deepEqual(exercise.targetMuscles, expected.targetMuscles);
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
