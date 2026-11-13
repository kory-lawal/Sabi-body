import assert from 'node:assert/strict';
import test from 'node:test';

import { createNaijaLingoService } from '../api/src/naijalingo-service.js';

test('NaijaLingo sends its API key through the API-key header for both requests', async () => {
  const requests = [];
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'ada_pcm', name: 'Ada', language: 'pcm' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    },
  });

  await service.listVoices();
  await service.synthesize({
    messageId: 'great-job',
    language: 'pcm',
    personality: 'friendly',
    voice: 'ada_pcm',
    idempotencyKey: 'api-key-header-test',
  });

  assert.equal(requests.length, 2);
  for (const { options } of requests) {
    assert.equal(options.headers['X-API-Key'], 'server-only-test-key');
    assert.equal(options.headers.Authorization, undefined);
  }
});

test('NaijaLingo speaker catalogue is normalized for the coaching UI', async () => {
  const requests = [];
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({
        speakers: [
          { id: 'ada_pcm', name: 'Ada', language: 'pcm' },
          { id: 'abimbola_yo', name: 'Abimbola', language: 'yo' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const result = await service.listVoices();

  assert.equal(requests[0].url, 'https://api.9jalingo.org/v1/speakers');
  assert.deepEqual(result.body, {
    voices: [{
      id: 'abimbola_yo',
      name: 'Abimbola',
      languages: ['yo'],
      isDefault: true,
      isRecommended: true,
    }, {
      id: 'ada_pcm',
      name: 'Ada',
      languages: ['pcm'],
      isDefault: false,
      isRecommended: false,
    }],
  });
});

test('recommended Everyday Conversation speakers lead the catalogue with descriptive metadata', async () => {
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async () => new Response(JSON.stringify({
      speakers: [
        { id: 'other_yo', name: 'Other', language: 'yo', gender: 'female', domain: 'Business Conversation' },
        { id: 'babatunde_yo', name: 'Babatunde', language: 'yo', gender: 'male', domain: 'Everyday Conversation' },
        { id: 'abimbola_yo', name: 'Abimbola', language: 'yo', gender: 'female', domain: 'Everyday Conversation' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  const result = await service.listVoices();

  assert.deepEqual(result.body.voices, [
    {
      id: 'abimbola_yo',
      name: 'Abimbola',
      languages: ['yo'],
      isDefault: true,
      isRecommended: true,
      gender: 'female',
      domain: 'Everyday Conversation',
    },
    {
      id: 'babatunde_yo',
      name: 'Babatunde',
      languages: ['yo'],
      isDefault: false,
      isRecommended: true,
      gender: 'male',
      domain: 'Everyday Conversation',
    },
    {
      id: 'other_yo',
      name: 'Other',
      languages: ['yo'],
      isDefault: false,
      isRecommended: false,
      gender: 'female',
      domain: 'Business Conversation',
    },
  ]);
});

test('NaijaLingo synthesis sends only authored coaching text to the speech endpoint', async () => {
  const requests = [];
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'ada_pcm', name: 'Ada', language: 'pcm' }],
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
    voice: 'ada_pcm',
    idempotencyKey: 'event-pidgin-1',
    text: 'untrusted client text',
  });

  const request = requests.at(-1);
  assert.equal(result.status, 200);
  assert.equal(request.url, 'https://api.9jalingo.org/v1/audio/speech');
  assert.equal(request.options.headers['Idempotency-Key'], 'event-pidgin-1');
  assert.deepEqual(JSON.parse(request.options.body), {
    model: '9jalingo-tts-1',
    input: 'Correct work! You dey move with power!',
    voice: 'ada_pcm',
    response_format: 'mp3',
  });
  assert.deepEqual([...result.body], [1, 2, 3]);
});

test('NaijaLingo accepts region-tagged Yoruba speakers as compatible with Yoruba', async () => {
  const service = createNaijaLingoService({
    apiKey: 'server-only-test-key',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/speakers')) {
        return new Response(JSON.stringify({
          speakers: [{ id: 'yoruba-ng', name: 'Yoruba NG', language: 'yo-NG' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    },
  });

  const result = await service.synthesize({
    messageId: 'great-job',
    language: 'yo',
    personality: 'friendly',
    voice: 'yoruba-ng',
    idempotencyKey: 'yoruba-ng-test',
  });

  assert.equal(result.status, 200);
});

test('NaijaLingo service does not make requests when its server key is missing', async () => {
  let requestCount = 0;
  const service = createNaijaLingoService({
    apiKey: '',
    fetchImpl: async () => { requestCount += 1; },
  });

  const result = await service.synthesize({
    messageId: 'great-job',
    language: 'pcm',
    personality: 'friendly',
    voice: 'ada_pcm',
    idempotencyKey: 'event-1',
  });

  assert.equal(result.status, 503);
  assert.equal(requestCount, 0);
});
