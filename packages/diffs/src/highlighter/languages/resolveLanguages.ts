import type { SupportedLanguages } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import { getResolvedOrResolveLanguage } from './getResolvedOrResolveLanguage';
import { resolveLanguage } from './resolveLanguage';

export async function resolveLanguages(
  languages: SupportedLanguages[]
): Promise<ResolvedLanguage[]> {
  const resolvedLanguages: ResolvedLanguage[] = [];
  const languagesToResolve: Promise<ResolvedLanguage | undefined>[] = [];
  for (const language of languages) {
    if (language === 'text' || language === 'ansi') continue;
    const maybeResolvedLanguage =
      getResolvedOrResolveLanguage(language) ?? resolveLanguage(language);
    if ('then' in maybeResolvedLanguage) {
      languagesToResolve.push(maybeResolvedLanguage);
    } else {
      resolvedLanguages.push(maybeResolvedLanguage);
    }
  }
  if (languagesToResolve.length > 0) {
    await Promise.all(languagesToResolve).then((_resolvedLanguages) => {
      for (const resolvedLanguage of _resolvedLanguages) {
        if (resolvedLanguage == null) {
          throw new Error('resolvedLanguages: unable to resolve language');
        }
        resolvedLanguages.push(resolvedLanguage);
      }
    });
  }

  return resolvedLanguages;
}
