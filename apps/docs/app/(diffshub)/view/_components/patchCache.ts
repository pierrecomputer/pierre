// Tiny in-memory cache of fetched patch text, keyed by GitHub PR path
// (e.g. "/twbs/bootstrap/pull/42369"). Lives at module scope so it survives
// client-side navigations between `/` and `/view` but resets on a full reload.
//
// Why this exists: the home page form pre-fetches the patch so the user sees
// a "Fetching..." state on `/` instead of an empty viewer shell on `/view`.
// Once the fetch resolves, we stash the text here and navigate; CodeViewHeader
// then reuses the cached bytes instead of paying for a second `/api/fetch-pr-patch`
// round trip (the API sets `Cache-Control: no-store`, so the browser cache
// would not help us).

const patchTextByPrPath = new Map<string, string>();

export function getCachedPatchText(prPath: string): string | undefined {
  return patchTextByPrPath.get(prPath);
}

export function setCachedPatchText(prPath: string, patchText: string): void {
  patchTextByPrPath.set(prPath, patchText);
}
