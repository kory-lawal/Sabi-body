import { app } from '@azure/functions';

import { createCoachingHandlers } from '../handlers.js';
import { createNaijaLingoService } from '../naijalingo-service.js';

const handlers = createCoachingHandlers(createNaijaLingoService());

async function toAzureResponse(response) {
  const contentType = response.headers.get('Content-Type') ?? 'application/json';
  const body = contentType.startsWith('audio/')
    ? await response.arrayBuffer()
    : await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

app.http('coach-voices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'coach/voices',
  handler: async () => toAzureResponse(await handlers.voices()),
});

app.http('coach-audio', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'coach/audio',
  handler: async (request) => toAzureResponse(await handlers.audio(request)),
});