/** @jsxImportSource preact */
import type { JSX } from 'preact';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'preact/hooks';

import {
  CONTEXT_MENU_SLOT_NAME,
  CONTEXT_MENU_TRIGGER_TYPE,
  FLATTENED_PREFIX,
  HEADER_SLOT_NAME,
} from '../constants';
import type { ItemInstance, TreeInstance } from '../core/types/core';
import {
  contextMenuFeature,
  type ContextMenuRequest,
} from '../features/context-menu/feature';
import { dragAndDropFeature } from '../features/drag-and-drop/feature';
// import { expandAllFeature } from '../features/expand-all/feature';
import {
  getGitStatusMap,
  gitStatusFeature,
} from '../features/git-status/feature';
import { hotkeysCoreFeature } from '../features/hotkeys-core/feature';
import { keyboardDragAndDropFeature } from '../features/keyboard-drag-and-drop/feature';
import type { TreeDataRef } from '../features/main/types';
import { propMemoizationFeature } from '../features/prop-memoization/feature';
import { renamingFeature } from '../features/renaming/feature';
import {
  fileTreeSearchFeature,
  getSearchVisibleIdSet,
} from '../features/search/feature';
import { selectionFeature } from '../features/selection/feature';
import { syncDataLoaderFeature } from '../features/sync-data-loader/feature';
import {
  type FileTreeCallbacks,
  type FileTreeHandle,
  type FileTreeOptions,
  type FileTreeStateConfig,
  isRenamingEnabled,
} from '../FileTree';
import { generateLazyDataLoader } from '../loader/lazy';
import { generateSyncDataLoaderFromTreeData } from '../loader/sync';
import type { SVGSpriteNames } from '../sprite';
import type { FileTreeNode } from '../types';
import { computeNewFilesAfterDrop } from '../utils/computeNewFilesAfterDrop';
import { fileListToTree } from '../utils/fileListToTree';
import { getGitStatusSignature } from '../utils/getGitStatusSignature';
import { getSelectionPath } from '../utils/getSelectionPath';
import { renameFileTreePaths } from '../utils/renameFileTreePaths';
import type { ChildrenSortOption } from '../utils/sortChildren';
import { useContextMenuController } from './hooks/useContextMenuController';
import {
  getFilesSignature,
  type PendingDropTarget,
  type PendingRenameExpandedRemap,
  type PendingRenameFocusRestore,
  useExpansionMigration,
} from './hooks/useExpansionMigration';
import { useFlattenedDropTarget } from './hooks/useFlattenedDropTarget';
import { useStateChangeCallbacks } from './hooks/useStateChangeCallbacks';
import { useTree } from './hooks/useTree';
import { useTreeStateConfig } from './hooks/useTreeStateConfig';
import { Icon } from './Icon';
import { TreeItem } from './TreeItem';
import { VirtualizedList } from './VirtualizedList';

export interface FileTreeRootProps {
  fileTreeOptions: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  handleRef?: { current: FileTreeHandle | null };
  callbacksRef?: { current: FileTreeCallbacks };
  initialViewportHeight?: number | null;
}

const EMPTY_ANCESTORS: string[] = [];

// Reuses the last rebuild's visible ID list so virtualized rendering can size
// and slice the tree without forcing core to instantiate every visible item.
function getVisibleItemIds(tree: TreeInstance<FileTreeNode>): string[] {
  return (
    tree.getDataRef<TreeDataRef>().current.visibleItemIds ??
    tree.getItems().map((item) => item.getId())
  );
}

export function Root({
  fileTreeOptions,
  stateConfig,
  handleRef,
  callbacksRef,
  initialViewportHeight,
}: FileTreeRootProps): JSX.Element {
  'use no memo';
  const {
    initialFiles: files,
    flattenEmptyDirectories,
    fileTreeSearchMode,
    gitStatus,
    lockedPaths,
    onCollision,
    renaming,
    search,
    sort: sortOption,
    useLazyDataLoader,
    virtualize,
  } = fileTreeOptions;
  const renamingEnabled = isRenamingEnabled(renaming);
  const renamingConfig =
    renaming != null && renaming !== true && renaming !== false
      ? renaming
      : undefined;

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
  const lockedPathSet = useMemo(
    () =>
      lockedPaths != null && lockedPaths.length > 0
        ? new Set(lockedPaths)
        : null,
    [lockedPaths]
  );

  // Resolve sort option to a comparator (or undefined for default behavior).
  // `false` -> preserve insertion order and skip sort work.
  // `{ comparator }` -> custom comparator.
  // `true` / `undefined` -> undefined (use default).
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

  // Build the hot path->id map with a direct for-in scan and answer id->path
  // lookups straight from treeData so we do not duplicate the whole tree into a
  // second Map on every fresh mount.
  const pathToId = useMemo(() => {
    const next = new Map<string, string>();
    for (const id in treeData) {
      const node = treeData[id];
      if (node != null) {
        next.set(node.path, id);
      }
    }
    return next;
  }, [treeData]);
  const idToPath = useMemo<Pick<Map<string, string>, 'get' | 'has'>>(
    () => ({
      get: (id: string) => treeData[id]?.path,
      has: (id: string) => treeData[id] != null,
    }),
    [treeData]
  );

  const ancestorChainsCacheRef = useRef<Map<string, string[]>>(new Map());
  const prevIdToPathForCacheRef = useRef(idToPath);
  if (prevIdToPathForCacheRef.current !== idToPath) {
    prevIdToPathForCacheRef.current = idToPath;
    ancestorChainsCacheRef.current.clear();
  }

  const restTreeConfig = useTreeStateConfig({
    pathToId,
    stateConfig,
    flattenEmptyDirectories,
  });

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
  const isContextMenuEnabled =
    callbacksRef != null
      ? callbacksRef.current.onContextMenuOpen != null
      : stateConfig?.onContextMenuOpen != null;

  const features = useMemo(() => {
    const base = [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      // expandAllFeature,
      gitStatusFeature,
      contextMenuFeature,
    ];
    if (isDnD) {
      base.push(dragAndDropFeature, keyboardDragAndDropFeature);
    }
    if (renamingEnabled) {
      base.push(renamingFeature);
    }
    base.push(propMemoizationFeature);
    return base;
  }, [isDnD, renamingEnabled]);

  // Keep a ref to current files so onDrop doesn't capture stale values
  const filesRef = useRef(files);
  filesRef.current = files;

  // Ref populated after useTree — allows hooks called before useTree to
  // access the tree instance at event-handler time (not render time).
  const treeRef = useRef<TreeInstance<FileTreeNode> | null>(null);

  // --- Flattened sub-folder drop targeting ---
  const {
    flattenedDropSubfolderIdRef,
    detectFlattenedSubfolder,
    clearFlattenedSubfolder,
    detectFlattenedSubfolderFromPoint,
  } = useFlattenedDropTarget(treeRef);

  // Pending refs for expansion migration — owned here so both the
  // onDrop/onRename callbacks and the migration hook can access them.
  const pendingDropTargetExpandRef = useRef<PendingDropTarget | null>(null);
  const pendingRenameExpandedRemapRef =
    useRef<PendingRenameExpandedRemap | null>(null);
  const pendingRenameFocusRestoreRef = useRef<PendingRenameFocusRestore | null>(
    null
  );

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
    [callbacksRef, onCollision, idToPath, flattenedDropSubfolderIdRef]
  );

  // Track search state via ref so the canDrag callback (evaluated at event
  // time, not render time) always reads the latest value.
  const searchActiveRef = useRef(false);

  // Search config is read by fileTreeSearchFeature via getConfig().
  // We spread it from a variable to bypass excess property checks on the
  // TreeConfig object literal.
  const searchModeConfig = { fileTreeSearchMode, search };
  const gitStatusConfig = {
    gitStatus,
    gitStatusSignature: getGitStatusSignature(gitStatus),
    gitStatusPathToId: pathToId,
  };
  const contextMenuRequestHandlerRef = useRef<{
    (request: ContextMenuRequest): void;
  } | null>(null);
  const handleContextMenuFeatureRequest = useCallback(
    (request: ContextMenuRequest) => {
      contextMenuRequestHandlerRef.current?.(request);
    },
    []
  );
  const contextMenuFeatureConfig = {
    contextMenuEnabled: isContextMenuEnabled,
    onContextMenuRequest: handleContextMenuFeatureRequest,
  };

  const tree = useTree<FileTreeNode>({
    ...restTreeConfig,
    ...searchModeConfig,
    ...gitStatusConfig,
    ...contextMenuFeatureConfig,
    rootItemId: 'root',
    // TODO: consider if this ever makes sense to turn on for large trees
    // instanceBuilder: buildProxiedInstance,
    dataLoader,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const children = item.getItemData()?.children?.direct;
      return children != null;
    },
    hotkeys: {
      // Begin the hotkey name with "custom" to satisfy the type checker
      // customExpandAll: {
      //   hotkey: 'KeyQ',
      //   handler: (_e, tree) => {
      //     void tree.expandAll();
      //   },
      // },
      // customCollapseAll: {
      //   hotkey: 'KeyW',
      //   handler: (_e, tree) => {
      //     void tree.collapseAll();
      //   },
      // },
    },
    features,
    ...(renamingEnabled && {
      canRename: (item: ItemInstance<FileTreeNode>) => {
        const path = getSelectionPath(item.getItemData().path);
        if (lockedPathSet?.has(path) === true) {
          return false;
        }
        return (
          renamingConfig?.canRename?.({
            path,
            isFolder: item.getItemData().children?.direct != null,
          }) ?? true
        );
      },
      onRename: (item: ItemInstance<FileTreeNode>, nextBasename: string) => {
        const data = item.getItemData();
        const result = renameFileTreePaths({
          files: filesRef.current,
          path: getSelectionPath(data.path),
          isFolder: data.children?.direct != null,
          nextBasename,
        });
        if ('error' in result) {
          renamingConfig?.onError?.(result.error);
          return;
        }
        if (result.isFolder && result.sourcePath !== result.destinationPath) {
          pendingRenameExpandedRemapRef.current = {
            sourcePath: result.sourcePath,
            destinationPath: result.destinationPath,
          };
        } else {
          pendingRenameExpandedRemapRef.current = null;
        }
        if (result.sourcePath !== result.destinationPath) {
          pendingRenameFocusRestoreRef.current = {
            destinationPath: result.destinationPath,
            expectedFilesSignature: getFilesSignature(result.nextFiles),
          };
        } else {
          pendingRenameFocusRestoreRef.current = null;
        }
        if (result.sourcePath === result.destinationPath) {
          return;
        }
        renamingConfig?.onRename?.({
          sourcePath: result.sourcePath,
          destinationPath: result.destinationPath,
          isFolder: result.isFolder,
        });
        if (result.nextFiles !== filesRef.current) {
          callbacksRef?.current._onRenameFiles?.(result.nextFiles);
        }
      },
    }),
    ...(isDnD && {
      canReorder: false,
      canDrag: (items: ItemInstance<FileTreeNode>[]) => {
        if (searchActiveRef.current) return false;
        if (lockedPathSet == null) return true;
        for (const item of items) {
          const path = item.getItemData().path;
          if (path != null && lockedPathSet.has(getSelectionPath(path)))
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
  treeRef.current = tree;

  // --- Expansion migration ---
  useExpansionMigration({
    tree,
    files,
    pathToId,
    idToPath,
    flattenEmptyDirectories,
    pendingDropTargetExpandRef,
    pendingRenameExpandedRemapRef,
    pendingRenameFocusRestoreRef,
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

  const {
    isContextMenuOpen,
    contextMenuAnchorRef,
    triggerRef,
    closeContextMenu,
    openContextMenuForItem,
    handleTriggerClick,
    handleContextMenuKeyDown,
    handleTreeKeyDownCapture,
    handleTreePointerOver,
    handleTreePointerLeave,
    handleWashMouseDownCapture,
    handleWashWheelCapture,
    handleWashTouchMoveCapture,
  } = useContextMenuController({
    tree,
    isContextMenuEnabled,
    callbacksRef,
    files,
    idToPath,
  });
  contextMenuRequestHandlerRef.current = (request: ContextMenuRequest) => {
    openContextMenuForItem(request.itemId, request.anchorEl);
  };

  const focusedItemId = tree.getState().focusedItem ?? null;
  const hasFocusedItem = focusedItemId != null;

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

  const { selectionSnapshot } = useStateChangeCallbacks({
    tree,
    callbacksRef,
    idToPath,
    pathToId,
    flattenEmptyDirectories,
  });

  // When tree mounts with initial search in state, run setSearch once so
  // expand/collapse filter is applied. useLayoutEffect ensures this runs
  // before paint so the first frame shows the correct expansion.
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
      onKeyDownCapture={handleTreeKeyDownCapture}
      onPointerOver={isContextMenuEnabled ? handleTreePointerOver : undefined}
      onPointerLeave={isContextMenuEnabled ? handleTreePointerLeave : undefined}
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
        const visibleIdSet = getSearchVisibleIdSet(tree);
        const gitStatusMap = getGitStatusMap(tree);
        const allItemIds = getVisibleItemIds(tree);
        const itemIds =
          visibleIdSet != null
            ? allItemIds.filter((itemId) => visibleIdSet.has(itemId))
            : allItemIds;
        const draggedItemIdSet = isDnD
          ? new Set(
              (tree.getState().dnd?.draggedItems ?? []).map(
                (item: ItemInstance<FileTreeNode>) => item.getId()
              )
            )
          : null;

        const renderItemAtIndex = (index: number) => {
          const itemId = itemIds[index];
          if (itemId == null) {
            return null;
          }

          const item = tree.getItemInstance(itemId);
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
          const isRenaming = item.isRenaming?.() === true;
          const isDragging = draggedItemIdSet?.has(itemId) === true;
          const itemGitStatus = gitStatusMap?.statusById.get(itemId);
          const itemContainsGitChange =
            hasChildren &&
            (gitStatusMap?.foldersWithChanges.has(itemId) ?? false);
          const ancestors = getAncestors(itemId);

          return (
            <TreeItem
              key={itemId}
              item={item}
              tree={tree}
              itemId={itemId}
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
              isRenaming={isRenaming}
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

        const contextMenuTrigger = isContextMenuEnabled ? (
          <div
            ref={contextMenuAnchorRef}
            data-type="context-menu-anchor"
            data-visible="false"
            onKeyDown={handleContextMenuKeyDown}
          >
            <button
              ref={triggerRef}
              data-type={CONTEXT_MENU_TRIGGER_TYPE}
              tabIndex={-1}
              aria-label="Options"
              aria-haspopup="menu"
              onMouseDown={(e: MouseEvent) => e.preventDefault()}
              onClick={handleTriggerClick}
              data-visible="false"
            >
              <Icon {...remapIcon('file-tree-icon-ellipsis')} />
            </button>
            {isContextMenuOpen ? <slot name={CONTEXT_MENU_SLOT_NAME} /> : null}
          </div>
        ) : null;

        if (
          shouldVirtualize &&
          itemIds.length > 0 &&
          itemIds.length >= virtualizeThreshold
        ) {
          const focusedIndex =
            focusedItemId != null ? itemIds.indexOf(focusedItemId) : null;
          return (
            <div data-file-tree-virtualized-scroll="true">
              <VirtualizedList
                itemCount={itemIds.length}
                renderItem={renderItemAtIndex}
                scrollToIndex={
                  focusedIndex != null && focusedIndex >= 0
                    ? focusedIndex
                    : null
                }
                initialViewportHeight={initialViewportHeight}
              />
              {contextMenuTrigger}
            </div>
          );
        }

        return (
          <>
            {itemIds.map((_, i) => renderItemAtIndex(i))}
            {contextMenuTrigger}
          </>
        );
      })()}
      {isContextMenuOpen ? (
        <div
          data-type="context-menu-wash"
          aria-hidden="true"
          onMouseDownCapture={handleWashMouseDownCapture}
          onWheelCapture={handleWashWheelCapture}
          onTouchMoveCapture={handleWashTouchMoveCapture}
        />
      ) : null}
    </div>
  );
}
