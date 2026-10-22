function validateSameOriginEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new TypeError('YarnGPT endpoint must be a non-empty URL.');
  }

  let parsedEndpoint;
  try {
    const origin = globalThis.location?.origin ?? 'http://localhost';
    parsedEndpoint = new URL(endpoint, origin);
  } catch (error) {
    throw new TypeError('YarnGPT endpoint must be a valid same-origin URL.', {
      cause: error,
    });
  }

  const origin = globalThis.location?.origin ?? 'http://localhost';
  if (
    parsedEndpoint.origin !== origin ||
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    throw new TypeError('YarnGPT endpoint must be same-origin.');
  }

  return endpoint.trim();
}

export function createYarnGPTClient({ endpoint, fetchImpl = fetch }) {
  const validatedEndpoint = validateSameOriginEndpoint(endpoint);

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
        throw new Error('YarnGPT request failed due to a network or fetch error.', {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new Error(`YarnGPT endpoint returned HTTP ${response.status}.`);
      }

      return response.json();
    },
  };
}
