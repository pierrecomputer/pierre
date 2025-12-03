import { bundledLanguages } from 'shiki';
import type { LanguageRegistration } from 'shiki';

import type { SupportedLanguages } from '../types';

// Type declaration for Web Worker globals
declare const WorkerGlobalScope: new () => Worker;

/**
 * Detects if code is running in a Web Worker context
 */
function isWorkerContext(): boolean {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    typeof self !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}

/**
 * Resolves a language to its full LanguageRegistration data.
 * Handles bundled Shiki languages.
 *
 * WARNING: This function uses dynamic imports and will FAIL in worker contexts
 * (like VSCode webviews). In workers, languages must be pre-resolved on the main
 * thread and passed via the resolvedLanguages parameter.
 *
 * @param lang - The language name to resolve
 * @returns The resolved language data array, or undefined if not found or if it's 'text'
 * @throws Error if called from a worker context
 */
export async function resolveLanguage(
  lang: SupportedLanguages
): Promise<LanguageRegistration[] | undefined> {
  // 'text' is a special built-in language in Shiki, no resolution needed
  if (lang === 'text') {
    return undefined;
  }

  // Prevent dynamic imports in worker contexts
  if (isWorkerContext()) {
    throw new Error(
      `resolveLanguage("${lang}") cannot be called from a worker context. ` +
        'Languages must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }

  try {
    const loader = bundledLanguages[lang];
    if (loader == null) {
      console.warn(`Language "${lang}" not found in bundled languages`);
      return undefined;
    }

    const langModule = await loader();
    return langModule.default;
  } catch (error) {
    console.error(`Failed to resolve language "${lang}":`, error);
    return undefined;
  }
}
