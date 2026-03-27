import type { FileDiffMetadata } from '../types';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';

export function isDiffPlainText(diff: FileDiffMetadata): boolean {
  const computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
  const computedPreviousLang =
    diff.lang ??
    (diff.prevName != null ? getFiletypeFromFileName(diff.prevName) : 'text');
  return computedLang === 'text' && computedPreviousLang === 'text';
}
