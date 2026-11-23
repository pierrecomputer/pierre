import type { ResolvedLanguage } from '../../worker';
import {
  RegisteredHighlightsLanguages,
  ResolvedHighlightsLanguages,
} from './constants';

/**
 * Load the Highlights lexers registered for these names. Names without one
 * use bundled lexers and are skipped. Return without a promise when every
 * lexer is already loaded.
 */
export function resolveHighlightsLanguages(
  languages: readonly string[]
): ResolvedLanguage[] | Promise<ResolvedLanguage[]> {
  const result: ResolvedLanguage[] = [];
  const pending: Promise<void>[] = [];
  for (const name of languages) {
    const loader = RegisteredHighlightsLanguages.get(name);
    if (loader == null) continue;
    const resolved = ResolvedHighlightsLanguages.get(name);
    if (resolved != null) {
      result.push(resolved);
      continue;
    }
    const index = result.push({ name, data: [] }) - 1;
    pending.push(
      loader().then(({ default: highlights }) => {
        let lang = ResolvedHighlightsLanguages.get(name);
        if (lang == null) {
          lang = { name, data: [], highlights };
          ResolvedHighlightsLanguages.set(name, lang);
        }
        result[index] = lang;
      })
    );
  }
  return pending.length === 0
    ? result
    : Promise.all(pending).then(() => result);
}
