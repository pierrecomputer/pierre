import { bundledLanguages } from 'shiki';

import type { SupportedLanguages } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import type { ResolvedLanguage } from '../../worker';
import { ResolvedLanguages, ResolvingLanguages } from './constants';

export async function resolveLanguage(
  lang: Exclude<SupportedLanguages, 'text'>
): Promise<ResolvedLanguage> {
  // Prevent dynamic imports in worker contexts
  if (isWorkerContext()) {
    throw new Error(
      `resolveLanguage("${lang}") cannot be called from a worker context. ` +
        'Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }

  const resolver = ResolvingLanguages.get(lang);
  if (resolver != null) {
    return resolver;
  }

  try {
    const loader = bundledLanguages[lang];
    if (loader == null) {
      throw new Error(
        `resolveLanguage: "${lang}" not found in bundled languages`
      );
    }

    const resolver = loader().then(({ default: data }) => {
      const resolvedLang = { name: lang, data };
      if (!ResolvedLanguages.has(lang)) {
        ResolvedLanguages.set(lang, resolvedLang);
      }
      return resolvedLang;
    });
    ResolvingLanguages.set(lang, resolver);
    return await resolver;
  } finally {
    ResolvingLanguages.delete(lang);
  }
}
