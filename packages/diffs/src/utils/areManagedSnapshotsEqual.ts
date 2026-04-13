import type { CodeViewerRenderedItem } from '../components/CodeViewer';

export function areManagedSnapshotsEqual<LAnnotation>(
  previous: CodeViewerRenderedItem<LAnnotation>[] | undefined,
  next: CodeViewerRenderedItem<LAnnotation>[] | undefined
): boolean {
  if (previous == null || next == null) {
    return previous === next;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index++) {
    const previousItem = previous[index];
    const nextItem = next[index];
    if (
      previousItem == null ||
      nextItem == null ||
      previousItem.id !== nextItem.id ||
      previousItem.type !== nextItem.type ||
      previousItem.element !== nextItem.element ||
      previousItem.item.version !== nextItem.item.version
    ) {
      return false;
    }
  }

  return true;
}
