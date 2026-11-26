import type { DiffsHighlighter } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import {
  AttachedLanguages,
  ResolvedHighlightsLanguages,
  ResolvedLanguages,
} from './constants';

/**
 * Record resolved grammars in the shared language cache and attach them to a
 * highlighter. Highlights attaches only the lexers registered for it.
 */
export function attachResolvedLanguages(
  resolvedLanguages: ResolvedLanguage | ResolvedLanguage[],
  highlighter: DiffsHighlighter
): void {
  const languages = Array.isArray(resolvedLanguages)
    ? resolvedLanguages
    : [resolvedLanguages];

  // Shiki can reject a later grammar after earlier ones are already loaded.
  if (languages.length > 1 && highlighter.name !== 'highlights') {
    for (const language of languages) {
      const lang = cacheResolvedLanguage(language);
      highlighter.attachLanguages([lang]);
      AttachedLanguages.add(lang.name);
    }
    return;
  }

  const langs = languages.map(cacheResolvedLanguage);
  highlighter.attachLanguages(langs);
  for (const lang of langs) {
    AttachedLanguages.add(lang.name);
  }
}

// Every instance and worker uses the first resolution of a name for its backend.
function cacheResolvedLanguage(language: ResolvedLanguage): ResolvedLanguage {
  const cache =
    language.highlights == null
      ? ResolvedLanguages
      : ResolvedHighlightsLanguages;
  const cached = cache.get(language.name);
  if (cached != null) return cached;
  cache.set(language.name, language);
  return language;
}
