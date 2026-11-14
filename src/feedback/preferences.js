import { SELECTABLE_LANGUAGES } from './messages.js';

const STORAGE_KEY = 'sabi-body-coaching-preferences';
const SELECTABLE_LANGUAGE_CODES = new Set(SELECTABLE_LANGUAGES.map(({ code }) => code));

const DEFAULT_PREFERENCES = {
  language: 'en',
  voiceEnabled: true,
  voiceVolume: 1,
  voiceId: '',
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
  const voiceEnabled = value.countEachRep === true
    ? true
    : typeof value.voiceEnabled === 'boolean'
      ? value.voiceEnabled
      : DEFAULT_PREFERENCES.voiceEnabled;
  return {
    language: SELECTABLE_LANGUAGE_CODES.has(value.language)
      ? value.language
      : DEFAULT_PREFERENCES.language,
    voiceEnabled,
    voiceVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    voiceId: typeof value.voiceId === 'string' ? value.voiceId : '',
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
    if (current.countEachRep === true && current.voiceEnabled === false) {
      current.voiceEnabled = true;
    }
    delete current.countEachRep;
    const preferences = normalizePreferences({ ...current, ...changes });
    resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}