import {
  type FileTreeOptions,
  preparePresortedFileTreeInput,
} from '@pierre/trees';

type FileTreePreparedInput = NonNullable<FileTreeOptions['preparedInput']>;

// This helper exists for demos whose input is already ordered according to the
// same tree sort semantics the live tree will use.
export function createPresortedPreparedInput(
  paths: readonly string[]
): FileTreePreparedInput {
  return preparePresortedFileTreeInput(paths);
}
