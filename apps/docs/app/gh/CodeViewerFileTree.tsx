'use client';

import { useStableCallback } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { type CSSProperties, memo, type MouseEvent, useRef } from 'react';

import { BASE_FILE_TREE_OPTIONS } from './constants';
import type { CodeViewerFileTreeSource } from './types';
import { cn } from '@/lib/utils';

const DENSITY_OVERRIDE_STYLES = {
  '--trees-density-override': 0.8,
  '--trees-row-height-override': '24px',
} as CSSProperties;

interface CodeViewerFileTreeProps {
  className?: string;
  onSelectItem?(itemId: string): void;
  source: CodeViewerFileTreeSource | null;
}

export const CodeViewerFileTree = memo(function CodeViewerFileTree({
  className,
  onSelectItem,
  source,
}: CodeViewerFileTreeProps) {
  const previousSourceRef = useRef<CodeViewerFileTreeSource | null>(null);
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
    <CodeViewerFileTreeContent
      key={sourceVersionRef.current}
      className={className}
      onSelectItem={onSelectItem}
      source={source}
    />
  );
});

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

interface CodeViewerFileTreeContentProps extends Omit<
  CodeViewerFileTreeProps,
  'source'
> {
  source: CodeViewerFileTreeSource;
}

function CodeViewerFileTreeContent({
  className,
  onSelectItem,
  source,
}: CodeViewerFileTreeContentProps) {
  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    gitStatus: source.gitStatus,
    paths: source.paths,
    sort: source.sort,
    itemHeight: 24,
  });

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

  return (
    <FileTree
      className={cn(
        'h-full min-h-0 overflow-auto overscroll-contain pt-[19px]',
        className
      )}
      model={model}
      onClick={handleClick}
      style={DENSITY_OVERRIDE_STYLES}
    />
  );
}
