import type { SupportedLanguages } from '../../types';
import { AttachedLanguages } from './constants';

export function areLanguagesAttached(
  languages: SupportedLanguages | SupportedLanguages[]
): boolean {
  for (const language of Array.isArray(languages) ? languages : [languages]) {
    if (language === 'text' || language === 'ansi') {
      continue;
    }
    if (!AttachedLanguages.has(language)) {
      return false;
    }
  }
  return true;
}
