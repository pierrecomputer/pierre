'use client';

import { useStableCallback } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { memo, type MouseEvent, useEffect } from 'react';

import { BASE_FILE_TREE_OPTIONS } from './constants';
import type { CodeViewerFileTreeSource } from './types';
import { cn } from '@/lib/utils';

interface CodeViewerFileTreeProps {
  className?: string;
  onSelectItem?(itemId: string): void;
  source: CodeViewerFileTreeSource | null;
}

// Resolves the tree row underneath a click event by walking through the
// shadow DOM via composedPath(). Returns null for folder clicks, or when the
// event did not originate on a row button at all.
function resolveClickedFilePath(event: MouseEvent<HTMLElement>): string | null {
  for (const node of event.nativeEvent.composedPath()) {
    if (!(node instanceof HTMLElement) || node.dataset.type !== 'item') {
      continue;
    }

    if (node.dataset.itemType !== 'file') {
      return null;
    }

    return node.dataset.itemPath ?? null;
  }

  return null;
}

export const CodeViewerFileTree = memo(function CodeViewerFileTree({
  className,
  onSelectItem,
  source,
}: CodeViewerFileTreeProps) {
  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    gitStatus: source?.gitStatus,
    paths: source?.preparedInput.paths ?? [],
    preparedInput: source?.preparedInput,
  });

  // useFileTree intentionally snapshots options on first mount, so later
  // source changes have to be pushed through the model's imperative API.
  // Because source is stable across annotation updates this effect only runs
  // on real fetches. resetPaths does not carry gitStatus, so we push that
  // separately; the tree's internal signature check no-ops identical inputs.
  useEffect(() => {
    if (source == null) {
      return;
    }

    model.resetPaths(source.preparedInput.paths, {
      preparedInput: source.preparedInput,
    });
    model.setGitStatus(source.gitStatus);
  }, [model, source]);

  const handleClick = useStableCallback(
    (event: MouseEvent<HTMLElement, globalThis.MouseEvent>) => {
      if (onSelectItem == null) {
        return;
      }

      const path = resolveClickedFilePath(event);
      if (path == null) {
        return;
      }

      const itemId = source?.pathToItemId.get(path);
      if (itemId != null) {
        onSelectItem(itemId);
      }
    }
  );

  return source != null ? (
    <FileTree
      className={cn('h-full min-h-0 overflow-auto pt-[19px]', className)}
      model={model}
      onClick={handleClick}
    />
  ) : null;
});
