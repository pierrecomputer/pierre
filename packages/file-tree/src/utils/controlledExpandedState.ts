import { FLATTENED_PREFIX } from '../constants';

const stripFlattenedPrefix = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

/**
 * Convert headless-tree expanded IDs into path strings suitable for external
 * controlled state, matching Root.tsx behavior.
 */
export function expandedIdsToControlledExpandedPaths(
  expandedIds: string[],
  idToPath: Map<string, string>,
  _pathToId: Map<string, string>,
  _options: { flattenEmptyDirectories?: boolean }
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of expandedIds) {
    const raw = idToPath.get(id);
    if (raw == null) continue;
    const path = stripFlattenedPrefix(raw);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }

  // IMPORTANT: do not filter "orphaned" expanded paths. In a controlled setup,
  // we want to preserve subtree state (expanded descendants) while an ancestor
  // is collapsed so it can be restored when the ancestor re-expands.
  return out;
}

/**
 * Convert controlled expanded path strings into headless-tree IDs, matching
 * Root.tsx behavior.
 */
export function controlledExpandedPathsToExpandedIds(
  expandedPaths: string[],
  pathToId: Map<string, string>,
  options: { flattenEmptyDirectories?: boolean }
): string[] {
  const flatten = options.flattenEmptyDirectories !== false;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const path of expandedPaths) {
    // If the caller explicitly provides a flattened path, respect it.
    if (path.startsWith(FLATTENED_PREFIX)) {
      const id = pathToId.get(path);
      if (id != null && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
      continue;
    }

    const id = flatten
      ? (pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path))
      : pathToId.get(path);
    if (id != null && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }

  // NOTE: We intentionally do NOT auto-expand ancestors. Controlled expandedItems
  // may include "orphaned" descendants whose ancestors are currently collapsed;
  // expanding ancestors here would force them open and break subtree preservation.
  return out;
}
