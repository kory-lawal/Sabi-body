import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadVoicePreferences,
  saveVoicePreferences,
} from '../src/feedback/preferences.js';

test('voice preferences default safely and persist valid settings locally', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const defaults = loadVoicePreferences(storage);

  assert.deepEqual(defaults, {
    language: 'en',
    voiceEnabled: false,
    voiceVolume: 1,
    voiceId: '',
    countEachRep: false,
  });
  assert.equal(saveVoicePreferences({
    language: 'yo',
    voiceEnabled: true,
    voiceVolume: 0.4,
    voiceId: 'yoruba-voice',
    countEachRep: true,
  }, storage), true);
  assert.deepEqual(loadVoicePreferences(storage), {
    language: 'yo',
    voiceEnabled: true,
    voiceVolume: 0.4,
    voiceId: 'yoruba-voice',
    countEachRep: true,
  });
});

test('invalid or inaccessible stored voice preferences fall back to safe defaults', () => {
  const storage = {
    getItem() {
      return JSON.stringify({ language: 'pcm', voiceEnabled: 'yes', voiceVolume: 4, voiceId: {}, countEachRep: 1 });
    },
    setItem() { throw new Error('storage unavailable'); },
  };

  assert.deepEqual(loadVoicePreferences(storage), {
    language: 'pcm',
    voiceEnabled: false,
    voiceVolume: 1,
    voiceId: '',
    countEachRep: false,
  });
  assert.equal(saveVoicePreferences({ language: 'ig' }, storage), false);
});