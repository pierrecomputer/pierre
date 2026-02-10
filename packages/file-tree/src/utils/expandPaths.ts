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
  pathToId: Map<string, string>
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
      // Ancestor is NOT expanded. If this path is a flattened endpoint
      // (f::path exists) and the ancestor is an interior node (single child),
      // it's invisible in the tree → skip it.
      if (isFlattenedPath && childCount.get(ancestor) === 1) {
        continue;
      }
      // Ancestor is a real, visible node but not expanded → path is orphaned
      return false;
    }
    return true;
  });
}

/**
 * Given a list of file/folder paths, returns the IDs of all those paths
 * plus every ancestor directory. This handles both regular and flattened
 * (f:: prefixed) entries so callers don't need to know about internal IDs.
 */
export function expandPathsWithAncestors(
  paths: string[],
  pathToId: Map<string, string>
): string[] {
  const ids = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/');
      // Prefer the flattened (f::) ID when it exists — that's the actual
      // item headless-tree renders. Adding both the regular AND flattened
      // IDs causes controlled-state round-trips to re-add IDs that the
      // tree's built-in collapse removed.
      const flatId = pathToId.get('f::' + ancestor);
      if (flatId != null) {
        ids.add(flatId);
      } else {
        const id = pathToId.get(ancestor);
        if (id != null) ids.add(id);
      }
    }
  }
  return Array.from(ids);
}
