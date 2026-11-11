import type { Language as HighlightsLanguage } from '@pierre/highlights';
import type { DynamicImportLanguageRegistration } from 'shiki';

import { setCustomExtension } from '../../utils/getFiletypeFromFileName';
import {
  RegisteredCustomLanguages,
  RegisteredHighlightsLanguages,
} from './constants';

/**
 * Register a custom language loader and optionally map it to
 * file names or extensions. The registered name must match a returned
 * grammar's name or aliases; registering a loader does not automatically add a
 * grammar alias. A `'highlights'` loader returns a Highlights lexer, such as
 * `@pierre/highlights/langs/*` or `@pierre/wat-tools` output.
 */
export function registerCustomLanguage(
  lang: string,
  loader: DynamicImportLanguageRegistration,
  extensionsOrFilenames?: string[],
  type?: 'textmate'
): void;
export function registerCustomLanguage(
  lang: string,
  loader: () => Promise<{ default: HighlightsLanguage }>,
  extensionsOrFilenames: string[] | undefined,
  type: 'highlights'
): void;
export function registerCustomLanguage(
  lang: string,
  loader:
    | DynamicImportLanguageRegistration
    | (() => Promise<{ default: HighlightsLanguage }>),
  /**
   * File names or extensions to map to this language. Use exact filenames
   * (e.g., "Dockerfile", "CMakeLists.txt") or extension tokens without a dot
   * (e.g., "proto", "foo"). Compound extensions are supported
   * (e.g., "blade.php").
   */
  extensionsOrFilenames: string[] = [],
  type: 'textmate' | 'highlights' = 'textmate'
): void {
  if (lang === 'text' || lang === 'ansi') {
    throw new Error(
      "registerCustomLanguage: 'text' and 'ansi' are reserved language names"
    );
  }
  const loaders =
    type === 'highlights'
      ? RegisteredHighlightsLanguages
      : RegisteredCustomLanguages;
  if (loaders.has(lang)) {
    console.error(
      `registerCustomLanguage: lang: ${lang} is already registered`
    );
    return;
  }
  loaders.set(lang, loader as never);
  for (const extension of extensionsOrFilenames) {
    setCustomExtension(extension, lang);
  }
}
