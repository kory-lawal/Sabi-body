export const COACH_PERSONALITIES = [
  {
    id: 'quiet',
    label: 'Calm Coach',
    description: 'Confirmed counts, essential corrections, and completion only.',
  },
  {
    id: 'friendly',
    label: 'Friendly Coach',
    description: 'Natural encouragement, progress cues, and corrections.',
  },
  {
    id: 'energetic',
    label: 'Energetic Coach',
    description: 'More enthusiastic wording at the same coaching moments.',
  },
];

export const DEFAULT_PERSONALITY = 'friendly';
export const PERSONALITY_STORAGE_KEY = 'sabi-body-coach-personality';

const VALID_PERSONALITIES = new Set(COACH_PERSONALITIES.map(({ id }) => id));
const QUIET_FEEDBACK = new Set([
  'adjust-alignment',
  'body-not-visible',
  'camera-positioning',
  'exercise-completed',
  'move-lower',
  'plank-completed',
  'return-to-start',
  'workout-countdown',
]);
const FRIENDLY_FEEDBACK = new Set([
  ...QUIET_FEEDBACK,
  'aligned',
  'great-job',
  'welcome',
]);
const ENERGETIC_VARIANTS = new Set([
  'exercise-completed',
  'great-job',
  'keep-going',
  'milestone-plank',
  'milestone-reps',
]);

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

export function normalizePersonality(personality) {
  return VALID_PERSONALITIES.has(personality) ? personality : DEFAULT_PERSONALITY;
}

export function getPersonalityMessageId(personality, messageId) {
  const normalizedPersonality = normalizePersonality(personality);
  if (normalizedPersonality === 'energetic' && ENERGETIC_VARIANTS.has(messageId)) {
    return `energetic-${messageId}`;
  }
  return messageId;
}

export function isSpeakableFeedback(personality, messageId) {
  const normalizedPersonality = normalizePersonality(personality);
  if (normalizedPersonality === 'quiet') {
    return QUIET_FEEDBACK.has(messageId);
  }
  return FRIENDLY_FEEDBACK.has(messageId);
}

export function loadPersonality(storage) {
  try {
    return normalizePersonality(getStorage(storage)?.getItem(PERSONALITY_STORAGE_KEY));
  } catch {
    return DEFAULT_PERSONALITY;
  }
}

export function savePersonality(personality, storage) {
  if (!VALID_PERSONALITIES.has(personality)) {
    return false;
  }

  try {
    const resolvedStorage = getStorage(storage);
    if (!resolvedStorage) {
      return false;
    }
    resolvedStorage.setItem(PERSONALITY_STORAGE_KEY, personality);
    return true;
  } catch {
    return false;
  }
}