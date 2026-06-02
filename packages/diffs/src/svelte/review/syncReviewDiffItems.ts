import type { CodeViewItem } from '../../types.js';

export interface SyncedReviewDiffItems<T = undefined> {
  orderChanged: boolean;
  changedCount: number;
  syncedItems: CodeViewItem<T>[];
}

export function prepareSyncedReviewDiffItems<T>(
  previousItems: ReadonlyMap<string, CodeViewItem<T>>,
  nextItems: readonly CodeViewItem<T>[]
): SyncedReviewDiffItems<T> {
  let orderChanged = previousItems.size !== nextItems.length;
  let changedCount = 0;
  const previousIds = previousItems.keys();
  const syncedItems: CodeViewItem<T>[] = [];

  for (const item of nextItems) {
    const previous = previousItems.get(item.id);
    const previousId = previousIds.next().value;

    if (previous == null || previousId !== item.id) {
      orderChanged = true;
    }

    if (
      previous == null ||
      previous.version !== item.version ||
      previous.collapsed !== item.collapsed
    ) {
      changedCount++;
    }

    if (
      previous != null &&
      previous.version === item.version &&
      previous.collapsed !== item.collapsed
    ) {
      syncedItems.push({
        ...item,
        version: incrementVersion(item.version),
      });
    } else {
      syncedItems.push(item);
    }
  }

  return { orderChanged, changedCount, syncedItems };
}

export function incrementVersion(version: number | undefined): number {
  if (version == null || !Number.isSafeInteger(version)) {
    return 1;
  }

  return version >= Number.MAX_SAFE_INTEGER ? 1 : version + 1;
}
