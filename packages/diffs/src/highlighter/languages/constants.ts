import type { SupportedLanguages } from '../../types';
import type { ResolvedLanguage } from '../../worker';

export const ResolvedLanguages: Map<SupportedLanguages, ResolvedLanguage> =
  new Map();

export const ResolvingLanguages: Map<
  SupportedLanguages,
  Promise<ResolvedLanguage>
> = new Map();

export const AttachedLanguages: Set<string> = new Set();
