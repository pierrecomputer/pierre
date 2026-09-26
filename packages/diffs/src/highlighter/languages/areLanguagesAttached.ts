import type { DiffsHighlighter, SupportedLanguages } from '../../types';
import { AttachedLanguages } from './constants';

export function areLanguagesAttached(
  languages: SupportedLanguages | SupportedLanguages[],
  highlighter?: DiffsHighlighter
): boolean {
  const names = Array.isArray(languages) ? languages : [languages];
  if (highlighter != null)
    return highlighter.hasLoadedLanguages?.(names) ?? true;
  return names.every(
    (name) => name === 'text' || name === 'ansi' || AttachedLanguages.has(name)
  );
}
