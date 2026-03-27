import {
  getBenchmarkInstrumentation,
  setBenchmarkCounter,
  withBenchmarkPhase,
} from '../internal/benchmarkInstrumentation';

/**
 * Removes paths whose ancestor directories are not also in the expanded set.
 * When a parent folder is collapsed, its descendants become "orphaned" — they
 * shouldn't be reported as expanded because they're not visible. Without this
 * filter, feeding orphaned paths back through `expandPathsWithAncestors` would
 * re-add the collapsed parent as an ancestor, causing a flicker/re-expansion.
 *
 * With flattened directories, some path ancestors are "interior" nodes —
 * single-child directories absorbed into a flattened chain (e.g. `f::a/b/c`).
 * These interior nodes are invisible in the tree, so their expansion state is
 * irrelevant. We detect them by counting direct children in `pathToId`:
 * a node with exactly 1 child is interior and gets skipped.
 */
export function filterOrphanedPaths(
  expandedPaths: string[],
  pathToId: Map<string, string>,
  flattenEmptyDirectories?: boolean
): string[] {
  const expandedSet = new Set(expandedPaths);

  // Precompute direct child counts (excluding f:: entries) so we can detect
  // interior flattened nodes. A node with exactly 1 child that leads to a
  // flattened chain is invisible in the tree and shouldn't block its
  // descendants from being considered expanded.
  const childCount = new Map<string, number>();
  for (const key of pathToId.keys()) {
    if (key.startsWith('f::') || key === 'root') continue;
    const lastSlash = key.lastIndexOf('/');
    if (lastSlash === -1) continue;
    const parent = key.substring(0, lastSlash);
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }

  return expandedPaths.filter((path) => {
    const isFlattenedPath = pathToId.has('f::' + path);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      // Skip ancestors that aren't actual tree nodes (e.g. intermediate
      // segments in flattened paths that don't exist in the data at all)
      if (!pathToId.has(ancestor) && !pathToId.has('f::' + ancestor)) {
        continue;
      }
      // Ancestor is expanded → OK
      if (expandedSet.has(ancestor)) {
        continue;
      }
      // Ancestor is NOT expanded. If flattening is enabled, this path is a
      // flattened endpoint (f::path exists) and the ancestor is an interior
      // node (single child), it's invisible in the tree → skip it.
      // Without flattening, all folders are real visible nodes — their
      // expansion state matters.
      if (
        flattenEmptyDirectories !== false &&
        isFlattenedPath &&
        childCount.get(ancestor) === 1
      ) {
        continue;
      }
      // Ancestor is a real, visible node but not expanded → path is orphaned
      return false;
    }
    return true;
  });
}

export function buildDirectChildCountMap(
  pathToId: Map<string, string>
): Map<string, number> {
  const childCount = new Map<string, number>();
  for (const key of pathToId.keys()) {
    if (key.startsWith('f::') || key === 'root') continue;
    const lastSlash = key.lastIndexOf('/');
    if (lastSlash === -1) continue;
    const parent = key.substring(0, lastSlash);
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }
  return childCount;
}

export function isOrphanedPathForExpandedSet(
  path: string,
  expandedSet: ReadonlySet<string>,
  pathToId: Map<string, string>,
  options?: {
    flattenEmptyDirectories?: boolean;
    childCount?: Map<string, number>;
  }
): boolean {
  const flattenEmptyDirectories = options?.flattenEmptyDirectories;
  const childCount = options?.childCount ?? buildDirectChildCountMap(pathToId);

  const isFlattenedPath = pathToId.has('f::' + path);
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');

    // Skip ancestors that aren't actual tree nodes (e.g. intermediate
    // segments in flattened paths that don't exist in the data at all)
    if (!pathToId.has(ancestor) && !pathToId.has('f::' + ancestor)) {
      continue;
    }

    // Ancestor is expanded → OK
    if (expandedSet.has(ancestor)) {
      continue;
    }

    // Ancestor is NOT expanded. If flattening is enabled, this path is a
    // flattened endpoint (f::path exists) and the ancestor is an interior
    // node (single child), it's invisible in the tree → skip it.
    // Without flattening, all folders are real visible nodes — their
    // expansion state matters.
    if (
      flattenEmptyDirectories !== false &&
      isFlattenedPath &&
      childCount.get(ancestor) === 1
    ) {
      continue;
    }

    // Ancestor is a real, visible node but not expanded → path is orphaned
    return true;
  }

  return false;
}

export interface ExpandPathsOptions {
  flattenEmptyDirectories?: boolean;
  cache?: Map<string, string[]>;
}

interface ExpandPathsStats {
  ancestorCacheHitCount: number;
  ancestorCacheMissCount: number;
  pathCacheHitCount: number;
  pathCacheMissCount: number;
}

// Resolves each ancestor segment in a path using a shared cache so expanding a
// large folder set does not repeatedly rebuild the same prefix strings.
function resolveAncestorIdsForPath(
  path: string,
  pathToId: Map<string, string>,
  flatten: boolean,
  ancestorIdCache: Map<string, string | null>,
  stats: ExpandPathsStats | null
): string[] {
  const resolvedIds: string[] = [];
  let segmentStart = 0;

  while (true) {
    const slashIndex = path.indexOf('/', segmentStart);
    const endIndex = slashIndex === -1 ? path.length : slashIndex;
    const ancestor = path.slice(0, endIndex);

    if (ancestor.length > 0) {
      if (ancestorIdCache.has(ancestor)) {
        if (stats != null) {
          stats.ancestorCacheHitCount += 1;
        }
        const cachedId = ancestorIdCache.get(ancestor);
        if (cachedId != null) {
          resolvedIds.push(cachedId);
        }
      } else {
        if (stats != null) {
          stats.ancestorCacheMissCount += 1;
        }
        let resolvedId: string | null;
        if (flatten) {
          // Prefer the flattened (f::) ID when it exists — that's the actual
          // item headless-tree renders. Adding both the regular AND flattened
          // IDs causes controlled-state round-trips to re-add IDs that the
          // tree's built-in collapse removed.
          resolvedId =
            pathToId.get('f::' + ancestor) ?? pathToId.get(ancestor) ?? null;
        } else {
          // Without flattening, only use regular IDs — f:: nodes are not
          // rendered and would create an ID mismatch in headless-tree.
          resolvedId = pathToId.get(ancestor) ?? null;
        }
        ancestorIdCache.set(ancestor, resolvedId);
        if (resolvedId != null) {
          resolvedIds.push(resolvedId);
        }
      }
    }

    if (slashIndex === -1) {
      return resolvedIds;
    }
    segmentStart = slashIndex + 1;
  }
}

/**
 * Given a list of file/folder paths, returns the IDs of all those paths
 * plus every ancestor directory. This handles both regular and flattened
 * (f:: prefixed) entries so callers don't need to know about internal IDs.
 */
export function expandPathsWithAncestors(
  paths: string[],
  pathToId: Map<string, string>,
  options?: ExpandPathsOptions
): string[] {
  const benchmarkInstrumentation =
    getBenchmarkInstrumentation(options) ??
    getBenchmarkInstrumentation(pathToId);

  return withBenchmarkPhase(
    benchmarkInstrumentation,
    'expandPathsWithAncestors',
    () => {
      const cache = options?.cache;
      const flatten = options?.flattenEmptyDirectories !== false;
      const ids = new Set<string>();
      const ancestorIdCache = new Map<string, string | null>();
      const stats: ExpandPathsStats | null =
        benchmarkInstrumentation == null
          ? null
          : {
              ancestorCacheHitCount: 0,
              ancestorCacheMissCount: 0,
              pathCacheHitCount: 0,
              pathCacheMissCount: 0,
            };

      for (const path of paths) {
        let expanded = cache?.get(path);
        if (expanded != null) {
          if (stats != null) {
            stats.pathCacheHitCount += 1;
          }
        } else {
          if (stats != null) {
            stats.pathCacheMissCount += 1;
          }
          expanded = resolveAncestorIdsForPath(
            path,
            pathToId,
            flatten,
            ancestorIdCache,
            stats
          );
          cache?.set(path, expanded);
        }

        for (const id of expanded) {
          ids.add(id);
        }
      }

      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsInputCount',
        paths.length
      );
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsResolvedIds',
        ids.size
      );
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsPathCacheHits',
        stats?.pathCacheHitCount ?? 0
      );
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsPathCacheMisses',
        stats?.pathCacheMissCount ?? 0
      );
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsAncestorCacheHits',
        stats?.ancestorCacheHitCount ?? 0
      );
      setBenchmarkCounter(
        benchmarkInstrumentation,
        'workload.expandPathsAncestorCacheMisses',
        stats?.ancestorCacheMissCount ?? 0
      );
      return Array.from(ids);
    }
  );
}
