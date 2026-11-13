function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function createCoachingHandlers(service) {
  async function voices() {
    const result = await service.listVoices();
    return jsonResponse(result.status, result.body);
  }

  async function audio(request) {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for coaching audio.' } });
    }

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 64 || idempotencyKey.includes(':')) {
      return jsonResponse(400, { error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key header is required.' } });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(400, { error: { code: 'INVALID_REQUEST', message: 'Request body must be an object.' } });
    }

    const result = await service.synthesize({
      messageId: payload.messageId,
      language: payload.language,
      personality: payload.personality,
      parameters: payload.parameters,
      voice: payload.voice,
      idempotencyKey,
    });
    const headers = { 'Cache-Control': 'private, max-age=60', ...(result.headers ?? {}) };
    if (result.body instanceof Uint8Array || result.body instanceof ArrayBuffer) {
      return new Response(result.body, { status: result.status, headers });
    }
    let responseBody = result.body;
    try {
      responseBody = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
    } catch {
      responseBody = { error: { code: 'INVALID_BACKEND_RESPONSE', message: 'Voice service returned an invalid response.' } };
    }
    return jsonResponse(result.status, responseBody, headers);
  }

  return { voices, audio };
}