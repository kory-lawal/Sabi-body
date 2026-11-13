import assert from 'node:assert/strict';
import test from 'node:test';

import { sendNodeResponse } from '../api/src/response-adapter.js';

test('local server forwards a Fetch Response body without writing headers twice', async () => {
  let status;
  let headers;
  let body;
  const outgoing = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(nextBody) {
      body = nextBody;
    },
  };

  await sendNodeResponse(outgoing, new Response(
    JSON.stringify({ error: { code: 'VOICE_SERVICE_NOT_CONFIGURED' } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  ));

  assert.equal(status, 503);
  assert.equal(headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(body.toString()), {
    error: { code: 'VOICE_SERVICE_NOT_CONFIGURED' },
  });
});