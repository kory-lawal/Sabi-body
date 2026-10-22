import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGES, translateMessage } from '../src/feedback/messages.js';
import { createSpeechCoach } from '../src/feedback/speech.js';
import { createYarnGPTClient } from '../src/services/yarngpt.js';

const EXPECTED_LANGUAGE_CODES = ['en', 'yo', 'ig', 'ha', 'pcm'];

test('LANGUAGES includes every supported language code', () => {
  assert.deepEqual(
    LANGUAGES.map(({ code }) => code),
    EXPECTED_LANGUAGE_CODES,
  );
});

test('English message lookup returns the catalog text without fallback', () => {
  const result = translateMessage('great-job', 'en');

  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.length > 0);
  assert.equal(result.isFallback, false);
});

test('untranslated supported languages fall back to English', () => {
  const english = translateMessage('great-job', 'en');

  for (const languageCode of ['yo', 'ig', 'ha', 'pcm']) {
    assert.deepEqual(translateMessage('great-job', languageCode), {
      text: english.text,
      isFallback: true,
    });
  }
});

test('unknown message IDs return an explicit safe English fallback', () => {
  const result = translateMessage('not-a-real-message', 'en');

  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.trim().length > 0);
  assert.equal(result.isFallback, true);
});

test('unknown message IDs cannot resolve inherited object properties', () => {
  const result = translateMessage('toString', 'en');

  assert.equal(typeof result.text, 'string');
  assert.equal(result.isFallback, true);
});

test('all analyzer message identifiers have English text', () => {
  for (const messageId of [
    'ready',
    'body-not-visible',
    'move-lower',
    'return-to-start',
    'great-job',
    'keep-going',
    'aligned',
    'adjust-alignment',
    'camera-error',
    'exercise-completed',
  ]) {
    assert.ok(translateMessage(messageId, 'en').text);
    assert.equal(translateMessage(messageId, 'en').isFallback, false);
  }
});

function createSpeechHarness() {
  const spoken = [];
  let cancelCount = 0;

  class Utterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
    }
  }

  return {
    spoken,
    synthesis: {
      speak(utterance) {
        spoken.push(utterance);
      },
      cancel() {
        cancelCount += 1;
      },
      get cancelCount() {
        return cancelCount;
      },
    },
    Utterance,
  };
}

test('enabled speech speaks one English utterance', () => {
  const harness = createSpeechHarness();
  const coach = createSpeechCoach(harness);
  coach.setEnabled(true);

  const result = coach.speak('great-job', 'Great work!', 'en');

  assert.equal(result, true);
  assert.equal(harness.spoken.length, 1);
  assert.equal(harness.spoken[0].text, 'Great work!');
  assert.equal(harness.spoken[0].lang, 'en');
});

test('speech cooldown prevents repeated utterances', () => {
  const harness = createSpeechHarness();
  let timestamp = 1000;
  const coach = createSpeechCoach({
    ...harness,
    now: () => timestamp,
    cooldownMs: 5000,
  });
  coach.setEnabled(true);

  assert.equal(coach.speak('great-job', 'Great work!', 'en'), true);
  timestamp += 4999;
  assert.equal(coach.speak('great-job', 'Great work!', 'en'), false);
  timestamp += 1;
  assert.equal(coach.speak('great-job', 'Great work!', 'en'), true);
  assert.equal(harness.spoken.length, 2);
});

test('speech does not speak fallback feedback in a non-English language', () => {
  const harness = createSpeechHarness();
  const coach = createSpeechCoach(harness);
  coach.setEnabled(true);

  assert.equal(coach.speak('great-job', 'Great work!', 'yo'), false);
  assert.equal(harness.spoken.length, 0);
});

test('disabling or cancelling speech cancels synthesis and disabled speech is ignored', () => {
  const harness = createSpeechHarness();
  const coach = createSpeechCoach(harness);
  coach.setEnabled(true);
  assert.equal(coach.speak('great-job', 'Great work!', 'en'), true);

  coach.setEnabled(false);
  assert.equal(coach.speak('great-job', 'Great work!', 'en'), false);
  coach.cancel();

  assert.equal(harness.synthesis.cancelCount, 2);
  assert.equal(harness.spoken.length, 1);
});

test('speech API failures are surfaced to the caller', () => {
  const failure = new Error('speech is unavailable');
  const coach = createSpeechCoach({
    synthesis: {
      speak() {
        throw failure;
      },
      cancel() {},
    },
    Utterance: class {
      constructor(text) {
        this.text = text;
      }
    },
  });
  coach.setEnabled(true);

  assert.throws(() => coach.speak('great-job', 'Great work!', 'en'), {
    cause: failure,
  });
});

test('YarnGPT client posts only the message ID and language to the endpoint', async () => {
  let request;
  const client = createYarnGPTClient({
    endpoint: '/api/yarngpt',
    fetchImpl: async (...args) => {
      request = args;
      return {
        ok: true,
        async json() {
          return { text: 'Great work!' };
        },
      };
    },
  });

  assert.deepEqual(
    await client.synthesize({ messageId: 'great-job', language: 'en' }),
    { text: 'Great work!' },
  );
  assert.equal(request[0], '/api/yarngpt');
  assert.equal(request[1].method, 'POST');
  assert.equal(request[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request[1].body), {
    messageId: 'great-job',
    language: 'en',
  });
});

test('YarnGPT client rejects empty and cross-origin endpoints', () => {
  assert.throws(() => createYarnGPTClient({ endpoint: '' }), /non-empty/i);
  assert.throws(
    () => createYarnGPTClient({ endpoint: 'https://example.com/api' }),
    /same-origin/i,
  );
});

test('YarnGPT client reports HTTP and network failures descriptively', async () => {
  const rejected = createYarnGPTClient({
    endpoint: '/api/yarngpt',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(
    rejected.synthesize({ messageId: 'great-job', language: 'en' }),
    /503/,
  );

  const unavailable = new Error('connection refused');
  const disconnected = createYarnGPTClient({
    endpoint: '/api/yarngpt',
    fetchImpl: async () => {
      throw unavailable;
    },
  });
  await assert.rejects(
    disconnected.synthesize({ messageId: 'great-job', language: 'en' }),
    /network|fetch/i,
  );
});
