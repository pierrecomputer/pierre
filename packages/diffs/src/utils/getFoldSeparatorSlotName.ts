import type { CodeColumnType } from '../types';

export function getFoldSeparatorSlotName(
  type: CodeColumnType,
  foldIndex: number
) {
  return `fold-separator-${type}-${foldIndex}`;
}
