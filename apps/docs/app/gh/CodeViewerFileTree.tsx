'use client';

import type { CodeViewerItem } from '@pierre/diffs';
import { PathStore } from '@pierre/path-store';
import type { FileTreeOptions } from '@pierre/trees';
import {
  FileTree,
  useFileTree,
  useFileTreeSelection,
} from '@pierre/trees/react';
import { memo, useEffect, useMemo, useRef } from 'react';

import type { CommentMetadata } from './types';
import { cn } from '@/lib/utils';

// Options shared across all mounts of this tree. Lives at module scope so the
// reference stays stable and the useFileTree() initial snapshot never churns.
const BASE_FILE_TREE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'gh-code-viewer-tree',
  initialExpansion: 'open',
  search: true,
} as const satisfies Omit<FileTreeOptions, 'paths' | 'preparedInput'>;

// Must match how PathStore.prepareInput() would sort given these options, so
// the tree can skip re-sorting on each mount and resetPaths() call.
const PREPARE_INPUT_OPTIONS = {
  flattenEmptyDirectories: BASE_FILE_TREE_OPTIONS.flattenEmptyDirectories,
};

interface CodeViewerFileTreeProps {
  className?: string;
  items: readonly CodeViewerItem<CommentMetadata>[];
  onSelectItem?: (itemId: string) => void;
}

interface PathIndex {
  preparedInput: ReturnType<typeof PathStore.prepareInput>;
  pathToItemId: ReadonlyMap<string, string>;
}

// Walks the viewer items once to collect a deduplicated path list plus a
// reverse map so a row selection can be translated back to the owning
// CodeViewerItem.id the viewer uses for scroll targets. The paths are then
// handed to PathStore.prepareInput() so the tree receives them canonically
// sorted and does not have to re-sort on every mount.
function derivePathIndex(
  items: readonly CodeViewerItem<CommentMetadata>[]
): PathIndex {
  const paths: string[] = [];
  const pathToItemId = new Map<string, string>();

  for (const item of items) {
    const path = item.type === 'diff' ? item.fileDiff.name : item.file.name;
    if (path.length === 0 || pathToItemId.has(path)) {
      continue;
    }

    paths.push(path);
    pathToItemId.set(path, item.id);
  }

  return {
    preparedInput: PathStore.prepareInput(paths, PREPARE_INPUT_OPTIONS),
    pathToItemId,
  };
}

export const CodeViewerFileTree = memo(function CodeViewerFileTree({
  className,
  items,
  onSelectItem,
}: CodeViewerFileTreeProps) {
  const { preparedInput, pathToItemId } = useMemo(
    () => derivePathIndex(items),
    [items]
  );
  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    paths: preparedInput.paths,
    preparedInput,
  });
  const selectedPaths = useFileTreeSelection(model);

  // Latches the latest onSelectItem so the selection effect below does not
  // have to include the callback in its deps and fire again whenever the
  // parent happens to pass a new function identity.
  const onSelectItemRef = useRef(onSelectItem);
  onSelectItemRef.current = onSelectItem;

  // useFileTree intentionally snapshots options on first mount, so later path
  // updates must go through the model's own resetPaths method to keep the
  // live tree aligned with the viewer's items.
  useEffect(() => {
    model.resetPaths(preparedInput.paths, { preparedInput });
  }, [model, preparedInput]);

  // Translate a selection snapshot into a single navigation event by scanning
  // from the end for the most recently selected file (folders are skipped).
  // An empty selection means the user deselected and no scroll should fire.
  useEffect(() => {
    const callback = onSelectItemRef.current;
    if (callback == null) {
      return;
    }

    for (let index = selectedPaths.length - 1; index >= 0; index--) {
      const path = selectedPaths[index];
      if (path == null || path.endsWith('/')) {
        continue;
      }

      const itemId = pathToItemId.get(path);
      if (itemId != null) {
        callback(itemId);
      }
      return;
    }
  }, [pathToItemId, selectedPaths]);

  if (items.length === 0) {
    return null;
  }

  return (
    <FileTree
      className={cn('h-full min-h-0 overflow-auto', className)}
      model={model}
    />
  );
});
