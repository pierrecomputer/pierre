import type { PathStoreFileTreeOptions } from '@pierre/trees/path-store';

type PathStorePreparedInput = NonNullable<
  PathStoreFileTreeOptions['preparedInput']
>;

// The docs demo already receives canonical presorted workloads, so this helper
// builds the matching path-store fast path without sorting again on the client
// or server.
export function createPresortedPreparedInput(
  paths: readonly string[]
): PathStorePreparedInput {
  return {
    paths,
    presortedPaths: paths,
  } as PathStorePreparedInput;
}
