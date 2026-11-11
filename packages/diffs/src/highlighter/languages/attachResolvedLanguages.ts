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
  for (const resolvedLang of Array.isArray(resolvedLanguages)
    ? resolvedLanguages
    : [resolvedLanguages]) {
    // The first resolution of a name wins so every instance and worker
    // attaches the same grammar data for it.
    const cache =
      resolvedLang.highlights == null
        ? ResolvedLanguages
        : ResolvedHighlightsLanguages;
    let lang = cache.get(resolvedLang.name);
    if (lang == null) {
      lang = resolvedLang;
      cache.set(resolvedLang.name, lang);
    }
    highlighter.attachLanguages([lang]);
    AttachedLanguages.add(lang.name);
  }
}
