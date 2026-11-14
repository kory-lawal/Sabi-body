import {
  COACHING_PHRASES,
  EXERCISE_INSTRUCTION_IDS,
  translateCoachingMessage,
} from '../../api/src/shared/coaching-messages.js';

export { COACHING_PHRASES, EXERCISE_INSTRUCTION_IDS };

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'ha', label: 'Hausa' },
  { code: 'pcm', label: 'Nigerian Pidgin' },
];

export function translateMessage(messageId, languageCode, parameters = {}) {
  return translateCoachingMessage(messageId, languageCode, parameters);
}
