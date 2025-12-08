import type { SupportedLanguages } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import { ResolvedLanguages } from './constants';

// This method should only be called if you know all languages are resolved,
// otherwise it will fail. The main intention is a helper to avoid an async
// tick if we don't actually need it
export function getResolvedLanguages(
  languages: SupportedLanguages[]
): ResolvedLanguage[] {
  const resolvedLanguages: ResolvedLanguage[] = [];
  for (const language of languages) {
    const resolvedLanguage = ResolvedLanguages.get(language);
    if (resolvedLanguage == null) {
      throw new Error(
        `getResolvedLanguages: ${language} is not resolved. Please resolve languages before calling getResolvedLanguages`
      );
    }
    resolvedLanguages.push(resolvedLanguage);
  }
  return resolvedLanguages;
}
