'use client';

import { useStableCallback } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type CSSProperties, memo, useRef } from 'react';

import type { FileTreePublicId } from '../../../../packages/trees/dist/model/publicTypes';
import { BASE_FILE_TREE_OPTIONS } from './constants';
import type { CodeViewFileTreeSource } from './types';
import { cn } from '@/lib/utils';

const DENSITY_OVERRIDE_STYLES = {
  '--trees-density-override': 0.8,
  '--trees-row-height-override': '24px',
} as CSSProperties;

interface CodeViewFileTreeProps {
  className?: string;
  onSelectItem?(itemId: string): void;
  source: CodeViewFileTreeSource | null;
}

export const CodeViewFileTree = memo(function CodeViewFileTree({
  className,
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

  return (
    <FileTree
      className={cn(
        'h-full min-h-0 overflow-auto overscroll-contain pt-[19px]',
        className
      )}
      model={model}
      style={DENSITY_OVERRIDE_STYLES}
    />
  );
}
