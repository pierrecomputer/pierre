interface BuildGuideLineStyleTextProps {
  selectedIds: string[];
  focusedItemId: string | null;
  childToParent: Map<string, string>;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildGuideLineStyleText({
  selectedIds,
  focusedItemId,
  childToParent,
}: BuildGuideLineStyleTextProps): string {
  if (selectedIds.length === 0 && focusedItemId == null) {
    return '';
  }

  const parentIds = new Set<string>();
  for (const id of selectedIds) {
    const parentId = childToParent.get(id);
    if (parentId != null && parentId !== 'root') {
      parentIds.add(parentId);
    }
  }
  if (focusedItemId != null) {
    const focusedParentId = childToParent.get(focusedItemId);
    if (focusedParentId != null && focusedParentId !== 'root') {
      parentIds.add(focusedParentId);
    }
  }
  if (parentIds.size === 0) {
    return '';
  }

  const selectors = Array.from(parentIds)
    .map(
      (id) =>
        `[data-item-section="spacing-item"][data-ancestor-id="${escapeAttributeValue(id)}"]`
    )
    .join(',\n');
  return `:is(${selectors}) { opacity: 1; }`;
}
