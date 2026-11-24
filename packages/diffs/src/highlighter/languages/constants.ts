import type { Language as HighlightsLanguage } from '@pierre/highlights';
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

export const RegisteredHighlightsLanguages: Map<
  string,
  () => Promise<{ default: HighlightsLanguage }>
> = new Map();

export const ResolvedHighlightsLanguages: Map<string, ResolvedLanguage> =
  new Map();

export const AttachedLanguages: Set<string> = new Set();
