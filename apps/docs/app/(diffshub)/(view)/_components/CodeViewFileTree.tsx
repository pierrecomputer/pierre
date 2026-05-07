'use client';

import { useStableCallback } from '@pierre/diffs/react';
import type { FileTree as FileTreeModel } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type CSSProperties, memo, useEffect, useRef } from 'react';

import type { FileTreePublicId } from '../../../../../../packages/trees/dist/model/publicTypes';
import { BASE_FILE_TREE_OPTIONS } from './constants';
import type { CodeViewFileTreeSource } from './types';
import { cn } from '@/lib/utils';

const DENSITY_OVERRIDE_STYLES = {
  '--trees-bg-override': 'var(--diffshub-sidebar-bg)',
  '--trees-density-override': 0.8,
  // '--trees-row-height-override': '24px',
  '--trees-selected-fg-override': 'light-dark(#1c1c1e, #f0f0f2)',
} as CSSProperties;

interface CodeViewFileTreeProps {
  className?: string;
  // Callback invoked with the underlying tree model once it's mounted, and
  // again with `null` on unmount. Lets parents drive imperative APIs like
  // search open/close without owning the model creation.
  onModelReady(model: FileTreeModel | null): void;
  onSelectItem(itemId: string): void;
  source: CodeViewFileTreeSource;
}

export const CodeViewFileTree = memo(function CodeViewFileTree({
  className,
  onModelReady,
  onSelectItem,
  source,
}: CodeViewFileTreeProps) {
  const sourceRef = useRef(source);
  const previousSourceRef = useRef(source);
  sourceRef.current = source;
  const sort = useStableCallback<CodeViewFileTreeSource['sort']>(
    (left, right) => sourceRef.current.sort(left, right)
  );
  const onSelectionChange = useStableCallback(
    (selectedPaths: readonly FileTreePublicId[]) => {
      if (selectedPaths.length !== 1 || onSelectItem == null) {
        return;
      }
      const [path] = selectedPaths;
      const itemId = source?.pathToItemId.get(path);
      if (itemId != null) {
        onSelectItem(itemId);
      }
    }
  );

  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    gitStatus: source.gitStatus,
    paths: source.paths,
    sort,
    onSelectionChange,
    itemHeight: 24,
  });

  useEffect(() => {
    if (previousSourceRef.current === source) {
      return;
    }

    previousSourceRef.current = source;
    model.resetPaths(source.paths);
    model.setGitStatus(source.gitStatus);
  }, [model, source]);

  useEffect(() => {
    onModelReady?.(model);
    return () => {
      onModelReady?.(null);
    };
  }, [model, onModelReady]);

  return (
    <FileTree
      className={cn(
        'h-full min-h-0 overflow-auto overscroll-contain pt-2',
        className
      )}
      model={model}
      style={DENSITY_OVERRIDE_STYLES}
    />
  );
});
