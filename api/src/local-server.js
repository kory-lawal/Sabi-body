import 'dotenv/config';

import { createServer } from 'node:http';

import { createCoachingHandlers } from './handlers.js';
import { sendNodeResponse } from './response-adapter.js';
import { createNaijaLingoService } from './naijalingo-service.js';

const handlers = createCoachingHandlers(createNaijaLingoService());
const allowedOrigins = new Set(
  (process.env.SABI_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5175,http://localhost:5176')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

async function readRequestBody(request, maximumBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (incoming, outgoing) => {
  const origin = incoming.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    outgoing.writeHead(403, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin cannot use voice coaching.' } }));
    return;
  }

  try {
    const url = new URL(incoming.url ?? '/', 'http://localhost');
    let result;
    if (url.pathname === '/api/coach/voices' && incoming.method === 'GET') {
      result = await handlers.voices();
    } else if (url.pathname === '/api/coach/audio' && incoming.method === 'POST') {
      const body = await readRequestBody(incoming);
      const request = new Request(`http://localhost${url.pathname}`, {
        method: incoming.method,
        headers: incoming.headers,
        body,
      });
      result = await handlers.audio(request);
    } else {
      outgoing.writeHead(404, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Voice route not found.' } }));
      return;
    }
    await sendNodeResponse(outgoing, result);
  } catch (error) {
    if (outgoing.headersSent) {
      outgoing.destroy(error);
      return;
    }
    outgoing.writeHead(error.message.includes('too large') ? 413 : 500, {
      'Content-Type': 'application/json',
    });
    outgoing.end(JSON.stringify({ error: { code: 'VOICE_BACKEND_ERROR', message: 'Voice service request failed.' } }));
  }
});

const port = Number(process.env.PORT ?? 5177);
server.listen(port, '127.0.0.1', () => {
  console.log(`Sabi Body voice backend listening on http://127.0.0.1:${port}`);
});