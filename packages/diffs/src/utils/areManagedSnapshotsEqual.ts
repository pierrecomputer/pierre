import type {
  CodeViewRenderedItem,
  CodeViewSlotSnapshot,
} from '../components/CodeView';

export function areManagedSnapshotsEqual<LAnnotation, LDecoration>(
  previous: CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined,
  next: CodeViewSlotSnapshot<LAnnotation, LDecoration> | undefined
): boolean {
  if (previous == null || next == null) {
    return previous === next;
  }

  if (previous.header !== next.header || previous.footer !== next.footer) {
    return false;
  }

  return areRenderedItemsEqual(previous.items, next.items);
}

function areRenderedItemsEqual<LAnnotation, LDecoration>(
  previous: CodeViewRenderedItem<LAnnotation, LDecoration>[] | undefined,
  next: CodeViewRenderedItem<LAnnotation, LDecoration>[] | undefined
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
      previousItem.instance !== nextItem.instance ||
      previousItem.version !== nextItem.version
    ) {
      return false;
    }
  }

  return true;
}
