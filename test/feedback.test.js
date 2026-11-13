import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGES, translateMessage } from '../src/feedback/messages.js';
import { createSpeechCoach } from '../src/feedback/speech.js';
import { createVoiceClient } from '../src/services/voice-client.js';

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

test('energetic message variants resolve for every language with draft metadata', () => {
  for (const languageCode of EXPECTED_LANGUAGE_CODES) {
    const result = translateMessage('energetic-great-job', languageCode);
    assert.ok(result.text.length > 0);
    assert.equal(result.isFallback, false);
    assert.equal(result.translationStatus, languageCode === 'en' ? 'verified' : 'unverified');
  }
});

test('localized milestone messages interpolate only approved values', () => {
  const result = translateMessage('milestone-reps', 'yo', {
    count: 5,
    target: 20,
    unexpected: 'ignored',
  });

  assert.match(result.text, /5/);
  assert.match(result.text, /20/);
  assert.doesNotMatch(result.text, /ignored/);
  assert.equal(result.translationStatus, 'unverified');
});

test('coaching dictionary contains the required exercise and voice-test events in every language', () => {
  for (const messageId of [
    'welcome',
    'camera-positioning',
    'workout-countdown',
    'repetition-count',
    'remaining-reps',
    'halfway',
    'final-repetition',
    'workout-paused',
    'workout-resumed',
    'test-count-sequence',
    'test-positioning',
    'test-completion',
  ]) {
    for (const { code } of LANGUAGES) {
      const result = translateMessage(messageId, code, { count: 3, remaining: 5, target: 10 });
      assert.ok(result.text.length > 0, `${messageId}/${code} should have readable text`);
      assert.equal(result.isFallback, false, `${messageId}/${code} should not silently fall back`);
      assert.equal(result.translationStatus, code === 'en' ? 'verified' : 'unverified');
    }
  }
});

test('untranslated supported languages fall back to English', () => {
  const english = translateMessage('camera-error', 'en');

  for (const languageCode of ['yo', 'ig', 'ha', 'pcm']) {
    const result = translateMessage('camera-error', languageCode);
    assert.equal(result.text, english.text);
    assert.equal(result.isFallback, true);
  }
});

test('translated draft messages disclose their unverified status', () => {
  for (const languageCode of ['yo', 'ig', 'ha', 'pcm']) {
    assert.equal(translateMessage('great-job', languageCode).translationStatus, 'unverified');
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
    'alternate-legs',
  ]) {
    assert.ok(translateMessage(messageId, 'en').text);
    assert.equal(translateMessage(messageId, 'en').isFallback, false);
  }
});

test('alternate-leg coaching is available in English and explicitly falls back elsewhere', () => {
  const english = translateMessage('alternate-legs', 'en');
  assert.match(english.text, /opposite leg/i);
  assert.equal(english.isFallback, false);

  for (const languageCode of ['yo', 'ig', 'ha', 'pcm']) {
    const localized = translateMessage('alternate-legs', languageCode);
    assert.equal(localized.text, english.text);
    assert.equal(localized.isFallback, true);
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

test('asynchronous utterance errors are surfaced to the caller', () => {
  const harness = createSpeechHarness();
  const errors = [];
  const coach = createSpeechCoach({
    ...harness,
    onError(error) {
      errors.push(error);
    },
  });
  coach.setEnabled(true);
  coach.speak('great-job', 'Great work!', 'en');

  const event = { error: 'synthesis-failed' };
  harness.spoken[0].onerror(event);

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /speech synthesis failed/i);
  assert.equal(errors[0].cause, event);
});

test('voice client posts only the message ID and language to the endpoint', async () => {
  let request;
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
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
  assert.equal(request[0], '/api/coach/audio');
  assert.equal(request[1].method, 'POST');
  assert.equal(request[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request[1].body), {
    messageId: 'great-job',
    language: 'en',
  });
});

test('voice audio requests deduplicate identical text and use an idempotency key', async () => {
  let requestCount = 0;
  let request;
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    createIdempotencyKey: () => 'coach-event-1',
    fetchImpl: async (...args) => {
      requestCount += 1;
      request = args;
      return {
        ok: true,
        headers: { get: () => 'audio/mpeg' },
        async blob() {
          return new Blob(['audio bytes'], { type: 'audio/mpeg' });
        },
      };
    },
  });

  const payload = {
    text: 'O ṣe dáadáa!',
    language: 'yo',
    voice: 'voice-yo',
  };
  const [firstAudio, secondAudio] = await Promise.all([
    client.synthesizeAudio(payload),
    client.synthesizeAudio(payload),
  ]);

  assert.equal(requestCount, 1);
  assert.equal(firstAudio, secondAudio);
  assert.equal(request[0], '/api/coach/audio');
  assert.equal(request[1].headers['Idempotency-Key'], 'coach-event-1');
  assert.deepEqual(JSON.parse(request[1].body), payload);
  assert.equal(firstAudio.type, 'audio/mpeg');
});

test('voice audio cache distinguishes localized text and selected voice', async () => {
  let requestCount = 0;
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(new Uint8Array([requestCount]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    },
  });

  await client.synthesizeAudio({ text: 'O ṣe dáadáa!', language: 'yo', voice: 'voice-yo' });
  await client.synthesizeAudio({ text: 'Ị mere nke ọma!', language: 'ig', voice: 'voice-ig' });
  await client.synthesizeAudio({ text: 'O ṣe dáadáa!', language: 'yo', voice: 'another-voice' });

  assert.equal(requestCount, 3);
});

test('voice client retrieves discovered voices through the same-origin backend', async () => {
  let request;
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    voicesEndpoint: '/api/coach/voices',
    fetchImpl: async (...args) => {
      request = args;
      return {
        ok: true,
        async json() {
          return { voices: [{ id: 'voice-yo', languages: ['yo'] }] };
        },
      };
    },
  });

  assert.deepEqual(await client.listVoices(), [{ id: 'voice-yo', languages: ['yo'] }]);
  assert.equal(request[0], '/api/coach/voices');
  assert.equal(request[1].method, 'GET');
});

test('voice catalogue client preserves backend configuration errors', async () => {
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 'VOICE_CATALOG_UNAVAILABLE',
        message: 'NAIJALINGO_API_KEY is not configured in the backend environment.',
      },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
  });

  await assert.rejects(
    client.listVoices(),
    /VOICE_CATALOG_UNAVAILABLE.*NAIJALINGO_API_KEY is not configured/i,
  );
});

test('voice client rejects empty and cross-origin endpoints', () => {
  assert.throws(() => createVoiceClient({ endpoint: '' }), /non-empty/i);
  assert.throws(
    () => createVoiceClient({ endpoint: 'https://example.com/api' }),
    /same-origin/i,
  );
});

test('voice client reports HTTP and network failures descriptively', async () => {
  const rejected = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(
    rejected.synthesize({ messageId: 'great-job', language: 'en' }),
    /503/,
  );

  const unavailable = new Error('connection refused');
  const disconnected = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => {
      throw unavailable;
    },
  });
  await assert.rejects(
    disconnected.synthesize({ messageId: 'great-job', language: 'en' }),
    /network|fetch/i,
  );
});

test('voice audio client preserves actionable backend error envelopes', async () => {
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: 'VOICE_SERVICE_NOT_CONFIGURED',
        message: 'Backend key is missing.',
        user_message: 'Configure the backend key.',
      },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
  });

  test('voice audio client shows FastAPI detail errors', async () => {
    const client = createVoiceClient({
      endpoint: '/api/coach/audio',
      fetchImpl: async () => new Response(JSON.stringify({
        detail: [{ msg: 'Field required', loc: ['body', 'text'] }],
      }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
    });

    await assert.rejects(
      client.synthesizeAudio({ text: 'Test phrase', language: 'yo', voice: 'voice-yo' }),
      /422.*Field required/i,
    );
  });

  await assert.rejects(
    client.synthesizeAudio({ messageId: 'great-job', language: 'en' }),
    /VOICE_SERVICE_NOT_CONFIGURED.*Configure the backend key/i,
  );
});

test('voice audio client rejects an empty successful response', async () => {
  const client = createVoiceClient({
    endpoint: '/api/coach/audio',
    fetchImpl: async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }),
  });

  await assert.rejects(
    client.synthesizeAudio({ messageId: 'great-job', language: 'en' }),
    /empty audio/i,
  );
});
