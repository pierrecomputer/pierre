import type { DynamicImportLanguageRegistration } from 'shiki';

import type { SupportedLanguages } from '../../types';
import type { ResolvedLanguage } from '../../worker';

export const ResolvedLanguages: Map<SupportedLanguages, ResolvedLanguage> =
  new Map();

export const ResolvingLanguages: Map<
  SupportedLanguages,
  Promise<ResolvedLanguage>
> = new Map();

export const RegisteredCustomLanguages: Map<
  string,
  DynamicImportLanguageRegistration
> = new Map();

export const AttachedLanguages: Set<string> = new Set();

/**
 * Languages that only the Highlights backend can lex: file names map to them,
 * but Shiki bundles no grammar. Unless a custom grammar is registered under
 * the same name, Shiki resolves each to an empty grammar so its files render
 * as plain text instead of failing to load.
 */
export const HighlightsOnlyLanguages: ReadonlySet<string> = new Set(['silk']);
