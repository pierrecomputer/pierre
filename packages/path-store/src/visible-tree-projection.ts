import type {
  PathStoreVisibleRow,
  PathStoreVisibleTreeProjection,
  PathStoreVisibleTreeProjectionRow,
} from './public-types';

const INITIAL_DEPTH_CAPACITY = 64;
type ProjectionDepthTable = Int32Array<ArrayBufferLike>;

/**
 * Builds path-first tree metadata from visible rows using only visible depths,
 * so callers can derive ARIA sibling info without reparsing every row path.
 *
 * Uses typed arrays indexed by projection-row position to track parent
 * relationships and child counts, avoiding Map<string, number> overhead for
 * the per-parent bookkeeping. The visibleIndexByPath Map is built lazily on
 * first access, so callers that only need rows don’t pay for the index.
 */
export function createVisibleTreeProjection(
  rows: readonly Pick<PathStoreVisibleRow, 'depth' | 'path'>[]
): PathStoreVisibleTreeProjection {
  const rowCount = rows.length;
  const projectionRows: PathStoreVisibleTreeProjectionRow[] = new Array(
    rowCount
  );

  // parentRowIndex[i] stores the projection-row index of row i’s parent, or -1
  // for root-level items. Lets the setSize fixup use cheap array indexing
  // instead of Map lookups with path-string keys.
  const parentRowIndex = new Int32Array(rowCount);

  // childCount[i+1] is the running child count for the parent at projection
  // row index i. Index 0 represents the virtual root (parentRowIndex = -1).
  const childCount = new Int32Array(rowCount + 1);

  // lastRowAtDepth[d+1] stores the projection-row index of the most recent row
  // at depth d. Index 0 is the virtual root. Offset by +1 so depth 0 maps to
  // lastRowAtDepth[1] and the virtual root is at lastRowAtDepth[0] = -1.
  let lastRowAtDepth: ProjectionDepthTable = new Int32Array(
    INITIAL_DEPTH_CAPACITY
  );
  lastRowAtDepth.fill(-1);

  for (let index = 0; index < rowCount; index++) {
    const row = rows[index];
    const depth = row.depth;
    lastRowAtDepth = ensureDepthCapacity(lastRowAtDepth, depth);

    // Parent is the most recent row at depth-1 (offset: depth-1+1 = depth).
    const parentIdx = lastRowAtDepth[depth];
    parentRowIndex[index] = parentIdx;

    // Increment child count for parent. childCount uses parentIdx+1 offset.
    const countSlot = parentIdx + 1;
    childCount[countSlot]++;
    const posInSet = childCount[countSlot] - 1;

    projectionRows[index] = {
      index,
      parentPath: parentIdx >= 0 ? projectionRows[parentIdx].path : null,
      path: row.path,
      posInSet,
      setSize: 0, // placeholder — fixed up below
    };

    lastRowAtDepth[depth + 1] = index;
  }

  // Fix up setSize: look up the final child count for each row’s parent.
  for (let i = 0; i < rowCount; i++) {
    projectionRows[i].setSize = childCount[parentRowIndex[i] + 1];
  }

  // Lazily build the path-to-visible-index Map on first access so callers that
  // only read .rows don’t pay the ~98K Map.set cost.
  let cachedVisibleIndexByPath: Map<string, number> | null = null;
  return {
    rows: projectionRows,
    get visibleIndexByPath(): Map<string, number> {
      if (cachedVisibleIndexByPath == null) {
        cachedVisibleIndexByPath = new Map<string, number>();
        for (let i = 0; i < rowCount; i++) {
          cachedVisibleIndexByPath.set(projectionRows[i].path, i);
        }
      }

      return cachedVisibleIndexByPath;
    },
  };
}

function ensureDepthCapacity(
  depthTable: ProjectionDepthTable,
  depth: number
): ProjectionDepthTable {
  const requiredLength = depth + 2;
  if (requiredLength <= depthTable.length) {
    return depthTable;
  }

  let nextLength = depthTable.length;
  while (nextLength < requiredLength) {
    nextLength *= 2;
  }

  const nextDepthTable: ProjectionDepthTable = new Int32Array(nextLength);
  nextDepthTable.fill(-1);
  nextDepthTable.set(depthTable);
  return nextDepthTable;
}
