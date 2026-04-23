'use client';

import {
  type GitStatusEntry,
  FileTree as PackageFileTreeModel,
  themeToTreeStyles,
  type TreeThemeStyles,
} from '@pierre/trees';
import {
  type FileTreePreloadedData,
  FileTree as PackageReactFileTree,
} from '@pierre/trees/react';
import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import {
  type FileTreeOptions,
  type FileTreeSelectionItem,
  mapSelectionItems,
  resolvePaths,
  toCanonicalOptions,
} from './treesCompatShared';

export { themeToTreeStyles, type TreeThemeStyles };

function applySelection(
  model: PackageFileTreeModel,
  selectedPaths: readonly string[] | undefined,
  onSelectedItemsChange?: (items: string[]) => void,
  onSelection?: (items: FileTreeSelectionItem[]) => void
): void {
  if (selectedPaths == null) {
    return;
  }

  const currentSelectedPaths = model.getSelectedPaths();
  for (const currentPath of currentSelectedPaths) {
    model.getItem(currentPath)?.deselect();
  }
  for (const nextPath of selectedPaths) {
    model.getItem(nextPath)?.select();
  }

  const nextSelectedPaths = model.getSelectedPaths();
  onSelectedItemsChange?.([...nextSelectedPaths]);
  onSelection?.(mapSelectionItems(model, nextSelectedPaths));
}

function applySearch(
  model: PackageFileTreeModel,
  value: string | null | undefined
): void {
  if (value === undefined) {
    return;
  }
  model.setSearch(value);
}

function updatePathsForMutation(
  paths: readonly string[],
  event: Parameters<PackageFileTreeModel['onMutation']>[1] extends (
    event: infer TEvent
  ) => void
    ? TEvent
    : never
): readonly string[] {
  switch (event.operation) {
    case 'add':
      return paths.includes(event.path) ? paths : [...paths, event.path];
    case 'remove':
      return paths.filter((path) => {
        if (path === event.path) {
          return false;
        }
        return !(event.recursive && path.startsWith(event.path));
      });
    case 'move':
      return paths.map((path) => {
        if (path === event.from) {
          return event.to;
        }
        return path.startsWith(event.from)
          ? `${event.to}${path.slice(event.from.length)}`
          : path;
      });
    case 'batch': {
      let nextPaths = [...paths];
      for (const entry of event.events) {
        nextPaths = [...updatePathsForMutation(nextPaths, entry)];
      }
      return nextPaths;
    }
    case 'reset':
      return paths;
  }
}

export interface FileTreeProps {
  className?: string;
  files?: string[];
  gitStatus?: GitStatusEntry[];
  header?: ReactNode;
  initialExpandedItems?: string[];
  initialFiles?: string[];
  initialSearchQuery?: string | null;
  initialSelectedItems?: string[];
  onFilesChange?: (files: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
  options: Omit<FileTreeOptions, 'initialFiles'>;
  prerenderedHTML?: string;
  renderContextMenu?: Parameters<
    typeof PackageReactFileTree
  >[0]['renderContextMenu'];
  selectedItems?: string[];
  style?: CSSProperties;
}

export function FileTree({
  className,
  files,
  gitStatus,
  header,
  initialExpandedItems,
  initialFiles,
  initialSearchQuery,
  initialSelectedItems,
  onFilesChange,
  onSelectedItemsChange,
  onSelection,
  options,
  prerenderedHTML,
  renderContextMenu,
  selectedItems,
  style,
}: FileTreeProps): JSX.Element {
  const resolvedPaths = useMemo(
    () => resolvePaths(options, undefined, files ?? initialFiles),
    [files, initialFiles, options]
  );
  const canonicalOptions = useMemo(
    () =>
      toCanonicalOptions(
        options,
        resolvedPaths,
        initialExpandedItems,
        initialSearchQuery,
        gitStatus
      ),
    [
      gitStatus,
      initialExpandedItems,
      initialSearchQuery,
      options,
      resolvedPaths,
    ]
  );
  const model = useMemo(
    () => new PackageFileTreeModel(canonicalOptions),
    [canonicalOptions]
  );
  const currentPathsRef = useRef<readonly string[]>(resolvedPaths);
  currentPathsRef.current = resolvedPaths;

  useEffect(() => {
    return () => {
      model.cleanUp();
    };
  }, [model]);

  useEffect(() => {
    model.resetPaths(resolvedPaths, {
      initialExpandedPaths: initialExpandedItems,
    });
  }, [initialExpandedItems, model, resolvedPaths]);

  useEffect(() => {
    model.setGitStatus(gitStatus);
  }, [gitStatus, model]);

  useEffect(() => {
    applySearch(model, initialSearchQuery);
  }, [initialSearchQuery, model]);

  useEffect(() => {
    applySelection(
      model,
      selectedItems ?? initialSelectedItems,
      onSelectedItemsChange,
      onSelection
    );
  }, [
    initialSelectedItems,
    model,
    onSelectedItemsChange,
    onSelection,
    selectedItems,
  ]);

  useEffect(() => {
    if (onFilesChange == null) {
      return;
    }

    return model.onMutation('*', (event) => {
      currentPathsRef.current = updatePathsForMutation(
        currentPathsRef.current,
        event
      );
      onFilesChange([...currentPathsRef.current]);
    });
  }, [model, onFilesChange]);

  const preloadedData: FileTreePreloadedData | undefined = useMemo(
    () =>
      prerenderedHTML == null
        ? undefined
        : {
            id: options.id ?? '',
            shadowHtml: prerenderedHTML,
          },
    [options.id, prerenderedHTML]
  );

  return (
    <PackageReactFileTree
      className={className}
      header={header}
      model={model}
      preloadedData={preloadedData}
      renderContextMenu={renderContextMenu}
      style={style}
    />
  );
}
