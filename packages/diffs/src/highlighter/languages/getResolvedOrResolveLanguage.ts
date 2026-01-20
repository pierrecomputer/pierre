import type { SupportedLanguages } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import { ResolvedLanguages } from './constants';
import { resolveLanguage } from './resolveLanguage';

export function getResolvedOrResolveLanguage(
  language: Exclude<SupportedLanguages, 'text' | 'ansi'>
): ResolvedLanguage | Promise<ResolvedLanguage> {
  return ResolvedLanguages.get(language) ?? resolveLanguage(language);
}
