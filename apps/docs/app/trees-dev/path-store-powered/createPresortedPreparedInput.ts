import type { PathStoreFileTreeOptions } from '@pierre/trees/path-store';

type PathStorePreparedInput = NonNullable<
  PathStoreFileTreeOptions['preparedInput']
>;

// This helper exists for demos whose input is already ordered according to the
// same path-store sort semantics the live tree will use. It does not sort or
// validate; callers must pass presorted paths.
export function createPresortedPreparedInput(
  paths: readonly string[]
): PathStorePreparedInput {
  return {
    paths,
    presortedPaths: paths,
  } as PathStorePreparedInput;
}
