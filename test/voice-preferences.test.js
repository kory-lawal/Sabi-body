import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadVoicePreferences,
  saveVoicePreferences,
} from '../src/feedback/preferences.js';

test('voice preferences enable automatic coaching by default and persist the mute override', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  const defaults = loadVoicePreferences(storage);

  assert.deepEqual(defaults, {
    language: 'en',
    voiceEnabled: true,
    voiceVolume: 1,
    voiceId: '',
  });
  assert.equal(saveVoicePreferences({
    language: 'yo',
    voiceEnabled: true,
    voiceVolume: 0.4,
    voiceId: 'yoruba-voice',
  }, storage), true);
  assert.deepEqual(loadVoicePreferences(storage), {
    language: 'en',
    voiceEnabled: true,
    voiceVolume: 0.4,
    voiceId: 'yoruba-voice',
  });
  assert.equal(saveVoicePreferences({ voiceEnabled: false }, storage), true);
  assert.equal(loadVoicePreferences(storage).voiceEnabled, false);
});

test('legacy non-English preferences normalize and prior rep-only mode becomes automatic coaching', () => {
  const storage = {
    getItem() {
      return JSON.stringify({
        language: 'pcm',
        voiceEnabled: false,
        countEachRep: true,
      });
    },
  };

  assert.deepEqual(loadVoicePreferences(storage), {
    language: 'en',
    voiceEnabled: true,
    voiceVolume: 1,
    voiceId: '',
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
    language: 'en',
    voiceEnabled: true,
    voiceVolume: 1,
    voiceId: '',
  });
  assert.equal(saveVoicePreferences({ language: 'ig' }, storage), false);
});