import {
  hasCoachingMessage,
  translateCoachingMessage,
} from './shared/coaching-messages.js';

const SUPPORTED_LANGUAGES = new Set(['yo', 'ig', 'ha', 'pcm']);
const SUPPORTED_PERSONALITIES = new Set(['quiet', 'friendly', 'energetic']);
const RECOMMENDED_SPEAKERS = [
  'abimbola_yo',
  'babatunde_yo',
  'adaeze_ig',
  'chibueze_ig',
  'aisha_ha',
  'aliyu_ha',
  'bose_pcm',
  'bola_pcm',
];
const DEFAULT_SPEAKERS = new Set([
  'abimbola_yo',
  'adaeze_ig',
  'aisha_ha',
  'bose_pcm',
]);
const CACHE_TTL_MS = 20 * 60 * 1000;
const RECOMMENDATION_ORDER = new Map(RECOMMENDED_SPEAKERS.map((id, index) => [id, index]));

function errorResult(status, code, message, details, extraHeaders = {}) {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
  };
}

function normalizeBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError('NaijaLingo base URL must use HTTPS without credentials, query, or fragment.');
    }
    const path = parsed.pathname.replace(/\/+$/, '');
    const versionedPath = path.endsWith('/v1') ? path : `${path}/v1`;
    return `${parsed.origin}${versionedPath}`;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('must use HTTPS')) {
      throw error;
    }
    throw new TypeError('NaijaLingo base URL must be a valid HTTPS URL.', { cause: error });
  }
}

async function getProviderError(response) {
  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }
  const errorBody = payload?.error ?? payload ?? {};
  const fallbackCodes = {
    401: 'INVALID_API_KEY',
    402: 'QUOTA_EXCEEDED',
    429: 'RATE_LIMITED',
    503: 'SERVICE_UNAVAILABLE',
    504: 'PROVIDER_TIMEOUT',
  };
  return {
    status: response.status,
    code: errorBody.code ?? fallbackCodes[response.status] ?? 'NAIJALINGO_PROVIDER_ERROR',
    message: errorBody.user_message ?? errorBody.message ?? errorBody.detail ?? `NaijaLingo returned HTTP ${response.status}.`,
    details: errorBody.details,
    retryAfter: response.headers.get('Retry-After'),
  };
}

function getSpeakerRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.speakers)) {
    return payload.speakers;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function normalizeSpeaker(speaker) {
  if (!speaker || typeof speaker !== 'object') {
    return null;
  }
  const id = speaker.id ?? speaker.voice_code;
  const language = speaker.language ?? speaker.language_code;
  if (typeof id !== 'string' || id.length === 0 || typeof language !== 'string') {
    return null;
  }
  return {
    id,
    name: typeof speaker.name === 'string' ? speaker.name : id,
    languages: [language.toLowerCase()],
    isDefault: speaker.is_default === true || DEFAULT_SPEAKERS.has(id),
    isRecommended: RECOMMENDATION_ORDER.has(id),
    ...(typeof speaker.gender === 'string' ? { gender: speaker.gender } : {}),
    ...(typeof speaker.domain === 'string' ? { domain: speaker.domain } : {}),
  };
}

function hasLanguage(speaker, language) {
  return speaker.languages.some((supported) =>
    supported === language || supported.startsWith(`${language}-`),
  );
}

export function createNaijaLingoService({
  apiKey = process.env.NAIJALINGO_API_KEY,
  baseUrl = process.env.NAIJALINGO_BASE_URL ?? 'https://api.9jalingo.org/v1',
  fetchImpl = fetch,
  now = () => Date.now(),
  cacheSize = 48,
} = {}) {
  const apiBaseUrl = normalizeBaseUrl(baseUrl);
  const audioCache = new Map();
  let voiceCache = null;
  let voiceCacheExpiry = 0;

  async function loadVoices() {
    if (!apiKey) {
      throw new Error('NAIJALINGO_API_KEY is not configured in the backend environment.');
    }
    if (voiceCache && voiceCacheExpiry > now()) {
      return voiceCache;
    }

    const response = await fetchImpl(`${apiBaseUrl}/speakers`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!response.ok) {
      const providerError = await getProviderError(response);
      throw Object.assign(new Error(providerError.message), providerError);
    }
    voiceCache = getSpeakerRows(await response.json())
      .map(normalizeSpeaker)
      .filter(Boolean)
      .sort((left, right) =>
        (RECOMMENDATION_ORDER.get(left.id) ?? Infinity) -
        (RECOMMENDATION_ORDER.get(right.id) ?? Infinity),
      );
    voiceCacheExpiry = now() + 5 * 60 * 1000;
    return voiceCache;
  }

  async function listVoices() {
    try {
      return { status: 200, body: { voices: await loadVoices() } };
    } catch (error) {
      return {
        status: error.status ?? (apiKey ? 502 : 503),
        headers: error.retryAfter ? { 'Retry-After': error.retryAfter } : {},
        body: {
          error: {
            code: error.code ?? 'VOICE_CATALOG_UNAVAILABLE',
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
      };
    }
  }

  async function synthesize({
    messageId,
    language,
    personality,
    parameters = {},
    voice,
    idempotencyKey,
  } = {}) {
    if (!apiKey) {
      return errorResult(503, 'VOICE_SERVICE_NOT_CONFIGURED', 'NaijaLingo is not configured on the server.');
    }
    if (
      !hasCoachingMessage(messageId) ||
      !SUPPORTED_LANGUAGES.has(language) ||
      !SUPPORTED_PERSONALITIES.has(personality) ||
      !idempotencyKey ||
      idempotencyKey.length > 64 ||
      idempotencyKey.includes(':')
    ) {
      return errorResult(400, 'INVALID_COACHING_REQUEST', 'The coaching event is invalid.');
    }

    const translated = translateCoachingMessage(messageId, language, parameters);
    if (translated.isFallback) {
      return errorResult(422, 'LANGUAGE_MESSAGE_UNAVAILABLE', 'This coaching message is not available in the selected language yet.');
    }

    let voices;
    try {
      voices = await loadVoices();
    } catch (error) {
      return errorResult(
        error.status ?? 502,
        error.code ?? 'VOICE_CATALOG_UNAVAILABLE',
        error.message ?? 'NaijaLingo voice information is unavailable.',
        error.details,
        error.retryAfter ? { 'Retry-After': error.retryAfter } : {},
      );
    }
    const selectedVoice = voices.find(({ id }) => id === voice);
    if (!selectedVoice || !hasLanguage(selectedVoice, language)) {
      return errorResult(422, 'INCOMPATIBLE_VOICE', 'Choose a voice listed for the selected language.');
    }

    const outputFormat = 'mp3';
    const cacheKey = JSON.stringify([
      language,
      selectedVoice.id,
      translated.text,
      outputFormat,
    ]);
    const cached = audioCache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      return {
        status: 200,
        headers: { 'Content-Type': cached.contentType, 'Cache-Control': 'private, max-age=60' },
        body: cached.audio,
      };
    }

    try {
      const response = await fetchImpl(`${apiBaseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          model: '9jalingo-tts-1',
          input: translated.text,
          voice: selectedVoice.id,
          response_format: outputFormat,
        }),
      });
      if (!response.ok) {
        const providerError = await getProviderError(response);
        return errorResult(
          providerError.status,
          providerError.code,
          providerError.message,
          providerError.details,
          providerError.retryAfter ? { 'Retry-After': providerError.retryAfter } : {},
        );
      }

      const contentType = response.headers.get('Content-Type') ?? '';
      if (!contentType.toLowerCase().startsWith('audio/')) {
        return errorResult(502, 'INVALID_AUDIO_RESPONSE', 'NaijaLingo returned an unsupported audio format.');
      }
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0) {
        return errorResult(502, 'EMPTY_AUDIO_RESPONSE', 'NaijaLingo returned empty audio. Written coaching remains available.');
      }
      audioCache.set(cacheKey, { audio, contentType, expiresAt: now() + CACHE_TTL_MS });
      while (audioCache.size > cacheSize) {
        audioCache.delete(audioCache.keys().next().value);
      }
      return {
        status: 200,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=60' },
        body: audio,
      };
    } catch {
      return errorResult(502, 'NAIJALINGO_NETWORK_ERROR', 'Voice synthesis could not connect. Written coaching remains available.');
    }
  }

  return { listVoices, synthesize };
}
