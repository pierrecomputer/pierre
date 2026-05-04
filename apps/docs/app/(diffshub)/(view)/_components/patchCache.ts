// Tiny in-memory cache of fetched patch text, keyed by GitHub path
// (e.g. "/nodejs/node/pull/59805"). Lives at module scope so it survives
// client-side navigations between `/` and the diff viewer but resets on a full reload.
//
// Why this exists: the home page form pre-fetches the patch so the user sees
// a "Fetching..." state on `/` instead of an empty viewer shell.
// Once the fetch resolves, we stash the text here and navigate; CodeViewHeader
// then reuses the cached bytes instead of paying for a second `/api/fetch-pr-patch`
// round trip (the API sets `Cache-Control: no-store`, so the browser cache
// would not help us).

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
