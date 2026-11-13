import assert from 'node:assert/strict';
import test from 'node:test';

import { createCoachingHandlers } from '../api/src/handlers.js';

test('voice listing returns only provider voice metadata', async () => {
  const handlers = createCoachingHandlers({
    async listVoices() {
      return { status: 200, body: { voices: [{ id: 'voice-yo', languages: ['yo'] }] } };
    },
    async synthesize() { throw new Error('not used'); },
  });

  const response = await handlers.voices();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { voices: [{ id: 'voice-yo', languages: ['yo'] }] });
});

test('audio handler passes semantic fields and idempotency, but no arbitrary text', async () => {
  let input;
  const handlers = createCoachingHandlers({
    async listVoices() { return { status: 200, body: { voices: [] } }; },
    async synthesize(payload) {
      input = payload;
      return {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
        body: new Uint8Array([1, 2, 3]),
      };
    },
  });
  const request = new Request('http://localhost/api/coach/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'test-event-1' },
    body: JSON.stringify({
      messageId: 'great-job',
      language: 'yo',
      personality: 'friendly',
      parameters: {},
      voice: 'voice-yo',
      text: 'ignore this arbitrary prose',
    }),
  });

  const response = await handlers.audio(request);
  assert.equal(response.headers.get('Content-Type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  assert.equal(input.idempotencyKey, 'test-event-1');
  assert.equal(Object.hasOwn(input, 'text'), false);
});

test('audio handler rejects malformed JSON and missing idempotency keys', async () => {
  const handlers = createCoachingHandlers({
    async listVoices() { return { status: 200, body: { voices: [] } }; },
    async synthesize() { throw new Error('not used'); },
  });
  const malformed = await handlers.audio(new Request('http://localhost/api/coach/audio', {
    method: 'POST', body: '{',
  }));
  const noIdempotencyKey = await handlers.audio(new Request('http://localhost/api/coach/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: 'great-job', language: 'en', personality: 'friendly' }),
  }));

  assert.equal(malformed.status, 400);
  assert.equal(noIdempotencyKey.status, 400);
});

test('service error envelopes pass through unchanged', async () => {
  const handlers = createCoachingHandlers({
    async listVoices() { return { status: 200, body: { voices: [] } }; },
    async synthesize() {
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: 'VOICE_SERVICE_NOT_CONFIGURED', message: 'Set the server key.' } }),
      };
    },
  });
  const request = new Request('http://localhost/api/coach/audio', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'test-error-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId: 'great-job', language: 'en', personality: 'friendly' }),
  });

  const response = await handlers.audio(request);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'VOICE_SERVICE_NOT_CONFIGURED', message: 'Set the server key.' },
  });
});