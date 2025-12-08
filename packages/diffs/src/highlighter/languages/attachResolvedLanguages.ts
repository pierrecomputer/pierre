import type { DiffsHighlighter } from '../../types';
import type { ResolvedLanguage } from '../../worker';
import { AttachedLanguages, ResolvedLanguages } from './constants';

export function attachResolvedLanguages(
  resolvedLanguages: ResolvedLanguage | ResolvedLanguage[],
  highlighter: DiffsHighlighter
): void {
  resolvedLanguages = Array.isArray(resolvedLanguages)
    ? resolvedLanguages
    : [resolvedLanguages];

  for (const resolvedLang of resolvedLanguages) {
    if (AttachedLanguages.has(resolvedLang.name)) continue;
    let lang = ResolvedLanguages.get(resolvedLang.name);
    if (lang == null) {
      lang = resolvedLang;
      ResolvedLanguages.set(resolvedLang.name, lang);
    }
    AttachedLanguages.add(lang.name);
    highlighter.loadLanguageSync(lang.data);
  }
}
