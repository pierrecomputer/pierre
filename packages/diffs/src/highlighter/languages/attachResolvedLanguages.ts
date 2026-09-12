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
    const grammar = lang.data.find(
      (grammar) =>
        grammar.name === lang.name ||
        grammar.aliases?.includes(lang.name) === true
    );
    if (grammar == null) {
      throw new Error(
        `attachResolvedLanguages: No returned grammar declares "${lang.name}" as its name or an alias.`
      );
    }
    highlighter.loadLanguageSync(lang.data);
    // Shiki can skip an already-loaded grammar, including any newly added aliases.
    try {
      highlighter.getLanguage(lang.name);
    } catch {
      throw new Error(
        `attachResolvedLanguages: "${grammar.name}" is already loaded without alias "${lang.name}". Load the alias first or give the grammar a unique name.`
      );
    }
    AttachedLanguages.add(lang.name);
  }
}
