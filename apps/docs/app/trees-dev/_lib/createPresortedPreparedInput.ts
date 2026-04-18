import type { FileTreeOptions } from '@pierre/trees';

type FileTreePreparedInput = NonNullable<FileTreeOptions['preparedInput']>;

// This helper exists for demos whose input is already ordered according to the
// same tree sort semantics the live tree will use. It does not sort or
// validate; callers must pass presorted paths.
export function createPresortedPreparedInput(
  paths: readonly string[]
): FileTreePreparedInput {
  return {
    paths,
    presortedPaths: paths,
  } as FileTreePreparedInput;
}
