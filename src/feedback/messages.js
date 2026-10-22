export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'ha', label: 'Hausa' },
  { code: 'pcm', label: 'Nigerian Pidgin' },
];

const ENGLISH_MESSAGES = {
  ready: 'You’re ready. Start moving when you feel comfortable.',
  'body-not-visible': 'Move into view so I can follow your movement.',
  'move-lower': 'Move a little lower.',
  'return-to-start': 'Return to your starting position.',
  'great-job': 'Great job!',
  'keep-going': 'Keep going at your own pace.',
  aligned: 'Your body is aligned.',
  'adjust-alignment': 'Make a small adjustment to your alignment.',
  'camera-error': 'The camera could not start. Check its permission and try again.',
  'exercise-completed': 'Exercise completed. Well done!',
};

const TRANSLATIONS = {
  en: ENGLISH_MESSAGES,
  yo: {},
  ig: {},
  ha: {},
  pcm: {},
};

const UNKNOWN_MESSAGE_FALLBACK = 'Keep going and follow the on-screen guidance.';

export function translateMessage(messageId, languageCode) {
  if (!Object.hasOwn(ENGLISH_MESSAGES, messageId)) {
    return { text: UNKNOWN_MESSAGE_FALLBACK, isFallback: true };
  }

  const englishText = ENGLISH_MESSAGES[messageId];
  const languageMessages = Object.hasOwn(TRANSLATIONS, languageCode)
    ? TRANSLATIONS[languageCode]
    : undefined;
  const localizedText =
    languageMessages && Object.hasOwn(languageMessages, messageId)
      ? languageMessages[messageId]
      : undefined;
  if (localizedText) {
    return { text: localizedText, isFallback: false };
  }

  return {
    text: englishText,
    isFallback: languageCode !== 'en',
  };
}
