export function getHunkSeparatorSlotName(
  type: 'unified' | 'additions' | 'deletions',
  hunkIndex: number
) {
  return `hunk-separator-${type}-${hunkIndex}`;
}
