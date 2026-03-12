import {
  expandAllFeature,
  hotkeysCoreFeature,
  type ItemInstance,
  keyboardDragAndDropFeature,
  propMemoizationFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeInstance,
} from '@headless-tree/core';
import { Component, createElement, Fragment } from 'preact';
import type { FunctionComponent, JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';

import {
  CONTEXT_MENU_SLOT_NAME,
  CONTEXT_MENU_TRIGGER_TYPE,
  FLATTENED_PREFIX,
  HEADER_SLOT_NAME,
} from '../constants';
import { dragAndDropFeature } from '../features/dragAndDropFeature';
import {
  fileTreeSearchFeature,
  getSearchVisibleIdSet,
} from '../features/fileTreeSearchFeature';
import {
  getGitStatusMap,
  gitStatusFeature,
} from '../features/gitStatusFeature';
import type {
  FileTreeCallbacks,
  FileTreeHandle,
  FileTreeOptions,
  FileTreeSelectionItem,
  FileTreeStateConfig,
} from '../FileTree';
import { generateLazyDataLoader } from '../loader/lazy';
import { generateSyncDataLoaderFromTreeData } from '../loader/sync';
import type { SVGSpriteNames } from '../sprite';
import type { FileTreeNode } from '../types';
import { computeNewFilesAfterDrop } from '../utils/computeNewFilesAfterDrop';
import { controlledExpandedPathsToExpandedIds } from '../utils/controlledExpandedState';
import {
  expandPathsWithAncestors,
  filterOrphanedPaths,
} from '../utils/expandPaths';
import { fileListToTree } from '../utils/fileListToTree';
import { getGitStatusSignature } from '../utils/getGitStatusSignature';
import type { ChildrenSortOption } from '../utils/sortChildren';
import { useTree } from './hooks/useTree';
import { Icon } from './Icon';
import { VirtualizedList } from './VirtualizedList';

export interface FileTreeRootProps {
  fileTreeOptions: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  handleRef?: { current: FileTreeHandle | null };
  callbacksRef?: { current: FileTreeCallbacks };
}

// Local memo implementation to avoid importing from preact/compat, which
// declares `export as namespace React` and pollutes the global type namespace,
// breaking the React wrapper's JSX types.
function memo<P>(
  c: FunctionComponent<P>,
  comparer: (prev: P, next: P) => boolean
): FunctionComponent<P> {
  class Memoed extends Component<P> {
    override shouldComponentUpdate(nextProps: P) {
      return !comparer(this.props as P, nextProps);
    }
    override render() {
      return createElement(
        c as FunctionComponent,
        this.props as Record<string, unknown>
      );
    }
  }
  Memoed.displayName = `Memo(${c.displayName ?? c.name ?? 'Component'})`;
  return Memoed as unknown as FunctionComponent<P>;
}

const getSelectionPath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

const getFilesSignature = (files: string[]): string =>
  `${files.length}\0${files.join('\0')}`;

const EMPTY_ANCESTORS: string[] = [];

function FlattenedDirectoryName({
  tree,
  idToPath,
  flattens,
  fallbackName,
}: {
  tree: TreeInstance<FileTreeNode>;
  idToPath: Map<string, string>;
  flattens: string[];
  fallbackName: string;
}): JSX.Element {
  'use no memo';
  const segments = useMemo(() => {
    const result: { id: string; label: string }[] = [];
    for (const id of flattens) {
      const item = tree.getItemInstance(id);
      if (item != null) {
        result.push({ id: item.getId(), label: item.getItemName() });
      } else {
        const path = idToPath.get(id);
        const label = path != null ? (path.split('/').pop() ?? id) : id;
        result.push({ id, label });
      }
    }
    return result;
  }, [flattens, tree, idToPath]);

  if (segments.length === 0) {
    return (
      <span data-item-flattened-subitems>
        {fallbackName.replace(/\//g, ' / ')}
      </span>
    );
  }

  return (
    <span data-item-flattened-subitems>
      {segments.map(({ id, label }, index) => {
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={id}>
            <span data-item-flattened-subitem={id}>{label}</span>
            {!isLast ? ' / ' : ''}
          </Fragment>
        );
      })}
    </span>
  );
}

interface TreeItemProps {
  item: ItemInstance<FileTreeNode>;
  tree: TreeInstance<FileTreeNode>;
  itemId: string;
  hasChildren: boolean;
  isExpanded: boolean;
  itemName: string;
  level: number;
  isSelected: boolean;
  isFocused: boolean;
  isSearchMatch: boolean;
  isDragTarget: boolean;
  isDragging: boolean;
  isDnD: boolean;
  isFlattenedDirectory: boolean;
  isLocked: boolean;
  gitStatus: string | undefined;
  containsGitChange: boolean;
  flattens: string[] | undefined;
  idToPath: Map<string, string>;
  ancestors: string[];
  treeDomId: string;
  remapIcon: (name: SVGSpriteNames) => {
    name: string;
    remappedFrom?: string;
    width?: number;
    height?: number;
    viewBox?: string;
  };
  detectFlattenedSubfolder: (e: DragEvent) => void;
  clearFlattenedSubfolder: () => void;
}

function treeItemPropsAreEqual(
  prev: Readonly<TreeItemProps>,
  next: Readonly<TreeItemProps>
): boolean {
  return (
    prev.itemId === next.itemId &&
    prev.hasChildren === next.hasChildren &&
    prev.isExpanded === next.isExpanded &&
    prev.itemName === next.itemName &&
    prev.level === next.level &&
    prev.isSelected === next.isSelected &&
    prev.isFocused === next.isFocused &&
    prev.isSearchMatch === next.isSearchMatch &&
    prev.isDragTarget === next.isDragTarget &&
    prev.isDragging === next.isDragging &&
    prev.isDnD === next.isDnD &&
    prev.isFlattenedDirectory === next.isFlattenedDirectory &&
    prev.isLocked === next.isLocked &&
    prev.gitStatus === next.gitStatus &&
    prev.containsGitChange === next.containsGitChange &&
    prev.flattens === next.flattens &&
    prev.ancestors === next.ancestors &&
    prev.treeDomId === next.treeDomId
  );
}

function TreeItemInner({
  item,
  tree,
  itemId,
  hasChildren,
  itemName,
  level,
  isSelected,
  isFocused,
  isSearchMatch,
  isDragTarget,
  isDragging,
  isDnD,
  isFlattenedDirectory,
  isLocked,
  gitStatus: itemGitStatus,
  containsGitChange: itemContainsGitChange,
  flattens,
  idToPath,
  ancestors,
  treeDomId,
  remapIcon,
  detectFlattenedSubfolder,
  clearFlattenedSubfolder,
}: TreeItemProps): JSX.Element {
  'use no memo';
  const startWithCapital =
    itemName.charAt(0).toUpperCase() === itemName.charAt(0);
  const alignCapitals = startWithCapital;

  const selectionProps = isSelected ? { 'data-item-selected': true } : {};
  const focusedProps = isFocused ? { 'data-item-focused': true } : {};
  const searchMatchProps = isSearchMatch
    ? { 'data-item-search-match': true }
    : {};
  const dragProps = isDnD
    ? {
        ...(isDragTarget && { 'data-item-drag-target': true }),
        ...(isDragging && { 'data-item-dragging': true }),
      }
    : {};
  const gitStatusProps = {
    ...(itemGitStatus != null && {
      'data-item-git-status': itemGitStatus,
    }),
    ...(itemContainsGitChange && {
      'data-item-contains-git-change': 'true',
    }),
  };

  const baseProps = item.getProps();
  const itemProps =
    isDnD && isFlattenedDirectory
      ? {
          ...baseProps,
          onDragOver: (e: DragEvent) => {
            (baseProps.onDragOver as ((e: DragEvent) => void) | undefined)?.(e);
            detectFlattenedSubfolder(e);
          },
          onDragLeave: (e: DragEvent) => {
            clearFlattenedSubfolder();
            (baseProps.onDragLeave as ((e: DragEvent) => void) | undefined)?.(
              e
            );
          },
          onDrop: (e: DragEvent) => {
            (baseProps.onDrop as ((e: DragEvent) => void) | undefined)?.(e);
            clearFlattenedSubfolder();
          },
        }
      : baseProps;

  const statusLabel =
    itemGitStatus === 'added'
      ? 'A'
      : itemGitStatus === 'deleted'
        ? 'D'
        : itemGitStatus === 'modified'
          ? 'M'
          : null;
  const showStatusDot = statusLabel == null && itemContainsGitChange;

  const getItemDomId = (id: string) => `${treeDomId}-${id}`;

  return (
    <button
      data-type="item"
      data-item-type={hasChildren ? 'folder' : 'file'}
      {...selectionProps}
      {...searchMatchProps}
      {...focusedProps}
      {...dragProps}
      {...gitStatusProps}
      data-item-id={itemId}
      id={getItemDomId(itemId)}
      {...itemProps}
      key={itemId}
    >
      {level > 0 ? (
        <div data-item-section="spacing">
          {Array.from({ length: level }).map((_, index) => (
            <div
              key={index}
              data-item-section="spacing-item"
              data-ancestor-id={ancestors[index]}
            />
          ))}
        </div>
      ) : null}
      <div data-item-section="icon">
        {hasChildren ? (
          <Icon
            {...remapIcon('file-tree-icon-chevron')}
            alignCapitals={alignCapitals}
          />
        ) : (
          <Icon {...remapIcon('file-tree-icon-file')} />
        )}
      </div>
      <div data-item-section="content">
        {isFlattenedDirectory ? (
          <FlattenedDirectoryName
            tree={tree}
            idToPath={idToPath}
            flattens={flattens ?? []}
            fallbackName={itemName}
          />
        ) : (
          itemName
        )}
      </div>

      {statusLabel || showStatusDot ? (
        <div data-item-section="status">
          {statusLabel ?? (
            <Icon {...remapIcon('file-tree-icon-dot')} width={6} height={6} />
          )}
        </div>
      ) : null}
      {isLocked ? (
        <div data-item-section="lock">
          <Icon {...remapIcon('file-tree-icon-lock')} />
        </div>
      ) : null}
    </button>
  );
}

const TreeItem = memo(TreeItemInner, treeItemPropsAreEqual);

export function Root({
  fileTreeOptions,
  stateConfig,
  handleRef,
  callbacksRef,
}: FileTreeRootProps): JSX.Element {
  'use no memo';
  const {
    initialFiles: files,
    flattenEmptyDirectories,
    fileTreeSearchMode,
    gitStatus,
    lockedPaths,
    onCollision,
    search,
    sort: sortOption,
    useLazyDataLoader,
    virtualize,
  } = fileTreeOptions;

  const iconRemap = fileTreeOptions.icons?.remap;
  const remapIcon = useCallback(
    (
      name: SVGSpriteNames
    ): {
      name: string;
      remappedFrom?: string;
      width?: number;
      height?: number;
      viewBox?: string;
    } => {
      const entry = iconRemap?.[name];
      if (entry == null) return { name };
      if (typeof entry === 'string') return { name: entry, remappedFrom: name };
      return { ...entry, remappedFrom: name };
    },
    [iconRemap]
  );

  const treeDomId = useMemo(() => {
    const base = fileTreeOptions.id ?? 'ft';
    const safe = base.replace(/[^A-Za-z0-9_-]/g, '_');
    return `ft-${safe}`;
  }, [fileTreeOptions.id]);
  const getItemDomId = (itemId: string) => `${treeDomId}-${itemId}`;

  // Resolve sort option to a comparator (or undefined for default behavior).
  // `false` → preserve insertion order and skip sort work.
  // `{ comparator }` → custom comparator.
  // `true` / `undefined` → undefined (use default).
  const sortComparator = useMemo<ChildrenSortOption | undefined>(
    () =>
      sortOption === false
        ? false
        : sortOption != null && typeof sortOption === 'object'
          ? sortOption.comparator
          : undefined,
    [sortOption]
  );

  const treeData = useMemo(
    () => fileListToTree(files, { sortComparator }),
    [files, sortComparator]
  );

  // Build path↔id maps from treeData
  const { pathToId, idToPath } = useMemo(() => {
    const p2i = new Map<string, string>();
    const i2p = new Map<string, string>();
    for (const [id, node] of Object.entries(treeData)) {
      p2i.set(node.path, id);
      i2p.set(id, node.path);
    }
    return { pathToId: p2i, idToPath: i2p };
  }, [treeData]);

  const ancestorChainsCacheRef = useRef<Map<string, string[]>>(new Map());
  const prevIdToPathForCacheRef = useRef(idToPath);
  if (prevIdToPathForCacheRef.current !== idToPath) {
    prevIdToPathForCacheRef.current = idToPath;
    ancestorChainsCacheRef.current.clear();
  }

  const restTreeConfig = useMemo(() => {
    const mapId = (item: string): string => {
      if (treeData[item] != null) {
        return item;
      }
      return pathToId.get(item) ?? item;
    };

    const mapIds = (items: string[] | undefined): string[] | undefined => {
      if (items == null) {
        return undefined;
      }
      let changed = false;
      const mapped = items.map((item) => {
        const mappedItem = mapId(item);
        if (mappedItem !== item) {
          changed = true;
        }
        return mappedItem;
      });
      return changed ? mapped : items;
    };

    type TreeStateConfig = {
      expandedItems?: string[];
      selectedItems?: string[];
      focusedItem?: string | null;
      renamingItem?: string | null;
      checkedItems?: string[];
      loadingCheckPropagationItems?: string[];
      [key: string]: unknown;
    };

    const mapState = (state: TreeStateConfig | undefined) => {
      if (state == null) {
        return { state, changed: false };
      }
      let changed = false;
      const nextState: TreeStateConfig = { ...state };

      const mappedExpanded = mapIds(state.expandedItems);
      if (mappedExpanded !== state.expandedItems) {
        nextState.expandedItems = mappedExpanded;
        changed = true;
      }

      const mappedSelected = mapIds(state.selectedItems);
      if (mappedSelected !== state.selectedItems) {
        nextState.selectedItems = mappedSelected;
        changed = true;
      }

      const mappedFocused =
        state.focusedItem != null
          ? mapId(state.focusedItem)
          : state.focusedItem;
      if (mappedFocused !== state.focusedItem) {
        nextState.focusedItem = mappedFocused;
        changed = true;
      }

      const mappedRenaming =
        state.renamingItem != null
          ? mapId(state.renamingItem)
          : state.renamingItem;
      if (mappedRenaming !== state.renamingItem) {
        nextState.renamingItem = mappedRenaming;
        changed = true;
      }

      const mappedChecked = mapIds(state.checkedItems);
      if (mappedChecked !== state.checkedItems) {
        nextState.checkedItems = mappedChecked;
        changed = true;
      }

      const mappedLoadingChecked = mapIds(state.loadingCheckPropagationItems);
      if (mappedLoadingChecked !== state.loadingCheckPropagationItems) {
        nextState.loadingCheckPropagationItems = mappedLoadingChecked;
        changed = true;
      }

      return { state: changed ? nextState : state, changed };
    };

    const baseConfig: TreeStateConfig = {};

    const mapPathToId = (path: string): string | undefined => {
      // If the caller explicitly passes a flattened path, respect it.
      if (path.startsWith(FLATTENED_PREFIX)) {
        return pathToId.get(path);
      }

      const shouldFlatten = flattenEmptyDirectories === true;

      // Only prefer flattened IDs when the tree is actually rendering flattened
      // directories. Otherwise, selecting a path that *could* be flattened would
      // target a hidden node and the visible folder would not be marked selected.
      if (shouldFlatten) {
        return pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path);
      }
      return pathToId.get(path);
    };

    const mapPathsToIds = (
      paths: string[] | undefined
    ): string[] | undefined => {
      if (paths == null) return undefined;
      const ids = paths
        .map(mapPathToId)
        .filter((id): id is string => id != null);
      return ids.length > 0 ? ids : [];
    };

    // Merge top-level initialExpandedItems/initialSelectedItems/initialSearchQuery into config.initialState
    const topLevelInitialExpanded = stateConfig?.initialExpandedItems;
    const topLevelInitialSelected = stateConfig?.initialSelectedItems;
    const topLevelInitialSearch = stateConfig?.initialSearchQuery;
    const topLevelInitialExpandedIds =
      topLevelInitialExpanded != null
        ? expandPathsWithAncestors(topLevelInitialExpanded, pathToId, {
            flattenEmptyDirectories,
          })
        : undefined;
    const topLevelInitialSelectedIds = mapPathsToIds(topLevelInitialSelected);
    const hasTopLevelInitial =
      topLevelInitialExpanded != null ||
      topLevelInitialSelected != null ||
      topLevelInitialSearch != null;

    const mergedInitialState = hasTopLevelInitial
      ? {
          ...(baseConfig.initialState as TreeStateConfig | undefined),
          ...(topLevelInitialExpandedIds != null && {
            expandedItems: topLevelInitialExpandedIds,
          }),
          ...(topLevelInitialSelectedIds != null && {
            selectedItems: topLevelInitialSelectedIds,
          }),
          ...(topLevelInitialSearch != null && {
            search: topLevelInitialSearch,
          }),
        }
      : (baseConfig.initialState as TreeStateConfig | undefined);

    // Merge top-level expandedItems/selectedItems into config.state
    const topLevelExpanded = stateConfig?.expandedItems;
    const topLevelSelected = stateConfig?.selectedItems;
    const topLevelExpandedIds =
      topLevelExpanded != null
        ? controlledExpandedPathsToExpandedIds(topLevelExpanded, pathToId, {
            flattenEmptyDirectories,
          })
        : undefined;
    const topLevelSelectedIds = mapPathsToIds(topLevelSelected);
    const hasTopLevelState =
      topLevelExpanded != null || topLevelSelected != null;

    const mergedState = hasTopLevelState
      ? {
          ...(baseConfig.state as TreeStateConfig | undefined),
          ...(topLevelExpandedIds != null && {
            expandedItems: topLevelExpandedIds,
          }),
          ...(topLevelSelectedIds != null && {
            selectedItems: topLevelSelectedIds,
          }),
        }
      : (baseConfig.state as TreeStateConfig | undefined);

    const configWithMergedState = {
      ...baseConfig,
      ...(mergedInitialState != null && { initialState: mergedInitialState }),
      ...(mergedState != null && { state: mergedState }),
    };

    const initialState = mapState(
      configWithMergedState.initialState as TreeStateConfig
    );
    const state = mapState(configWithMergedState.state as TreeStateConfig);

    if (!initialState.changed && !state.changed) {
      return configWithMergedState;
    }

    return {
      ...configWithMergedState,
      ...(initialState.state != null && { initialState: initialState.state }),
      ...(state.state != null && { state: state.state }),
    };
  }, [treeData, pathToId, stateConfig, flattenEmptyDirectories]);
  const dataLoader = useMemo(
    () =>
      useLazyDataLoader === true
        ? generateLazyDataLoader(files, {
            flattenEmptyDirectories,
            sortComparator,
          })
        : generateSyncDataLoaderFromTreeData(treeData, {
            flattenEmptyDirectories,
          }),
    [
      files,
      flattenEmptyDirectories,
      sortComparator,
      treeData,
      useLazyDataLoader,
    ]
  );

  const isDnD = fileTreeOptions.dragAndDrop === true;

  const features = useMemo(() => {
    const base = [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      expandAllFeature,
      gitStatusFeature,
    ];
    if (isDnD) {
      base.push(dragAndDropFeature, keyboardDragAndDropFeature);
    }
    base.push(propMemoizationFeature);
    return base;
  }, [isDnD]);

  // Keep a ref to current files so onDrop doesn't capture stale values
  const filesRef = useRef(files);
  filesRef.current = files;

  // --- Flattened sub-folder drop targeting ---
  const flattenedDropSubfolderIdRef = useRef<string | null>(null);
  const flattenedHighlightRef = useRef<HTMLElement | null>(null);

  const detectFlattenedSubfolder = useCallback((e: DragEvent) => {
    let el = e.target as HTMLElement | null;
    if (el != null && el.nodeType === Node.TEXT_NODE) {
      el = el.parentElement;
    }
    const span = el?.closest?.(
      '[data-item-flattened-subitem]'
    ) as HTMLElement | null;
    const id = span?.getAttribute('data-item-flattened-subitem') ?? null;

    if (id === flattenedDropSubfolderIdRef.current) return;

    if (flattenedHighlightRef.current != null) {
      flattenedHighlightRef.current.removeAttribute(
        'data-item-flattened-subitem-drag-target'
      );
    }

    if (span != null && id != null) {
      span.setAttribute('data-item-flattened-subitem-drag-target', 'true');
      flattenedHighlightRef.current = span;
      flattenedDropSubfolderIdRef.current = id;
    } else {
      flattenedHighlightRef.current = null;
      flattenedDropSubfolderIdRef.current = null;
    }
  }, []);

  const clearFlattenedSubfolder = useCallback(() => {
    if (flattenedHighlightRef.current != null) {
      flattenedHighlightRef.current.removeAttribute(
        'data-item-flattened-subitem-drag-target'
      );
    }
    flattenedHighlightRef.current = null;
    flattenedDropSubfolderIdRef.current = null;
  }, []);

  const detectFlattenedSubfolderFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const treeEl = tree.getElement();
      const root = treeEl?.getRootNode() as Document | ShadowRoot;
      let el = (root ?? document).elementFromPoint(
        clientX,
        clientY
      ) as HTMLElement | null;
      if (el != null && el.nodeType === Node.TEXT_NODE) {
        el = el.parentElement;
      }
      const span = el?.closest?.(
        '[data-item-flattened-subitem]'
      ) as HTMLElement | null;
      const id = span?.getAttribute('data-item-flattened-subitem') ?? null;

      if (id === flattenedDropSubfolderIdRef.current) return;

      if (flattenedHighlightRef.current != null) {
        flattenedHighlightRef.current.removeAttribute(
          'data-item-flattened-subitem-drag-target'
        );
      }

      if (span != null && id != null) {
        span.setAttribute('data-item-flattened-subitem-drag-target', 'true');
        flattenedHighlightRef.current = span;
        flattenedDropSubfolderIdRef.current = id;
      } else {
        flattenedHighlightRef.current = null;
        flattenedDropSubfolderIdRef.current = null;
      }
    },
    // tree.getElement() is stable across renders
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Keep the previous idToPath so we can translate stale expanded IDs → paths
  // when files change (DnD or controlled update).
  const prevIdToPathRef = useRef<Map<string, string>>(idToPath);
  // DnD-only: pending drop target to auto-expand if/when the exact drop result
  // is applied to files.
  const pendingDropTargetExpandRef = useRef<{
    path: string;
    expectedFilesSignature: string;
  } | null>(null);

  const onDropHandler = useCallback(
    (
      items: ItemInstance<FileTreeNode>[],
      target: { item: ItemInstance<FileTreeNode> }
    ) => {
      const draggedPaths = items.map((item) => item.getItemData().path);
      let targetPath =
        target.item.getId() === 'root'
          ? 'root'
          : target.item.getItemData().path;

      if (flattenedDropSubfolderIdRef.current != null) {
        targetPath =
          idToPath.get(flattenedDropSubfolderIdRef.current) ?? targetPath;
        flattenedDropSubfolderIdRef.current = null;
      }

      const newFiles = computeNewFilesAfterDrop(
        filesRef.current,
        draggedPaths,
        targetPath,
        { onCollision }
      );

      // Store the drop target path (stripped of f:: prefix) so the migration
      // effect can expand it alongside the preserved expansion state, but only
      // if this exact file result is later applied.
      if (targetPath !== 'root') {
        pendingDropTargetExpandRef.current = {
          path: targetPath.startsWith(FLATTENED_PREFIX)
            ? targetPath.slice(FLATTENED_PREFIX.length)
            : targetPath,
          expectedFilesSignature: getFilesSignature(newFiles),
        };
      } else {
        pendingDropTargetExpandRef.current = null;
      }

      callbacksRef?.current._onDragMoveFiles?.(newFiles);
    },
    [callbacksRef, onCollision, idToPath]
  );

  // Track search state via ref so the canDrag callback (evaluated at event
  // time, not render time) always reads the latest value.
  const searchActiveRef = useRef(false);

  // Search config is read by fileTreeSearchFeature via getConfig().
  // via getConfig(). We spread it from a variable to bypass excess property
  // checks on the TreeConfig object literal.
  const searchModeConfig = { fileTreeSearchMode, search };
  const gitStatusConfig = {
    gitStatus,
    gitStatusSignature: getGitStatusSignature(gitStatus),
    gitStatusPathToId: pathToId,
  };
  const tree = useTree<FileTreeNode>({
    ...restTreeConfig,
    ...searchModeConfig,
    ...gitStatusConfig,
    rootItemId: 'root',
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const children = item.getItemData()?.children?.direct;
      return children != null;
    },
    hotkeys: {
      // Begin the hotkey name with "custom" to satisfy the type checker
      customExpandAll: {
        hotkey: 'KeyQ',
        handler: (_e, tree) => {
          void tree.expandAll();
        },
      },
      customCollapseAll: {
        hotkey: 'KeyW',
        handler: (_e, tree) => {
          void tree.collapseAll();
        },
      },
    },
    features,
    ...(isDnD && {
      canReorder: false,
      canDrag: (items: ItemInstance<FileTreeNode>[]) => {
        if (searchActiveRef.current) return false;
        if (lockedPaths == null || lockedPaths.length === 0) return true;
        const lockedSet = new Set(lockedPaths);
        for (const item of items) {
          const path = item.getItemData().path;
          if (path != null && lockedSet.has(getSelectionPath(path)))
            return false;
        }
        return true;
      },
      onDrop: onDropHandler,
      canDrop: (
        _items: ItemInstance<FileTreeNode>[],
        target: { item: ItemInstance<FileTreeNode> }
      ) => target.item.isFolder(),
      openOnDropDelay: 800,
      _onTouchDragMove: detectFlattenedSubfolderFromPoint,
      _onTouchDragEnd: clearFlattenedSubfolder,
    }),
  });

  const getAncestors = useCallback(
    (itemId: string): string[] => {
      const cache = ancestorChainsCacheRef.current;
      const resolve = (id: string): string[] => {
        const cached = cache.get(id);
        if (cached != null) return cached;

        const parentId = tree.getItemInstance(id).getItemMeta().parentId;
        if (parentId == null || parentId === 'root') {
          cache.set(id, EMPTY_ANCESTORS);
          return EMPTY_ANCESTORS;
        }

        const chain = [...resolve(parentId), parentId];
        cache.set(id, chain);
        return chain;
      };
      return resolve(itemId);
    },
    [tree]
  );

  searchActiveRef.current = (tree.getState().search?.length ?? 0) > 0;

  // --- Context menu ---
  const isContextMenuEnabled =
    callbacksRef != null
      ? callbacksRef.current.onContextMenuOpen != null
      : stateConfig?.onContextMenuOpen != null;
  const [contextMenuItemId, setContextMenuItemId] = useState<string | null>(
    null
  );
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    top: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoveredContextMenuItemRef = useRef<string | null>(null);
  // Ref mirror of contextMenuItemId — lets callbacks read the current value
  // without including it as a dependency, keeping their identities stable.
  const contextMenuItemIdRef = useRef<string | null>(null);
  contextMenuItemIdRef.current = contextMenuItemId;

  const closeContextMenu = useCallback(
    (notify = true) => {
      if (contextMenuItemIdRef.current == null) return;
      setContextMenuItemId(null);
      setContextMenuPosition(null);
      if (notify) {
        callbacksRef?.current.onContextMenuClose?.();
      }
    },
    [callbacksRef]
  );

  const updateTriggerPosition = useCallback(
    (itemEl: HTMLElement | null) => {
      const trigger = triggerRef.current;
      if (trigger == null) return;
      if (itemEl == null) {
        if (contextMenuItemIdRef.current == null)
          trigger.style.display = 'none';
        hoveredContextMenuItemRef.current = null;
        return;
      }
      const container = tree.getElement()?.closest('[role="tree"]');
      if (container == null) return;
      const itemRect = itemEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      trigger.style.top = `${itemRect.top - containerRect.top}px`;
      trigger.style.height = `${itemRect.height}px`;
      trigger.style.display = 'flex';
      trigger.dataset.itemId = itemEl.dataset.itemId ?? '';
      hoveredContextMenuItemRef.current = itemEl.dataset.itemId ?? null;
    },
    [tree]
  );

  const handleTriggerClick = useCallback(
    (e: MouseEvent) => {
      const openContextMenu = callbacksRef?.current.onContextMenuOpen;
      if (openContextMenu == null) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const trigger = triggerRef.current;
      const itemId = trigger?.dataset.itemId;
      if (itemId == null) return;

      if (contextMenuItemIdRef.current === itemId) {
        closeContextMenu();
        return;
      }

      // Open: store position from trigger's current style.top
      const top = parseFloat(trigger?.style.top ?? '0');
      const height = parseFloat(trigger?.style.height ?? '30');
      setContextMenuItemId(itemId);
      setContextMenuPosition({ top: top + height });
      const item = tree.getItemInstance(itemId);
      const data = item.getItemData();
      openContextMenu({
        path: getSelectionPath(data.path),
        isFolder: data.children?.direct != null,
      });
    },
    [callbacksRef, closeContextMenu, tree]
  );

  // Click-outside handler
  useEffect(() => {
    if (!isContextMenuEnabled || contextMenuItemId == null) return;
    const handleMouseDown = (e: MouseEvent) => {
      const path = e.composedPath();
      let isOnTriggerOrSlot = false;
      for (const el of path) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.dataset.type === CONTEXT_MENU_TRIGGER_TYPE) {
          isOnTriggerOrSlot = true;
          break;
        }
        if (el.getAttribute('slot') === CONTEXT_MENU_SLOT_NAME) {
          isOnTriggerOrSlot = true;
          break;
        }
      }
      if (!isOnTriggerOrSlot) {
        closeContextMenu();
      }
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () =>
      document.removeEventListener('mousedown', handleMouseDown, true);
  }, [closeContextMenu, contextMenuItemId, isContextMenuEnabled]);

  // Close on scroll
  useEffect(() => {
    if (!isContextMenuEnabled || contextMenuItemId == null) return;
    const container = tree.getElement()?.closest('[role="tree"]');
    const scrollParent = container?.closest(
      '[data-file-tree-virtualized-scroll]'
    );
    const target = scrollParent ?? container?.parentElement;
    if (target == null) return;
    const handleScroll = () => closeContextMenu();
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, [closeContextMenu, contextMenuItemId, isContextMenuEnabled, tree]);

  useEffect(() => {
    if (isContextMenuEnabled || contextMenuItemId == null) return;
    closeContextMenu();
  }, [closeContextMenu, contextMenuItemId, isContextMenuEnabled]);

  const prevContextMenuStructureRef = useRef({ files, idToPath });
  useEffect(() => {
    const previous = prevContextMenuStructureRef.current;
    prevContextMenuStructureRef.current = { files, idToPath };
    const structureChanged =
      previous.files !== files || previous.idToPath !== idToPath;
    if (
      !isContextMenuEnabled ||
      contextMenuItemId == null ||
      !structureChanged
    ) {
      return;
    }
    closeContextMenu();
  }, [
    closeContextMenu,
    contextMenuItemId,
    files,
    idToPath,
    isContextMenuEnabled,
  ]);

  // Focus-based trigger positioning
  const focusedItemId = tree.getState().focusedItem ?? null;
  const hasFocusedItem = focusedItemId != null;

  useEffect(() => {
    if (!isContextMenuEnabled || focusedItemId == null) return;
    const container = tree.getElement()?.closest('[role="tree"]');
    const itemEl = container?.querySelector(
      `[data-item-id="${focusedItemId}"]`
    ) as HTMLElement | null;
    updateTriggerPosition(itemEl);
  }, [focusedItemId, isContextMenuEnabled, updateTriggerPosition, tree]);

  // Detect stale expanded IDs when the file list changes. Flattened chains
  // may break or form, causing node IDs to change. We snapshot the expanded
  // paths using the OLD idToPath so the effect can re-map them to new IDs.
  // This covers both DnD drops and controlled file updates.
  const pendingExpandMigrationRef = useRef<string[] | null>(null);
  if (prevIdToPathRef.current !== idToPath) {
    const currentExpandedIds = tree.getState().expandedItems ?? [];
    const hasStaleIds = currentExpandedIds.some(
      (id: string) => !idToPath.has(id)
    );
    if (hasStaleIds) {
      const oldIdToPath = prevIdToPathRef.current;
      pendingExpandMigrationRef.current = currentExpandedIds
        .map((id: string) => oldIdToPath.get(id))
        .filter((p): p is string => p != null)
        .map((p: string) =>
          p.startsWith(FLATTENED_PREFIX) ? p.slice(FLATTENED_PREFIX.length) : p
        );
    }
  }
  prevIdToPathRef.current = idToPath;

  // Populate handleRef so the FileTree class can call tree methods directly
  useEffect(() => {
    if (handleRef == null) return;
    handleRef.current = {
      tree,
      pathToId,
      idToPath,
      closeContextMenu,
    };
    return () => {
      handleRef.current = null;
    };
  }, [closeContextMenu, tree, pathToId, idToPath, handleRef]);

  // --- Migrate expanded state after file list changes ---
  // When the file list changes (DnD drop or controlled update), flattened
  // chains may break or form, changing node IDs. This effect re-maps the
  // previously-expanded paths to new IDs and optionally expands a drop target
  // when the applied files match a pending drop result.
  useEffect(() => {
    const previousPaths = pendingExpandMigrationRef.current;
    const pendingDropTarget = pendingDropTargetExpandRef.current;
    const dropTarget =
      pendingDropTarget != null &&
      pendingDropTarget.expectedFilesSignature === getFilesSignature(files)
        ? pendingDropTarget.path
        : null;
    pendingExpandMigrationRef.current = null;
    pendingDropTargetExpandRef.current = null;

    if (previousPaths == null && dropTarget == null) return;

    const pathsToExpand = previousPaths != null ? [...previousPaths] : [];
    if (dropTarget != null) {
      pathsToExpand.push(dropTarget);
    }

    const expandIds = expandPathsWithAncestors(pathsToExpand, pathToId, {
      flattenEmptyDirectories,
    });

    if (previousPaths != null) {
      // Full replacement — re-map all expanded paths to new IDs.
      tree.applySubStateUpdate('expandedItems', () => expandIds);
    } else {
      // Just adding the drop target — merge with existing expanded state.
      const currentExpanded = tree.getState().expandedItems ?? [];
      const currentSet = new Set(currentExpanded);
      const newIds = expandIds.filter((id) => !currentSet.has(id));
      if (newIds.length === 0) return;
      tree.applySubStateUpdate('expandedItems', (prev) => [
        ...(prev ?? []),
        ...newIds,
      ]);
    }
    tree.rebuildTree();
  }, [files, pathToId, tree, flattenEmptyDirectories]);

  // --- Selection change callback ---
  const selectionSnapshotRef = useRef<string | null>(null);
  const selectionSnapshot = tree.getState().selectedItems?.join('|') ?? '';

  useEffect(() => {
    const onSelection = callbacksRef?.current.onSelection;
    if (onSelection == null) {
      return;
    }
    if (selectionSnapshotRef.current == null) {
      selectionSnapshotRef.current = selectionSnapshot;
      return;
    }
    if (selectionSnapshotRef.current === selectionSnapshot) {
      return;
    }

    selectionSnapshotRef.current = selectionSnapshot;
    const selection: FileTreeSelectionItem[] = tree
      .getSelectedItems()
      .map((item) => {
        const data = item.getItemData();
        return {
          path: getSelectionPath(data.path),
          isFolder: data.children?.direct != null,
        };
      });
    onSelection(selection);
  }, [selectionSnapshot, callbacksRef, tree]);

  // --- Expanded items change callback ---
  const expandedSnapshotRef = useRef<string | null>(null);
  const expandedSnapshot = tree.getState().expandedItems?.join('|') ?? '';

  useEffect(() => {
    const onExpandedItemsChange = callbacksRef?.current.onExpandedItemsChange;
    if (onExpandedItemsChange == null) {
      return;
    }
    if (expandedSnapshotRef.current == null) {
      expandedSnapshotRef.current = expandedSnapshot;
      return;
    }
    if (expandedSnapshotRef.current === expandedSnapshot) {
      return;
    }

    expandedSnapshotRef.current = expandedSnapshot;
    const ids = tree.getState().expandedItems ?? [];
    const paths = [
      ...new Set(
        ids
          .map((id) => idToPath.get(id))
          .filter((path): path is string => path != null)
          .map(getSelectionPath)
      ),
    ];
    const effectivePaths = filterOrphanedPaths(
      paths,
      pathToId,
      flattenEmptyDirectories
    );
    onExpandedItemsChange(effectivePaths);
  }, [
    expandedSnapshot,
    callbacksRef,
    tree,
    idToPath,
    pathToId,
    flattenEmptyDirectories,
  ]);

  // --- Selected items change callback ---
  const selectedSnapshotRef = useRef<string | null>(null);
  const selectedSnapshot = tree.getState().selectedItems?.join('|') ?? '';

  useEffect(() => {
    const onSelectedItemsChange = callbacksRef?.current.onSelectedItemsChange;
    if (onSelectedItemsChange == null) {
      return;
    }
    if (selectedSnapshotRef.current == null) {
      selectedSnapshotRef.current = selectedSnapshot;
      return;
    }
    if (selectedSnapshotRef.current === selectedSnapshot) {
      return;
    }

    selectedSnapshotRef.current = selectedSnapshot;
    const ids = tree.getState().selectedItems ?? [];
    const paths = ids
      .map((id) => idToPath.get(id))
      .filter((path): path is string => path != null)
      .map(getSelectionPath);
    onSelectedItemsChange(paths);
  }, [selectedSnapshot, callbacksRef, tree, idToPath]);

  // When tree mounts with initial search in state, run setSearch once so expand/collapse filter is applied.
  // useLayoutEffect ensures this runs before paint so the first frame shows the correct expansion.
  useLayoutEffect(() => {
    const search = tree.getState().search;
    if (search != null && search.length > 0) {
      tree.setSearch(search);
    }
  }, [tree]);

  const { onChange, ...origSearchInputProps } =
    tree.getSearchInputElementProps();
  const shouldRenderSearchInput = search === true;
  const isSearchOpen = tree.isSearchOpen?.() ?? false;
  const activeDescendantId =
    isSearchOpen && focusedItemId != null
      ? getItemDomId(focusedItemId)
      : undefined;
  const searchInputProps = {
    ...origSearchInputProps,
    ...(activeDescendantId != null && {
      'aria-activedescendant': activeDescendantId,
      'aria-controls': treeDomId,
    }),
    onInput: onChange,
  };
  // --- Dynamic guide-line highlighting for selected items ---
  const guideStyleText = useMemo(() => {
    const selectedIds = tree.getState().selectedItems ?? [];
    if (selectedIds.length === 0 && focusedItemId == null) return '';
    const parentIds = new Set<string>();
    const addParentId = (id: string) => {
      const parentId = tree.getItemInstance(id).getItemMeta().parentId;
      if (parentId != null && parentId !== 'root') {
        parentIds.add(parentId);
      }
    };

    for (const id of selectedIds) {
      addParentId(id);
    }
    if (focusedItemId != null) {
      addParentId(focusedItemId);
    }
    if (parentIds.size === 0) return '';
    const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const selectors = Array.from(parentIds)
      .map(
        (id) =>
          `[data-item-section="spacing-item"][data-ancestor-id="${escape(id)}"]`
      )
      .join(',\n');
    return `:is(${selectors}) { opacity: 1; }`;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSnapshot, focusedItemId, tree]);

  const shouldVirtualize = virtualize != null && virtualize !== false;
  const virtualizeThreshold = shouldVirtualize
    ? Math.max(0, virtualize.threshold)
    : Number.POSITIVE_INFINITY;
  const containerProps = tree.getContainerProps();

  return (
    <div
      {...containerProps}
      id={treeDomId}
      data-file-tree-virtualized-root={shouldVirtualize ? 'true' : undefined}
      onPointerOver={
        isContextMenuEnabled
          ? (e: PointerEvent) => {
              const target = e.target as HTMLElement;
              if (
                target.closest?.(
                  `[data-type="${CONTEXT_MENU_TRIGGER_TYPE}"]`
                ) != null
              ) {
                return;
              }
              const itemEl = target.closest?.('[data-type="item"]') ?? null;
              const itemId =
                itemEl instanceof HTMLElement
                  ? (itemEl.dataset.itemId ?? null)
                  : null;
              if (
                itemId != null &&
                hoveredContextMenuItemRef.current === itemId
              ) {
                return;
              }
              updateTriggerPosition(itemEl as HTMLElement | null);
            }
          : undefined
      }
      onPointerLeave={
        isContextMenuEnabled
          ? () => {
              if (
                contextMenuItemIdRef.current == null &&
                triggerRef.current != null
              ) {
                triggerRef.current.style.display = 'none';
              }
              hoveredContextMenuItemRef.current = null;
            }
          : undefined
      }
    >
      <style dangerouslySetInnerHTML={{ __html: guideStyleText }} />
      <slot name={HEADER_SLOT_NAME} data-type="header-slot" />
      {shouldRenderSearchInput ? (
        <div data-file-tree-search-container>
          <input
            placeholder="Search…"
            data-file-tree-search-input
            {...searchInputProps}
          />
        </div>
      ) : null}
      {(() => {
        const allItems = tree.getItems();
        const visibleIdSet = getSearchVisibleIdSet(tree);
        const gitStatusMap = getGitStatusMap(tree);
        const items =
          visibleIdSet != null
            ? allItems.filter((item) => visibleIdSet.has(item.getId()))
            : allItems;
        const lockedPathSet =
          lockedPaths != null && lockedPaths.length > 0
            ? new Set(lockedPaths)
            : null;

        const renderItemAtIndex = (index: number) => {
          const item = items[index];
          if (item == null) {
            return null;
          }
          const itemData = item.getItemData();
          const itemMeta = item.getItemMeta();
          const hasChildren = itemData?.children?.direct != null;
          const isExpanded = hasChildren && item.isExpanded();
          const itemName = item.getItemName();
          const level = itemMeta.level;
          const itemPath = itemData?.path;
          const isLocked =
            itemPath != null &&
            lockedPathSet?.has(getSelectionPath(itemPath)) === true;
          const isSelected = item.isSelected();
          const isFlattenedDirectory = itemData?.flattens != null;
          const isSearchMatch = item.isMatchingSearch();
          const isFocused = hasFocusedItem && item.isFocused();
          const isDragTarget = isDnD && item.isUnorderedDragTarget?.() === true;
          const isDragging =
            isDnD &&
            tree
              .getState()
              .dnd?.draggedItems?.some(
                (d: ItemInstance<FileTreeNode>) => d.getId() === item.getId()
              ) === true;
          const itemGitStatus = gitStatusMap?.statusById.get(item.getId());
          const itemContainsGitChange =
            hasChildren &&
            (gitStatusMap?.foldersWithChanges.has(item.getId()) ?? false);
          const ancestors = getAncestors(item.getId());

          return (
            <TreeItem
              key={item.getId()}
              item={item}
              tree={tree}
              itemId={item.getId()}
              hasChildren={hasChildren}
              isExpanded={isExpanded}
              itemName={itemName}
              level={level}
              isSelected={isSelected}
              isFocused={isFocused}
              isSearchMatch={isSearchMatch}
              isDragTarget={isDragTarget}
              isDragging={isDragging}
              isDnD={isDnD}
              isFlattenedDirectory={isFlattenedDirectory}
              isLocked={isLocked}
              gitStatus={itemGitStatus}
              containsGitChange={itemContainsGitChange ?? false}
              flattens={itemData?.flattens}
              idToPath={idToPath}
              ancestors={ancestors}
              treeDomId={treeDomId}
              remapIcon={remapIcon}
              detectFlattenedSubfolder={detectFlattenedSubfolder}
              clearFlattenedSubfolder={clearFlattenedSubfolder}
            />
          );
        };

        if (
          shouldVirtualize &&
          items.length > 0 &&
          items.length >= virtualizeThreshold
        ) {
          const focusedIndex =
            focusedItemId != null
              ? items.findIndex((item) => item.getId() === focusedItemId)
              : null;
          return (
            <div data-file-tree-virtualized-scroll="true">
              <VirtualizedList
                itemCount={items.length}
                renderItem={renderItemAtIndex}
                scrollToIndex={
                  focusedIndex != null && focusedIndex >= 0
                    ? focusedIndex
                    : null
                }
              />
            </div>
          );
        }

        return items.map((_, i) => renderItemAtIndex(i));
      })()}
      {isContextMenuEnabled ? (
        <>
          {/* Single floating trigger — positioned imperatively, not per-item */}
          <button
            ref={triggerRef}
            data-type={CONTEXT_MENU_TRIGGER_TYPE}
            tabIndex={-1}
            aria-label="Options"
            onMouseDown={(e: MouseEvent) => e.preventDefault()}
            onClick={handleTriggerClick}
            style={{ display: 'none' }}
          >
            Options
          </button>
          {contextMenuItemId != null && contextMenuPosition != null ? (
            <div
              data-type="context-menu-container"
              style={{
                position: 'absolute',
                top: `${contextMenuPosition.top}px`,
                right: 'var(--trees-item-margin-x)',
                zIndex: 10,
              }}
            >
              <slot name={CONTEXT_MENU_SLOT_NAME} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
