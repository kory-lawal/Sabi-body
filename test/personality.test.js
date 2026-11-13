import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COACH_PERSONALITIES,
  DEFAULT_PERSONALITY,
  getPersonalityMessageId,
  isSpeakableFeedback,
  loadPersonality,
  savePersonality,
} from '../src/feedback/personality.js';

test('friendly coach is the default and all three personalities are available', () => {
  assert.equal(DEFAULT_PERSONALITY, 'friendly');
  assert.deepEqual(
    COACH_PERSONALITIES.map(({ id }) => id),
    ['quiet', 'friendly', 'energetic'],
  );
});

test('quiet coach limits speech to counts, essential corrections, and completion', () => {
  assert.equal(isSpeakableFeedback('quiet', 'adjust-alignment'), true);
  assert.equal(isSpeakableFeedback('quiet', 'body-not-visible'), true);
  assert.equal(isSpeakableFeedback('quiet', 'exercise-completed'), true);
  assert.equal(isSpeakableFeedback('quiet', 'great-job'), false);
  assert.equal(isSpeakableFeedback('quiet', 'keep-going'), false);
  assert.equal(isSpeakableFeedback('quiet', 'final-repetition'), false);
    assert.equal(isSpeakableFeedback('quiet', 'welcome'), false);
    assert.equal(isSpeakableFeedback('quiet', 'workout-countdown'), true);
    assert.equal(isSpeakableFeedback('quiet', 'ready'), false);
});

test('friendly and energetic coaching share event cadence while energetic selects variants', () => {
  assert.equal(isSpeakableFeedback('friendly', 'great-job'), true);
    assert.equal(isSpeakableFeedback('friendly', 'welcome'), true);
    assert.equal(isSpeakableFeedback('friendly', 'workout-countdown'), true);
  assert.equal(isSpeakableFeedback('energetic', 'great-job'), true);
  assert.equal(isSpeakableFeedback('energetic', 'body-not-visible'), true);
  assert.equal(getPersonalityMessageId('friendly', 'great-job'), 'great-job');
  assert.equal(getPersonalityMessageId('energetic', 'great-job'), 'energetic-great-job');
});

test('personality storage defaults safely and rejects unknown values', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };

  assert.equal(loadPersonality(storage), 'friendly');
  assert.equal(savePersonality('energetic', storage), true);
  assert.equal(loadPersonality(storage), 'energetic');
  assert.equal(savePersonality('unknown', storage), false);
  values.set('sabi-body-coach-personality', 'unknown');
  assert.equal(loadPersonality(storage), 'friendly');
});

test('personality storage failures do not throw or claim persistence', () => {
  const storage = {
    getItem() { throw new Error('storage unavailable'); },
    setItem() { throw new Error('storage unavailable'); },
  };

  assert.equal(loadPersonality(storage), 'friendly');
  assert.equal(savePersonality('quiet', storage), false);
});