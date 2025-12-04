import { bundledLanguages } from 'shiki';

import type { PJSHighlighter, SupportedLanguages } from '../types';
import { isWorkerContext } from '../utils/isWorkerContext';
import type { ResolvedLanguage } from '../worker';

const ResolvedLanguages: Map<SupportedLanguages, ResolvedLanguage> = new Map();

const ResolvingLanguages: Map<
  SupportedLanguages,
  Promise<ResolvedLanguage>
> = new Map();

const attachedLanguages = new Set<string>();

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

export function getResolvedOrResolveLanguage(
  language: Exclude<SupportedLanguages, 'text'>
): ResolvedLanguage | Promise<ResolvedLanguage> {
  return ResolvedLanguages.get(language) ?? resolveLanguage(language);
}

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
        'resolveLanguage: "${lang}" not found in bundled languages'
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

export async function resolveLanguages(
  languages: SupportedLanguages[]
): Promise<ResolvedLanguage[]> {
  const resolvedLanguages: ResolvedLanguage[] = [];
  const languagesToResolve: Promise<ResolvedLanguage | undefined>[] = [];
  for (const language of languages) {
    if (language === 'text') continue;
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

export function attachResolvedLanguages(
  resolvedLanguages: ResolvedLanguage | ResolvedLanguage[],
  highlighter: PJSHighlighter
): void {
  resolvedLanguages = Array.isArray(resolvedLanguages)
    ? resolvedLanguages
    : [resolvedLanguages];

  for (const resolvedLang of resolvedLanguages) {
    if (attachedLanguages.has(resolvedLang.name)) continue;
    let lang = ResolvedLanguages.get(resolvedLang.name);
    if (lang == null) {
      lang = resolvedLang;
      ResolvedLanguages.set(resolvedLang.name, lang);
    }
    attachedLanguages.add(lang.name);
    highlighter.loadLanguageSync(lang.data);
  }
}

export function cleanUpResolvedLanguages(): void {
  ResolvedLanguages.clear();
  attachedLanguages.clear();
}
