import assert from 'node:assert/strict';
import test from 'node:test';

import { createNaijaLingoService } from '../api/src/naijalingo-service.js';

test('missing server key prevents provider requests', async () => {
  let requestCount = 0;
  const service = createNaijaLingoService({
    apiKey: '',
    fetchImpl: async () => { requestCount += 1; },
  });

  const result = await service.synthesize({
    messageId: 'great-job',
    language: 'pcm',
    personality: 'friendly',
    parameters: {},
    voice: 'voice-en',
    idempotencyKey: 'event-1',
  });

  assert.equal(result.status, 503);
  assert.equal(requestCount, 0);
});

test('default NaijaLingo host targets the documented speakers endpoint', async () => {
  let requestedUrl;
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ speakers: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await service.listVoices();

  assert.equal(requestedUrl, 'https://api.9jalingo.org/v1/speakers');
});

test('voice discovery preserves the provider invalid-key response', async () => {
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async () => new Response(JSON.stringify({
      detail: 'Invalid API Key',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
  });

  const result = await service.listVoices();

  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'INVALID_API_KEY');
  assert.equal(result.body.error.message, 'Invalid API Key');
});

test('Pidgin synthesis uses authored text and a discovered compatible voice', async () => {
  const requests = [];
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [
            { id: 'pidgin-voice', name: 'Pidgin Voice', language: 'pcm' },
            { id: 'english-voice', name: 'English Sample', language: 'en' },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    },
  });

  const result = await service.synthesize({
    messageId: 'energetic-great-job',
    language: 'pcm',
    personality: 'energetic',
    parameters: {},
    voice: 'pidgin-voice',
    idempotencyKey: 'event-pidgin-1',
  });

  assert.equal(result.status, 200);
  const request = requests.at(-1);
  assert.equal(request.url, 'https://api.9jalingo.org/v1/audio/speech');
  assert.equal(request.options.headers['X-API-Key'], 'server-only-test-key');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.headers['Idempotency-Key'], 'event-pidgin-1');
  const body = JSON.parse(request.options.body);
  assert.equal(body.input, 'Correct work! You dey move with power!');
  assert.equal(body.model, '9jalingo-tts-1');
  assert.equal(body.voice, 'pidgin-voice');
  assert.equal(body.response_format, 'mp3');
  assert.equal(Object.hasOwn(body, 'text'), false);
});

test('NaijaLingo service rejects arbitrary message text and incompatible speakers', async () => {
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'yoruba-voice', language: 'yo' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('provider should not receive invalid requests');
    },
  });

  const invalidMessage = await service.synthesize({
    messageId: 'raw-text', language: 'yo', personality: 'friendly',
    text: 'arbitrary client text', voice: 'yoruba-voice', idempotencyKey: 'bad-1',
  });
  const invalidVoice = await service.synthesize({
    messageId: 'great-job', language: 'yo', personality: 'friendly',
    parameters: {}, voice: 'english-voice', idempotencyKey: 'bad-2',
  });

  assert.equal(invalidMessage.status, 400);
  assert.equal(invalidVoice.status, 422);
});

test('empty audio is rejected and never added to the server cache', async () => {
  let synthesisCalls = 0;
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'pidgin-voice', language: 'pcm' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      synthesisCalls += 1;
      return new Response(new Uint8Array(), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    },
  });
  const request = {
    messageId: 'great-job', language: 'pcm', personality: 'friendly',
    parameters: {}, voice: 'pidgin-voice', idempotencyKey: 'empty-audio-test',
  };

  const first = await service.synthesize(request);
  const second = await service.synthesize({ ...request, idempotencyKey: 'empty-audio-test-2' });

  assert.equal(first.status, 502);
  assert.equal(JSON.parse(first.body).error.code, 'EMPTY_AUDIO_RESPONSE');
  assert.equal(second.status, 502);
  assert.equal(synthesisCalls, 2);
});

test('NaijaLingo base URL must be HTTPS', () => {
  assert.throws(
    () => createNaijaLingoService({ apiKey: 'server-only-test-key', baseUrl: 'http://localhost:9000' }),
    /HTTPS/i,
  );
});

test('synthesis preserves provider rate-limit status and Retry-After', async () => {
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'pidgin-voice', language: 'pcm' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        error: { code: 'RATE_LIMITED', user_message: 'Wait before retrying.' },
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
      });
    },
  });

  const result = await service.synthesize({
    messageId: 'great-job', language: 'pcm', personality: 'friendly',
    parameters: {}, voice: 'pidgin-voice', idempotencyKey: 'rate-limit-test',
  });

  assert.equal(result.status, 429);
  assert.equal(JSON.parse(result.body).error.code, 'RATE_LIMITED');
  assert.equal(result.headers['Retry-After'], '12');
});