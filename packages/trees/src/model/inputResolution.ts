import { PathStore } from '@pierre/path-store';

import type { FileTreePreparedInput } from '../preparedInput';
import type { FileTreeControllerOptions } from './publicTypes';

function haveMatchingPaths(
  currentPaths: readonly string[],
  preparedPaths: readonly string[]
): boolean {
  if (currentPaths === preparedPaths) {
    return true;
  }

  if (currentPaths.length !== preparedPaths.length) {
    return false;
  }

  for (let index = 0; index < currentPaths.length; index += 1) {
    if (currentPaths[index] !== preparedPaths[index]) {
      return false;
    }
  }

  return true;
}

// Keeps raw path lists and prepared input aligned so callers cannot silently
// reuse stale prepared data after the tree source changes.
export function resolveFileTreeInput(
  options: Pick<FileTreeControllerOptions, 'paths' | 'preparedInput'>,
  context: 'constructor' | 'resetPaths',
  sort: FileTreeControllerOptions['sort']
): {
  paths: readonly string[];
  preparedInput: FileTreePreparedInput | undefined;
} {
  const { paths, preparedInput } = options;
  if (preparedInput == null) {
    if (paths == null) {
      throw new Error('FileTree requires paths or preparedInput');
    }

    return {
      paths,
      preparedInput: undefined,
    };
  }

  const preparedPaths = preparedInput.paths;
  if (paths == null) {
    return {
      paths: preparedPaths,
      preparedInput,
    };
  }

  const comparablePaths = PathStore.preparePaths(
    paths,
    sort == null ? {} : { sort }
  );
  if (!haveMatchingPaths(comparablePaths, preparedPaths)) {
    throw new Error(
      `FileTree ${context} received paths and preparedInput for different path lists`
    );
  }

  return {
    paths: preparedPaths,
    preparedInput,
  };
}
