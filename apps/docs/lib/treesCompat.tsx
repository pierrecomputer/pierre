'use client';

import {
  type FileTreeBuiltInIconSet,
  type FileTreeIconConfig,
  type FileTreeIcons,
  type FileTreeSearchMode,
  type GitStatusEntry,
  FileTree as PackageFileTreeModel,
  type FileTreeOptions as PackageFileTreeOptions,
  themeToTreeStyles,
  type TreeThemeStyles,
} from '@pierre/trees';
import {
  type FileTreePreloadedData,
  FileTree as PackageReactFileTree,
} from '@pierre/trees/react';
import { preloadFileTree as preloadCanonicalFileTree } from '@pierre/trees/ssr';
import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';

export {
  themeToTreeStyles,
  type FileTreeBuiltInIconSet,
  type FileTreeIconConfig,
  type FileTreeIcons,
  type FileTreeSearchMode,
  type GitStatusEntry,
  type TreeThemeStyles,
};

export interface FileTreeOptions extends Omit<
  PackageFileTreeOptions,
  'paths' | 'initialExpandedPaths' | 'initialSearchQuery'
> {
  initialFiles?: string[];
  lockedPaths?: string[];
  onCollision?: (collision: {
    destination: string;
    origin: string | null;
  }) => boolean;
  useLazyDataLoader?: boolean;
  virtualize?: { threshold: number } | false;
}

export interface FileTreeSelectionItem {
  isFolder: boolean;
  path: string;
}

export interface FileTreeStateConfig {
  expandedItems?: string[];
  files?: string[];
  initialExpandedItems?: string[];
  initialSearchQuery?: string | null;
  initialSelectedItems?: string[];
  onExpandedItemsChange?: (items: string[]) => void;
  onFilesChange?: (files: string[]) => void;
  onSelectedItemsChange?: (items: string[]) => void;
  onSelection?: (items: FileTreeSelectionItem[]) => void;
  selectedItems?: string[];
}

export interface FileTreeSsrPayload {
  html: string;
  id: string;
  shadowHtml: string;
}

function resolvePaths(
  options: FileTreeOptions,
  stateConfig: FileTreeStateConfig | undefined,
  propsFiles: string[] | undefined
): readonly string[] {
  return propsFiles ?? stateConfig?.files ?? options.initialFiles ?? [];
}

function toCanonicalOptions(
  options: Omit<FileTreeOptions, 'initialFiles'>,
  paths: readonly string[],
  initialExpandedItems: string[] | undefined,
  initialSearchQuery: string | null | undefined,
  gitStatus: readonly GitStatusEntry[] | undefined
): PackageFileTreeOptions {
  return {
    ...options,
    ...(gitStatus != null ? { gitStatus: [...gitStatus] } : {}),
    ...(initialExpandedItems != null
      ? { initialExpandedPaths: initialExpandedItems }
      : {}),
    ...(initialSearchQuery !== undefined ? { initialSearchQuery } : {}),
    paths,
  };
}

function mapSelectionItems(
  model: PackageFileTreeModel,
  selectedPaths: readonly string[]
): FileTreeSelectionItem[] {
  return selectedPaths.map((path) => ({
    isFolder: model.getItem(path)?.isDirectory() ?? path.endsWith('/'),
    path,
  }));
}

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
) {
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

export function preloadFileTree(
  options: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): FileTreeSsrPayload {
  const paths = resolvePaths(options, stateConfig, undefined);
  return preloadCanonicalFileTree(
    toCanonicalOptions(
      options,
      paths,
      stateConfig?.expandedItems ?? stateConfig?.initialExpandedItems,
      stateConfig?.initialSearchQuery,
      options.gitStatus
    )
  );
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
    () => files ?? initialFiles ?? [],
    [files, initialFiles]
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
