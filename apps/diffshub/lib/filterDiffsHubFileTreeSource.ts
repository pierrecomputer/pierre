import type { GitStatus } from '@pierre/trees';

import type { DiffsHubFileTreeSource } from './types';

// Returns a filtered copy of the source keeping only paths whose effective git
// status is in `selectedStatuses`. An empty selection means "no filter" and
// returns the source unchanged (all paths shown). Paths absent from gitStatus
// are treated as 'modified' (the accumulator intentionally omits them so the
// tree renders them as the visual default). Patch order is preserved because
// the filtered `paths` keep their original relative order from the source.
export function filterDiffsHubFileTreeSource(
  source: DiffsHubFileTreeSource,
  selectedStatuses: ReadonlySet<GitStatus>
): DiffsHubFileTreeSource {
  if (selectedStatuses.size === 0) return source;

  const pathStatusMap = new Map<string, GitStatus>(
    source.gitStatus.map((e) => [e.path, e.status])
  );

  const filteredPaths = source.paths.filter((path) => {
    const status = pathStatusMap.get(path) ?? 'modified';
    return selectedStatuses.has(status);
  });

  const filteredGitStatus = source.gitStatus.filter((e) =>
    selectedStatuses.has(e.status)
  );

  const filteredPathToItemId = new Map<string, string>();
  for (const path of filteredPaths) {
    const id = source.pathToItemId.get(path);
    if (id != null) {
      filteredPathToItemId.set(path, id);
    }
  }

  return {
    gitStatus: filteredGitStatus,
    pathCount: filteredPaths.length,
    paths: filteredPaths,
    pathToItemId: filteredPathToItemId,
  };
}
