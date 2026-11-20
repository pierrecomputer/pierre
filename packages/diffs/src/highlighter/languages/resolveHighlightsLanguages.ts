import type { ResolvedLanguage } from '../../worker';
import {
  RegisteredHighlightsLanguages,
  ResolvedHighlightsLanguages,
} from './constants';

/**
 * Load the Highlights lexers registered for these names. Names without one
 * use bundled lexers and are skipped.
 */
export function resolveHighlightsLanguages(
  languages: readonly string[]
): Promise<ResolvedLanguage[]> {
  return Promise.all(
    languages.flatMap((name) => {
      const loader = RegisteredHighlightsLanguages.get(name);
      if (loader == null) return [];
      const resolved = ResolvedHighlightsLanguages.get(name);
      if (resolved != null) return [Promise.resolve(resolved)];
      return [
        loader().then(({ default: highlights }) => {
          let lang = ResolvedHighlightsLanguages.get(name);
          if (lang == null) {
            lang = { name, data: [], highlights };
            ResolvedHighlightsLanguages.set(name, lang);
          }
          return lang;
        }),
      ];
    })
  );
}
