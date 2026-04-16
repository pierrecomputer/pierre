import type { PathStoreFileTreeOptions } from '@pierre/trees/path-store';

type PathStorePreparedInput = NonNullable<
  PathStoreFileTreeOptions['preparedInput']
>;

// Some docs demos start from intentionally unsorted fixture arrays. Sort once
// here so any caller using the path-store presorted fast path hands SSR and
// hydration the same canonical path order.
export function createPresortedPreparedInput(
  paths: readonly string[]
): PathStorePreparedInput {
  const presortedPaths = [...paths].toSorted();

  return {
    paths: presortedPaths,
    presortedPaths,
  } as PathStorePreparedInput;
}
