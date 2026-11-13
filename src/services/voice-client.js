function validateSameOriginEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new TypeError('Voice API endpoint must be a non-empty URL.');
  }

  let parsedEndpoint;
  try {
    const origin = globalThis.location?.origin ?? 'http://localhost';
    parsedEndpoint = new URL(endpoint, origin);
  } catch (error) {
    throw new TypeError('Voice API endpoint must be a valid same-origin URL.', {
      cause: error,
    });
  }

  const origin = globalThis.location?.origin ?? 'http://localhost';
  if (
    parsedEndpoint.origin !== origin ||
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    throw new TypeError('Voice API endpoint must be same-origin.');
  }

  return endpoint.trim();
}

export function createVoiceClient({
  endpoint,
  voicesEndpoint = '/api/coach/voices',
  fetchImpl = fetch,
  createIdempotencyKey,
  cacheSize = 24,
} = {}) {
  const validatedEndpoint = validateSameOriginEndpoint(endpoint);
  const validatedVoicesEndpoint = validateSameOriginEndpoint(voicesEndpoint);
  const audioCache = new Map();
  const audioRequests = new Map();
  let voicesCache = null;
  let voicesCacheAt = 0;
  let voicesRequest = null;
  let requestSequence = 0;

  function makeIdempotencyKey() {
    if (createIdempotencyKey) {
      return createIdempotencyKey();
    }
    const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    requestSequence += 1;
    return `${Date.now().toString(36)}-${requestSequence.toString(36)}-${randomPart}`;
  }

  function getAudioCacheKey(payload) {
    return JSON.stringify([
      payload.text,
      payload.language,
      payload.voice ?? '',
      payload.outputFormat ?? 'mp3',
    ]);
  }

  async function getHttpError(response) {
    let payload;
    try {
      payload = response.clone
        ? await response.clone().json()
        : await response.json?.();
    } catch {
      payload = null;
    }
    const providerError = payload?.error;
    const code = providerError?.code;
    const responseDetail = payload?.detail;
    const detailMessage = Array.isArray(responseDetail)
      ? responseDetail.map((item) => item?.msg).filter(Boolean).join('; ')
      : responseDetail;
    const message = providerError?.user_message ?? providerError?.message ?? detailMessage;
    const retryAfter = response.headers?.get?.('Retry-After');
    const errorDetail = [code, message].filter(Boolean).join(': ');
    const retry = retryAfter ? ` Retry after ${retryAfter} seconds.` : '';
    const error = new Error(
      `Voice API endpoint returned HTTP ${response.status}.${errorDetail ? ` ${errorDetail}` : ''}${retry}`,
    );
    error.status = response.status;
    error.code = code;
    error.details = providerError?.details;
    error.retryAfter = retryAfter;
    return error;
  }

  async function synthesizeAudio(payload) {
    const cacheKey = getAudioCacheKey(payload);
    if (audioCache.has(cacheKey)) {
      return audioCache.get(cacheKey);
    }
    if (audioRequests.has(cacheKey)) {
      return audioRequests.get(cacheKey);
    }

    const request = (async () => {
      try {
        const response = await fetchImpl(validatedEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': makeIdempotencyKey(),
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw await getHttpError(response);
        }
        const contentType = response.headers?.get?.('Content-Type') ?? '';
        if (!contentType.toLowerCase().startsWith('audio/')) {
          throw new Error('Voice API endpoint returned an unsupported audio response.');
        }

        const audio = await response.blob();
        if (!audio.size) {
          throw new Error('Voice API endpoint returned empty audio.');
        }
        audioCache.set(cacheKey, audio);
        while (audioCache.size > Math.max(1, cacheSize)) {
          audioCache.delete(audioCache.keys().next().value);
        }
        return audio;
      } catch (error) {
        if (error.message.startsWith('Voice API endpoint returned')) {
          throw error;
        }
        throw new Error('Voice API audio request failed due to a network or fetch error.', {
          cause: error,
        });
      } finally {
        audioRequests.delete(cacheKey);
      }
    })();

    audioRequests.set(cacheKey, request);
    return request;
  }

  async function listVoices() {
    if (voicesCache && Date.now() - voicesCacheAt < 5 * 60 * 1000) {
      return voicesCache;
    }
    if (voicesRequest) {
      return voicesRequest;
    }

    voicesRequest = (async () => {
      try {
        const response = await fetchImpl(validatedVoicesEndpoint, { method: 'GET' });
        if (!response.ok) {
          throw await getHttpError(response);
        }
        const payload = await response.json();
        const voices = Array.isArray(payload) ? payload : payload.voices;
        if (!Array.isArray(voices)) {
          throw new Error('Voice catalogue response did not contain a voice list.');
        }
        voicesCache = voices;
        voicesCacheAt = Date.now();
        return voicesCache;
      } catch (error) {
        if (Number.isInteger(error.status)) {
          throw error;
        }
        throw new Error('Could not load the YarnGPT voice catalogue.', { cause: error });
      } finally {
        voicesRequest = null;
      }
    })();

    return voicesRequest;
  }

  return {
    async synthesize({ messageId, language }) {
      let response;
      try {
        response = await fetchImpl(validatedEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, language }),
        });
      } catch (error) {
        throw new Error('Voice API request failed due to a network or fetch error.', {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new Error(`Voice API endpoint returned HTTP ${response.status}.`);
      }

      return response.json();
    },
    synthesizeAudio,
    listVoices,
  };
}
