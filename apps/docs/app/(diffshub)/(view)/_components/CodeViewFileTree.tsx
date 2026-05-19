'use client';

import { useStableCallback } from '@pierre/diffs/react';
import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import type {
  FileTreeBatchOperation,
  FileTree as FileTreeModel,
} from '@pierre/trees';
import { themeToTreeStyles } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { FileTreePublicId } from '../../../../../../packages/trees/dist/model/publicTypes';
import {
  BASE_FILE_TREE_OPTIONS,
  CODE_VIEW_FILE_TREE_ITEM_HEIGHT,
  getInitialBatchSize,
} from './constants';
import type { CodeViewFileTreeSource } from './types';
import { useTheme } from '@/components/theme-provider';

// Computed once at module level so they're never re-derived on every render.
const LIGHT_SOFT_TREE_STYLES = themeToTreeStyles(lightSoftTheme);
const DARK_SOFT_TREE_STYLES = themeToTreeStyles(darkSoftTheme);

// These override vars take precedence over the --trees-theme-* vars set by
// themeToTreeStyles, so diffshub-specific layout tweaks are always preserved.
const DENSITY_OVERRIDE_STYLES = {
  '--trees-bg-override': 'var(--diffshub-sidebar-bg)',
  '--trees-density-override': 0.8,
  '--trees-selected-fg-override': 'light-dark(#1c1c1e, #f0f0f2)',
  '--trees-padding-inline-override': 8,
  '--trees-bg-muted': 'light-dark(#f5f5f5, #262626)',
  '--trees-search-bg-override': 'light-dark(#fff, #262626)',
  '--trees-git-renamed-color-override': 'light-dark(#007aff, #007aff)',
} as CSSProperties;

interface CodeViewFileTreeProps {
  // Callback invoked with the underlying tree model once it's mounted, and
  // again with `null` on unmount. Lets parents drive imperative APIs like
  // search open/close without owning the model creation.
  onModelReady(model: FileTreeModel | null): void;
  onSelectItem(itemId: string): void;
  source: CodeViewFileTreeSource;
}

export const CodeViewFileTree = memo(function CodeViewFileTree({
  onModelReady,
  onSelectItem,
  source,
}: CodeViewFileTreeProps) {
  const { resolvedTheme } = useTheme();
  const themeStyles = useMemo(
    () => ({
      ...(resolvedTheme === 'dark'
        ? DARK_SOFT_TREE_STYLES
        : LIGHT_SOFT_TREE_STYLES),
      ...DENSITY_OVERRIDE_STYLES,
    }),
    [resolvedTheme]
  );
  const sourceRef = useRef(source);
  const previousSourceRef = useRef(source);
  const [initialVisibleRowCount] = useState(getInitialBatchSize);
  sourceRef.current = source;
  // `source.paths` aliases the streaming accumulator's live array, so it keeps
  // growing on later publishes. The FileTree model consumes its path list
  // exactly once via useFileTree's useState initializer; capture a bounded
  // snapshot here so the first model build uses only what `pathCount`
  // describes and so subsequent streaming re-renders don't re-slice the
  // ever-growing live array.
  const initialPathsRef = useRef<readonly string[] | null>(null);
  initialPathsRef.current ??= source.paths.slice(0, source.pathCount);
  const sort = useStableCallback<CodeViewFileTreeSource['sort']>(
    (left, right) => sourceRef.current.sort(left, right)
  );
  const onSelectionChange = useStableCallback(
    (selectedPaths: readonly FileTreePublicId[]) => {
      if (selectedPaths.length !== 1 || onSelectItem == null) {
        return;
      }
      const [path] = selectedPaths;
      const itemId = sourceRef.current.pathToItemId.get(path);
      if (itemId != null) {
        onSelectItem(itemId);
      }
    }
  );

  const { model } = useFileTree({
    ...BASE_FILE_TREE_OPTIONS,
    gitStatus: source.gitStatus,
    paths: initialPathsRef.current,
    sort,
    onSelectionChange,
    itemHeight: CODE_VIEW_FILE_TREE_ITEM_HEIGHT,
    initialVisibleRowCount,
  });

  useEffect(() => {
    const previousSource = previousSourceRef.current;
    if (previousSource === source) {
      return;
    }

    previousSourceRef.current = source;
    // The streaming patch loader links each tree-source snapshot to the prior
    // one through `previousSource`. When the link matches what this component
    // last applied, the new paths array is guaranteed to extend the previous
    // one, so we apply the delta as add() operations instead of asking the
    // model to throw itself away and rebuild against the full path list. This
    // turns tree publishes from O(N) each (where N is the total accumulated
    // path count) into O(delta), which keeps the Diff Stats counter fast as
    // more files stream in.
    //
    // Both snapshots alias the live accumulator's paths array, so we read the
    // delta bounds from each snapshot's captured `pathCount` instead of the
    // shared array's current length.
    if (
      source.previousSource != null &&
      source.previousSource === previousSource
    ) {
      const previousPathCount = previousSource.pathCount;
      if (source.pathCount > previousPathCount) {
        const operations: FileTreeBatchOperation[] = [];
        for (let index = previousPathCount; index < source.pathCount; index++) {
          operations.push({ type: 'add', path: source.paths[index] });
        }
        if (operations.length > 0) {
          model.batch(operations);
        }
      }
    } else {
      model.resetPaths(source.paths.slice(0, source.pathCount));
    }
    model.setGitStatus(source.gitStatus);
  }, [model, source]);

  useEffect(() => {
    onModelReady(model);
    return () => onModelReady(null);
  }, [model, onModelReady]);

  return (
    <FileTree
      className="h-full min-h-0 overflow-auto overscroll-contain md:ml-3"
      model={model}
      style={themeStyles}
    />
  );
});
