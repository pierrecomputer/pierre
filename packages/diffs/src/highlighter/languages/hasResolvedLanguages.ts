import type { SupportedLanguages } from '../../types';
import { ResolvedLanguages } from './constants';

export function hasResolvedLanguages(
  languages: SupportedLanguages | SupportedLanguages[]
): boolean {
  for (const language of Array.isArray(languages) ? languages : [languages]) {
    if (!ResolvedLanguages.has(language)) {
      return false;
    }
  }
  return true;
}
