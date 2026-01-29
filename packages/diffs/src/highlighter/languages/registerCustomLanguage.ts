import type { DynamicImportLanguageRegistration } from 'shiki';

import { CUSTOM_EXTENSION_TO_FILE_FORMAT } from '../../utils/getFiletypeFromFileName';
import { RegisteredCustomLanguages } from './constants';

/**
 * Register a custom language loader and optionally map it to
 * file names or extensions.
 */
export function registerCustomLanguage(
  lang: string,
  loader: DynamicImportLanguageRegistration,
  /**
   * File names or extensions to map to this language. Use exact filenames
   * (e.g., "Dockerfile", "CMakeLists.txt") or extension tokens without a dot
   * (e.g., "proto", "foo"). Compound extensions are supported
   * (e.g., "blade.php").
   */
  extensionsOrFilenames: string[] = []
): void {
  if (lang === 'text' || lang === 'ansi') {
    throw new Error(
      "registerCustomLanguage: 'text' and 'ansi' are reserved language names"
    );
  }
  if (RegisteredCustomLanguages.has(lang)) {
    console.error(
      `registerCustomLanguage: lang: ${lang} is already registered`
    );
    return;
  }
  RegisteredCustomLanguages.set(lang, loader);
  for (const extension of extensionsOrFilenames) {
    CUSTOM_EXTENSION_TO_FILE_FORMAT.set(extension, lang);
  }
}
