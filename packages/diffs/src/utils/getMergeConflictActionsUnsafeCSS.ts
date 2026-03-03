const MERGE_CONFLICT_ACTIONS_UNSAFE_CSS = `
[data-line-annotation],
[data-gutter-buffer='annotation'] {
  --diffs-line-bg: var(--diffs-bg);
}
`;

export function getMergeConflictActionsUnsafeCSS(
  unsafeCSS: string | undefined
): string {
  if (unsafeCSS == null || unsafeCSS.trim() === '') {
    return MERGE_CONFLICT_ACTIONS_UNSAFE_CSS;
  }
  return `${unsafeCSS}\n${MERGE_CONFLICT_ACTIONS_UNSAFE_CSS}`;
}
