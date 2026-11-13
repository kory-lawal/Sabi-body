const STORAGE_KEY = 'sabi-body-coaching-preferences';
const LANGUAGES = new Set(['en', 'yo', 'ig', 'ha', 'pcm']);

const DEFAULT_PREFERENCES = {
  language: 'en',
  voiceEnabled: false,
  voiceVolume: 1,
  voiceId: '',
  countEachRep: false,
};

function getStorage(storage) {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function normalizePreferences(value = {}) {
  const volume = Number(value.voiceVolume);
  return {
    language: LANGUAGES.has(value.language) ? value.language : DEFAULT_PREFERENCES.language,
    voiceEnabled: value.voiceEnabled === true,
    voiceVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    voiceId: typeof value.voiceId === 'string' ? value.voiceId : '',
    countEachRep: value.countEachRep === true,
  };
}

export function loadVoicePreferences(storage) {
  try {
    const stored = getStorage(storage)?.getItem(STORAGE_KEY);
    if (typeof stored !== 'string') {
      return { ...DEFAULT_PREFERENCES };
    }
    return normalizePreferences(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveVoicePreferences(changes, storage) {
  try {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage) {
      return false;
    }
    let current = {};
    const stored = resolvedStorage.getItem(STORAGE_KEY);
    if (typeof stored === 'string') {
      current = JSON.parse(stored);
    }
    const preferences = normalizePreferences({ ...current, ...changes });
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}