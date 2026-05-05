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
  '--trees-bg-override': 'light-dark(oklch(98.5% 0 0), oklch(20.5% 0 0))',
  '--trees-density-override': 0.8,
  // '--trees-row-height-override': '24px',
  '--trees-selected-fg-override': 'light-dark(#1c1c1e, #f0f0f2)',
} as CSSProperties;

interface CodeViewFileTreeProps {
  className?: string;
  // Callback invoked with the underlying tree model once it's mounted, and
  // again with `null` on unmount. Lets parents drive imperative APIs like
  // search open/close without owning the model creation.
  onModelReady?(model: FileTreeModel | null): void;
  onSelectItem?(itemId: string): void;
  source: CodeViewFileTreeSource | null;
}

export const CodeViewFileTree = memo(function CodeViewFileTree({
  className,
  onModelReady,
  onSelectItem,
  source,
}: CodeViewFileTreeProps) {
  const previousSourceRef = useRef<CodeViewFileTreeSource | null>(null);
  const sourceVersionRef = useRef(0);

  if (source == null) {
    previousSourceRef.current = null;
    return null;
  }

  if (source !== previousSourceRef.current) {
    previousSourceRef.current = source;
    sourceVersionRef.current += 1;
  }

  return (
    <CodeViewFileTreeContent
      key={sourceVersionRef.current}
      className={className}
      onModelReady={onModelReady}
      onSelectItem={onSelectItem}
      source={source}
    />
  );
});

interface CodeViewFileTreeContentProps extends Omit<
  CodeViewFileTreeProps,
  'source'
> {
  source: CodeViewFileTreeSource;
}

function CodeViewFileTreeContent({
  className,
  onModelReady,
  onSelectItem,
  source,
}: CodeViewFileTreeContentProps) {
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
    sort: source.sort,
    onSelectionChange,
    itemHeight: 24,
  });

  useEffect(() => {
    onModelReady?.(model);
    return () => {
      onModelReady?.(null);
    };
  }, [model, onModelReady]);

  return (
    <FileTree
      className={cn(
        'h-full min-h-0 overflow-auto overscroll-contain pt-2 bg-transparent',
        className
      )}
      model={model}
      style={DENSITY_OVERRIDE_STYLES}
    />
  );
}
