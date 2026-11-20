import type { BundledLanguage, LanguageRegistration } from 'shiki';

import type { SupportedLanguages } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import type { ResolvedLanguage } from '../../worker';
import {
  HighlightsOnlyLanguages,
  RegisteredCustomLanguages,
  ResolvedLanguages,
  ResolvingLanguages,
} from './constants';

declare const __DIFFS_WORKER__: boolean | undefined;

export async function resolveLanguage(
  lang: Exclude<SupportedLanguages, 'text' | 'ansi'>
): Promise<ResolvedLanguage> {
  if (
    typeof __DIFFS_WORKER__ !== 'undefined'
      ? __DIFFS_WORKER__
      : isWorkerContext()
  ) {
    throw new Error(
      `resolveLanguage("${lang}") cannot be called from a worker context. Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.`
    );
  }
  const pending = ResolvingLanguages.get(lang);
  if (pending != null) return pending;
  const resolver = (async () => {
    let loader = RegisteredCustomLanguages.get(lang);
    if (loader == null) {
      const { bundledLanguages } = await import('shiki/langs');
      if (Object.prototype.hasOwnProperty.call(bundledLanguages, lang))
        loader = bundledLanguages[lang as BundledLanguage];
    }
    if (loader == null && HighlightsOnlyLanguages.has(lang))
      loader = () => loadPlainTextGrammar(lang);
    if (loader == null)
      throw new Error(
        `resolveLanguage: "${lang}" not found in bundled or custom languages`
      );
    const { default: data } = await loader();
    const resolvedLang = { name: lang, data };
    if (!ResolvedLanguages.has(lang)) ResolvedLanguages.set(lang, resolvedLang);
    return resolvedLang;
  })();
  ResolvingLanguages.set(lang, resolver);
  try {
    return await resolver;
  } finally {
    if (ResolvingLanguages.get(lang) === resolver)
      ResolvingLanguages.delete(lang);
  }
}

// An empty TextMate grammar named `lang`: Shiki tokenizes every line as one
// plain run, so a Highlights-only language renders like `text` under Shiki.
function loadPlainTextGrammar(
  lang: string
): Promise<{ default: LanguageRegistration[] }> {
  return Promise.resolve({
    default: [
      { name: lang, scopeName: `source.${lang}`, patterns: [], repository: {} },
    ],
  });
}
