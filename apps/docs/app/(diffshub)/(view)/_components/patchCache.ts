// Tiny in-memory cache of fetched patch text, keyed by GitHub path (e.g.
// "/nodejs/bootstrap/pull/42369"). Lives at module scope so it survives
// client-side navigations and back/forward visits but resets on a full reload.
//
// This is intentionally not wired into the viewer at the moment. Keep it around
// as a small client-session cache option in case we want to re-enable raw patch
// reuse for repeated visits without changing the viewer flow again.

const patchTextByGitHubPath = new Map<string, string>();

export function getCachedPatchText(githubPath: string): string | undefined {
  return patchTextByGitHubPath.get(githubPath);
}

export function setCachedPatchText(
  githubPath: string,
  patchText: string
): void {
  patchTextByGitHubPath.set(githubPath, patchText);
}
