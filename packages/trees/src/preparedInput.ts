import { PathStore } from '@pierre/path-store';

import type { FileTreeSortComparator } from './model/publicTypes';

declare const FILE_TREE_PREPARED_INPUT: unique symbol;

// Opaque handle returned by the helper functions below so callers do not hand-roll
// shapes that skip the preparation work PathStore expects.
export interface FileTreePreparedInput {
  readonly [FILE_TREE_PREPARED_INPUT]: true;
  readonly paths: readonly string[];
}

// Precomputes normalized tree input so FileTree can skip repeated parsing work.
export function prepareFileTreeInput(
  paths: readonly string[],
  options: {
    flattenEmptyDirectories?: boolean;
    sort?: 'default' | FileTreeSortComparator;
  } = {}
): FileTreePreparedInput {
  return PathStore.prepareInput(paths, options) as FileTreePreparedInput;
}

// Marks already-sorted input so FileTree can skip both sorting and reparsing work.
export function preparePresortedFileTreeInput(
  paths: readonly string[]
): FileTreePreparedInput {
  return PathStore.preparePresortedInput(paths) as FileTreePreparedInput;
}
