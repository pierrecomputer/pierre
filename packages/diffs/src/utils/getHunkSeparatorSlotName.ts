import type { CodeColumnType } from '../types';

export function getHunkSeparatorSlotName(
  type: CodeColumnType,
  hunkIndex: number
) {
  return `hunk-separator-${type}-${hunkIndex}`;
}
