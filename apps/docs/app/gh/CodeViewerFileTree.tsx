'use client';

import type { CodeViewerItem } from '@pierre/diffs';
import {
  expandImplicitParentDirectories,
  type FileTreeOptions,
  type FileTreeSelectionItem,
} from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import { memo, useCallback, useMemo } from 'react';

import type { CommentMetadata } from './types';
import { cn } from '@/lib/utils';

const FILE_TREE_OPTIONS = {
  flattenEmptyDirectories: true,
  id: 'gh-code-viewer-tree',
  sort: false,
  virtualize: { threshold: 0 },
  search: true,
} satisfies Omit<FileTreeOptions, 'initialFiles'>;

interface CodeViewerFileTreeProps {
  className?: string;
  items: readonly CodeViewerItem<CommentMetadata>[];
  onSelectItem?: (itemId: string) => void;
}

export const CodeViewerFileTree = memo(function CodeViewerFileTree({
  className,
  items,
  onSelectItem,
}: CodeViewerFileTreeProps) {
  const { files, pathToItemId } = useMemo(() => {
    const nextFiles: string[] = [];
    const nextPathToItemId = new Map<string, string>();
    const seen = new Set<string>();

    for (const item of items) {
      const path = item.type === 'diff' ? item.fileDiff.name : item.file.name;
      if (path.length === 0 || seen.has(path)) {
        continue;
      }

      seen.add(path);
      nextFiles.push(path);
      nextPathToItemId.set(path, item.id);
    }

    return {
      files: nextFiles,
      pathToItemId: nextPathToItemId,
    };
  }, [items]);
  const initialExpandedItems = useMemo(
    () => expandImplicitParentDirectories(files),
    [files]
  );
  const handleSelection = useCallback(
    (selection: FileTreeSelectionItem[]) => {
      if (onSelectItem == null) {
        return;
      }

      for (let index = selection.length - 1; index >= 0; index--) {
        const item = selection[index];
        if (item == null || item.isFolder) {
          continue;
        }

        const itemId = pathToItemId.get(item.path);
        if (itemId != null) {
          onSelectItem(itemId);
        }
        return;
      }
    },
    [onSelectItem, pathToItemId]
  );

  return items.length > 0 ? (
    <FileTree
      className={cn('h-full min-h-0 overflow-auto', className)}
      files={files}
      initialExpandedItems={initialExpandedItems}
      onSelection={handleSelection}
      options={FILE_TREE_OPTIONS}
    />
  ) : null;
});
