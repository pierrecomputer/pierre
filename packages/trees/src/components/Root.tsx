import {
  dragAndDropFeature,
  expandAllFeature,
  hotkeysCoreFeature,
  type ItemInstance,
  keyboardDragAndDropFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeInstance,
} from '@headless-tree/core';
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';

import { FLATTENED_PREFIX } from '../constants';
import {
  fileTreeSearchFeature,
  getSearchVisibleIdSet,
} from '../features/fileTreeSearchFeature';
import type {
  FileTreeCallbacks,
  FileTreeHandle,
  FileTreeOptions,
  FileTreeSelectionItem,
  FileTreeStateConfig,
} from '../FileTree';
import { generateLazyDataLoader } from '../loader/lazy';
import { generateSyncDataLoader } from '../loader/sync';
import type { FileTreeNode } from '../types';
import { computeNewFilesAfterDrop } from '../utils/computeNewFilesAfterDrop';
import { controlledExpandedPathsToExpandedIds } from '../utils/controlledExpandedState';
import {
  expandPathsWithAncestors,
  filterOrphanedPaths,
} from '../utils/expandPaths';
import { fileListToTree } from '../utils/fileListToTree';
import { useTree } from './hooks/useTree';
import { Icon } from './Icon';

export interface FileTreeRootProps {
  fileTreeOptions: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  handleRef?: { current: FileTreeHandle | null };
  callbacksRef?: { current: FileTreeCallbacks };
}

const getSelectionPath = (path: string): string =>
  path.startsWith(FLATTENED_PREFIX)
    ? path.slice(FLATTENED_PREFIX.length)
    : path;

const getFilesSignature = (files: string[]): string =>
  `${files.length}\0${files.join('\0')}`;

function FlattenedDirectoryName({
  tree,
  flattens,
}: {
  tree: TreeInstance<FileTreeNode>;
  flattens: string[];
}): JSX.Element {
  'use no memo';
  const flattenedItems = useMemo(() => {
    return flattens.map((name) => tree.getItemInstance(name));
  }, [flattens, tree]);
  return (
    <span data-item-flattened-subitems>
      {flattenedItems.map((item, index) => {
        const isLast = index === flattenedItems.length - 1;

        return (
          <Fragment key={index}>
            <span data-item-flattened-subitem={item.getId()}>
              {item.getItemName()}
            </span>
            {!isLast ? '/' : ''}
          </Fragment>
        );
      })}
    </span>
  );
}

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
    onCollision,
    useLazyDataLoader,
  } = fileTreeOptions;

  const treeDomId = useMemo(() => {
    const base = fileTreeOptions.id ?? 'ft';
    const safe = base.replace(/[^A-Za-z0-9_-]/g, '_');
    return `ft-${safe}`;
  }, [fileTreeOptions.id]);
  const getItemDomId = (itemId: string) => `${treeDomId}-${itemId}`;

  const treeData = useMemo(() => fileListToTree(files), [files]);

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

    // Merge top-level initialExpandedItems/initialSelectedItems into config.initialState
    const topLevelInitialExpanded = stateConfig?.initialExpandedItems;
    const topLevelInitialSelected = stateConfig?.initialSelectedItems;
    const topLevelInitialExpandedIds =
      topLevelInitialExpanded != null
        ? expandPathsWithAncestors(topLevelInitialExpanded, pathToId, {
            flattenEmptyDirectories,
          })
        : undefined;
    const topLevelInitialSelectedIds = mapPathsToIds(topLevelInitialSelected);
    const hasTopLevelInitial =
      topLevelInitialExpanded != null || topLevelInitialSelected != null;

    const mergedInitialState = hasTopLevelInitial
      ? {
          ...(baseConfig.initialState as TreeStateConfig | undefined),
          ...(topLevelInitialExpandedIds != null && {
            expandedItems: topLevelInitialExpandedIds,
          }),
          ...(topLevelInitialSelectedIds != null && {
            selectedItems: topLevelInitialSelectedIds,
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
          })
        : generateSyncDataLoader(files, {
            flattenEmptyDirectories,
          }),
    [files, flattenEmptyDirectories, useLazyDataLoader]
  );

  const isDnD = fileTreeOptions.dragAndDrop === true;

  const features = useMemo(() => {
    const base = [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      expandAllFeature,
    ];
    if (isDnD) {
      base.push(dragAndDropFeature, keyboardDragAndDropFeature);
    }
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

  // fileTreeSearchMode is a custom config key read by fileTreeSearchFeature
  // via getConfig(). We spread it from a variable to bypass excess property
  // checks on the TreeConfig object literal.
  const searchModeConfig = { fileTreeSearchMode };
  const tree = useTree<FileTreeNode>({
    ...restTreeConfig,
    ...searchModeConfig,
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
      canDrag: () => !searchActiveRef.current,
      onDrop: onDropHandler,
      canDrop: (
        _items: ItemInstance<FileTreeNode>[],
        target: { item: ItemInstance<FileTreeNode> }
      ) => target.item.isFolder(),
      openOnDropDelay: 800,
    }),
  });

  searchActiveRef.current = (tree.getState().search?.length ?? 0) > 0;

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
    handleRef.current = { tree, pathToId, idToPath };
    return () => {
      handleRef.current = null;
    };
  }, [tree, pathToId, idToPath, handleRef]);

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

  const { onChange, ...origSearchInputProps } =
    tree.getSearchInputElementProps();
  const hasFocusedItem = tree.getState().focusedItem != null;
  const focusedItemId = hasFocusedItem ? tree.getState().focusedItem : null;
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
  return (
    <div {...tree.getContainerProps()} id={treeDomId}>
      <div data-file-tree-search-container>
        <input
          placeholder="Search…"
          data-file-tree-search-input
          {...searchInputProps}
        />
      </div>
      {(() => {
        const allItems = tree.getItems();
        const visibleIdSet = getSearchVisibleIdSet(tree);
        return visibleIdSet != null
          ? allItems.filter((item) => visibleIdSet.has(item.getId()))
          : allItems;
      })().map((item) => {
        const itemData = item.getItemData();
        const itemMeta = item.getItemMeta();
        // TODO: is it possible to have empty array as children? is this valid in that case?
        const hasChildren = itemData?.children?.direct != null;
        const itemName = item.getItemName();
        const level = itemMeta.level;
        const startWithCapital =
          itemName.charAt(0).toUpperCase() === itemName.charAt(0);
        const alignCapitals = startWithCapital;
        const isSelected = item.isSelected();
        const selectionProps = isSelected ? { 'data-item-selected': true } : {};

        const isFlattenedDirectory = itemData?.flattens != null;
        const isSearchMatch = item.isMatchingSearch();
        const isFocused = hasFocusedItem && item.isFocused();
        const focusedProps = isFocused ? { 'data-item-focused': true } : {};
        const searchMatchProps = isSearchMatch
          ? { 'data-item-search-match': true }
          : {};
        const isDragTarget = isDnD && item.isUnorderedDragTarget?.() === true;
        const isDragging =
          isDnD &&
          tree
            .getState()
            .dnd?.draggedItems?.some(
              (d: ItemInstance<FileTreeNode>) => d.getId() === item.getId()
            ) === true;
        const dragProps = isDnD
          ? {
              ...(isDragTarget && { 'data-item-drag-target': true }),
              ...(isDragging && { 'data-item-dragging': true }),
            }
          : {};
        const baseProps = item.getProps();
        const itemProps =
          isDnD && isFlattenedDirectory
            ? {
                ...baseProps,
                onDragOver: (e: DragEvent) => {
                  (
                    baseProps.onDragOver as ((e: DragEvent) => void) | undefined
                  )?.(e);
                  detectFlattenedSubfolder(e);
                },
                onDragLeave: (e: DragEvent) => {
                  clearFlattenedSubfolder();
                  (
                    baseProps.onDragLeave as
                      | ((e: DragEvent) => void)
                      | undefined
                  )?.(e);
                },
                onDrop: (e: DragEvent) => {
                  // Call headless-tree's handler first — it synchronously
                  // invokes onDropHandler where we read the subfolder ref.
                  (baseProps.onDrop as ((e: DragEvent) => void) | undefined)?.(
                    e
                  );
                  clearFlattenedSubfolder();
                },
              }
            : baseProps;

        return (
          <button
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            {...selectionProps}
            {...searchMatchProps}
            {...focusedProps}
            {...dragProps}
            data-item-id={item.getId()}
            id={getItemDomId(item.getId())}
            {...itemProps}
            key={item.getId()}
          >
            {level > 0 ? (
              <div data-item-section="spacing">
                {Array.from({ length: level }).map((_, index) => (
                  <div key={index} data-item-section="spacing-item" />
                ))}
              </div>
            ) : null}
            <div data-item-section="icon">
              {hasChildren ? (
                <Icon
                  name="file-tree-icon-chevron"
                  alignCapitals={alignCapitals}
                />
              ) : (
                <Icon name="file-tree-icon-file" />
              )}
            </div>
            <div data-item-section="content">
              {isFlattenedDirectory ? (
                <FlattenedDirectoryName
                  tree={tree}
                  flattens={itemData?.flattens ?? []}
                />
              ) : (
                itemName
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
