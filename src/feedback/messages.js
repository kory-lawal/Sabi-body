import { translateCoachingMessage } from '../../api/src/shared/coaching-messages.js';

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
