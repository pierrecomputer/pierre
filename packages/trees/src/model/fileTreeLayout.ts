export type FileTreeLayoutRow = {
  ancestorPaths: readonly string[];
  isExpanded: boolean;
  kind: 'directory' | 'file';
  path: string;
};

export type FileTreeLayoutMetrics = {
  itemHeight: number;
  overscan: number;
  scrollTop: number;
  viewportHeight: number;
  // Optional external row count. Callers can skip materializing the full row
  // array (O(n) per scroll) when sticky-row computation is not needed — pass
  // an empty `rows` array plus the real count here so geometry still resolves.
  totalRowCount?: number;
};

export type FileTreeLayoutRange = {
  endIndex: number;
  startIndex: number;
};

export const EMPTY_FILE_TREE_LAYOUT_RANGE: FileTreeLayoutRange = {
  endIndex: -1,
  startIndex: -1,
};

export type FileTreeLayoutStickyRow<
  Row extends FileTreeLayoutRow = FileTreeLayoutRow,
> = {
  row: Row;
  top: number;
};

export type FileTreeLayoutSnapshot<
  Row extends FileTreeLayoutRow = FileTreeLayoutRow,
> = {
  occlusion: {
    firstOccludedIndex: number;
    lastOccludedIndex: number;
    occludedCount: number;
  };
  physical: {
    itemHeight: number;
    maxScrollTop: number;
    overscan: number;
    scrollTop: number;
    totalHeight: number;
    totalRowCount: number;
    viewportHeight: number;
  };
  projected: {
    contentHeight: number;
    paneHeight: number;
    paneTop: number;
  };
  sticky: {
    height: number;
    rows: readonly FileTreeLayoutStickyRow<Row>[];
  };
  visible: FileTreeLayoutRange;
  window: {
    endIndex: number;
    height: number;
    offsetTop: number;
    startIndex: number;
  };
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function createRange(
  startIndex: number,
  endIndex: number
): FileTreeLayoutRange {
  return startIndex < 0 || endIndex < startIndex
    ? EMPTY_FILE_TREE_LAYOUT_RANGE
    : { endIndex, startIndex };
}

function isEmptyRange(range: FileTreeLayoutRange): boolean {
  return range.startIndex < 0 || range.endIndex < range.startIndex;
}

function getRangeHeight(
  range: FileTreeLayoutRange,
  itemHeight: number
): number {
  return isEmptyRange(range)
    ? 0
    : (range.endIndex - range.startIndex + 1) * itemHeight;
}

// Resolves the first row whose box intersects the given content offset.
function getFirstIntersectingIndex(
  offset: number,
  itemCount: number,
  itemHeight: number
): number {
  if (itemCount <= 0) {
    return -1;
  }

  const totalHeight = itemCount * itemHeight;
  if (offset <= 0) {
    return 0;
  }

  if (offset >= totalHeight) {
    return itemCount;
  }

  return Math.floor(offset / itemHeight);
}

// Resolves the last row whose box intersects the half-open content interval
// ending at the provided bottom offset.
function getLastIntersectingIndex(
  bottomOffset: number,
  itemCount: number,
  itemHeight: number
): number {
  if (itemCount <= 0 || bottomOffset <= 0) {
    return -1;
  }

  const totalHeight = itemCount * itemHeight;
  if (bottomOffset >= totalHeight) {
    return itemCount - 1;
  }

  return Math.ceil(bottomOffset / itemHeight) - 1;
}

function getExpandedDirectoryIndicesByDepth<Row extends FileTreeLayoutRow>(
  rows: readonly Row[]
): ReadonlyMap<number, readonly number[]> {
  const indicesByDepth = new Map<number, number[]>();

  rows.forEach((row, index) => {
    if (row.kind !== 'directory' || !row.isExpanded) {
      return;
    }

    const depth = row.ancestorPaths.length;
    const indices = indicesByDepth.get(depth);
    if (indices == null) {
      indicesByDepth.set(depth, [index]);
      return;
    }

    indices.push(index);
  });

  return indicesByDepth;
}

function findLastIndexAtOrBefore(
  indices: readonly number[],
  threshold: number
): number {
  let lowerBound = 0;
  let upperBound = indices.length - 1;
  let match = -1;

  while (lowerBound <= upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const index = indices[midpoint];
    if (index == null) {
      break;
    }

    if (index <= threshold) {
      match = midpoint;
      lowerBound = midpoint + 1;
      continue;
    }

    upperBound = midpoint - 1;
  }

  return match;
}

// Tracks where each expanded directory's visible subtree ends so sticky rows can
// slide out only when the next row outside that subtree reaches the slot.
function computeExpandedSubtreeEndIndices<Row extends FileTreeLayoutRow>(
  rows: readonly Row[]
): ReadonlyMap<string, number> {
  const endIndexByPath = new Map<string, number>();
  const openDirectoryPaths: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row == null) {
      continue;
    }

    const activePaths =
      row.kind === 'directory' && row.isExpanded
        ? [...row.ancestorPaths, row.path]
        : row.ancestorPaths;

    let sharedPrefixLength = 0;
    while (
      sharedPrefixLength < openDirectoryPaths.length &&
      sharedPrefixLength < activePaths.length &&
      openDirectoryPaths[sharedPrefixLength] === activePaths[sharedPrefixLength]
    ) {
      sharedPrefixLength += 1;
    }

    for (
      let openIndex = openDirectoryPaths.length - 1;
      openIndex >= sharedPrefixLength;
      openIndex -= 1
    ) {
      const path = openDirectoryPaths[openIndex];
      if (path != null) {
        endIndexByPath.set(path, index - 1);
      }
    }

    openDirectoryPaths.length = sharedPrefixLength;
    for (
      let activeIndex = sharedPrefixLength;
      activeIndex < activePaths.length;
      activeIndex += 1
    ) {
      const path = activePaths[activeIndex];
      if (path != null) {
        openDirectoryPaths.push(path);
      }
    }
  }

  const lastIndex = rows.length - 1;
  for (const path of openDirectoryPaths) {
    endIndexByPath.set(path, lastIndex);
  }

  return endIndexByPath;
}

// Each sticky slot keeps the latest expanded directory whose real row has
// scrolled past that slot. The first row outside that directory's subtree then
// pushes it upward until it fully leaves the overlay.
function computeStickyRows<Row extends FileTreeLayoutRow>(
  rows: readonly Row[],
  scrollTop: number,
  itemHeight: number
): readonly FileTreeLayoutStickyRow<Row>[] {
  if (rows.length === 0 || scrollTop <= 0) {
    return [];
  }

  const subtreeEndIndexByPath = computeExpandedSubtreeEndIndices(rows);
  const expandedDirectoryIndicesByDepth =
    getExpandedDirectoryIndicesByDepth(rows);
  const stickyRows: Row[] = [];

  for (let slotDepth = 0; slotDepth < rows.length; slotDepth += 1) {
    const candidateIndices = expandedDirectoryIndicesByDepth.get(slotDepth);
    if (candidateIndices == null || candidateIndices.length === 0) {
      break;
    }

    const slotTop = scrollTop + slotDepth * itemHeight;
    const thresholdIndex = Math.min(
      rows.length - 1,
      Math.floor(slotTop / itemHeight)
    );
    let candidateOffset = findLastIndexAtOrBefore(
      candidateIndices,
      thresholdIndex
    );
    let candidate: Row | null = null;

    while (candidateOffset >= 0) {
      const rowIndex = candidateIndices[candidateOffset];
      const row = rowIndex == null ? null : (rows[rowIndex] ?? null);
      if (
        row != null &&
        (slotDepth === 0 ||
          row.ancestorPaths[slotDepth - 1] === stickyRows[slotDepth - 1]?.path)
      ) {
        candidate = row;
        break;
      }

      candidateOffset -= 1;
    }

    if (candidate == null) {
      break;
    }

    stickyRows.push(candidate);
  }

  return stickyRows
    .map((row, slotDepth) => {
      const defaultTop = slotDepth * itemHeight;
      const subtreeEndIndex =
        subtreeEndIndexByPath.get(row.path) ?? rows.length - 1;
      const nextBoundaryIndex = subtreeEndIndex + 1;
      if (nextBoundaryIndex >= rows.length) {
        return { row, top: defaultTop };
      }

      const nextBoundaryTop = nextBoundaryIndex * itemHeight - scrollTop;
      return {
        row,
        top: Math.min(defaultTop, nextBoundaryTop - itemHeight),
      };
    })
    .filter((entry) => entry.top + itemHeight > 0);
}

export function computeFileTreeLayout<Row extends FileTreeLayoutRow>(
  rows: readonly Row[],
  metrics: FileTreeLayoutMetrics
): FileTreeLayoutSnapshot<Row> {
  const totalRowCount = metrics.totalRowCount ?? rows.length;
  const totalHeight = totalRowCount * metrics.itemHeight;
  const viewportHeight = Math.max(0, metrics.viewportHeight);
  const overscan = Math.max(0, Math.floor(metrics.overscan));
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const scrollTop = clamp(metrics.scrollTop, 0, maxScrollTop);
  const stickyRows = computeStickyRows(rows, scrollTop, metrics.itemHeight);
  const stickyHeight = stickyRows.reduce(
    (maximumBottom, entry) =>
      Math.max(maximumBottom, entry.top + metrics.itemHeight),
    0
  );
  const paneTop = Math.min(totalHeight, scrollTop + stickyHeight);
  const paneHeight = Math.max(0, viewportHeight - stickyHeight);
  const contentHeight = Math.max(0, totalHeight - paneTop);

  const firstVisiblePhysicalIndex = getFirstIntersectingIndex(
    scrollTop,
    totalRowCount,
    metrics.itemHeight
  );
  const firstProjectedIndex = getFirstIntersectingIndex(
    paneTop,
    totalRowCount,
    metrics.itemHeight
  );

  const firstOccludedIndex =
    stickyHeight <= 0 ||
    firstVisiblePhysicalIndex < 0 ||
    firstVisiblePhysicalIndex >= totalRowCount
      ? -1
      : firstVisiblePhysicalIndex;
  const lastOccludedIndex =
    firstOccludedIndex === -1
      ? -1
      : Math.min(totalRowCount - 1, firstProjectedIndex - 1);
  const occludedCount =
    firstOccludedIndex === -1 || lastOccludedIndex < firstOccludedIndex
      ? 0
      : lastOccludedIndex - firstOccludedIndex + 1;

  const visible =
    paneHeight <= 0 || firstProjectedIndex >= totalRowCount
      ? EMPTY_FILE_TREE_LAYOUT_RANGE
      : createRange(
          firstProjectedIndex,
          getLastIntersectingIndex(
            paneTop + paneHeight,
            totalRowCount,
            metrics.itemHeight
          )
        );

  // Upward overscan is still useful above the physical viewport, but it must
  // never reintroduce rows that are fully hidden beneath the sticky overlay.
  const minimumWindowStart = lastOccludedIndex + 1;
  const windowRange = isEmptyRange(visible)
    ? EMPTY_FILE_TREE_LAYOUT_RANGE
    : createRange(
        Math.max(minimumWindowStart, visible.startIndex - overscan),
        Math.min(totalRowCount - 1, visible.endIndex + overscan)
      );
  const windowHeight = getRangeHeight(windowRange, metrics.itemHeight);

  return {
    occlusion: {
      firstOccludedIndex,
      lastOccludedIndex,
      occludedCount,
    },
    physical: {
      itemHeight: metrics.itemHeight,
      maxScrollTop,
      overscan,
      scrollTop,
      totalHeight,
      totalRowCount,
      viewportHeight,
    },
    projected: {
      contentHeight,
      paneHeight,
      paneTop,
    },
    sticky: {
      height: stickyHeight,
      rows: stickyRows,
    },
    visible,
    window: {
      endIndex: windowRange.endIndex,
      height: windowHeight,
      offsetTop: isEmptyRange(windowRange)
        ? 0
        : windowRange.startIndex * metrics.itemHeight,
      startIndex: windowRange.startIndex,
    },
  };
}
