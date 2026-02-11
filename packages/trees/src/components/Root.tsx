import {
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type TreeInstance,
} from '@headless-tree/core';
import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';

import { FLATTENED_PREFIX } from '../constants';
import { fileTreeSearchFeature } from '../features/fileTreeSearchFeature';
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
  const { config, files, flattenEmptyDirectories, useLazyDataLoader } =
    fileTreeOptions;

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

    // --- Map top-level state props into config ---
    const baseConfig = config ?? {};

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

    // Merge top-level defaultExpandedItems/defaultSelectedItems into config.initialState
    const topLevelInitialExpanded = stateConfig?.defaultExpandedItems;
    const topLevelInitialSelected = stateConfig?.defaultSelectedItems;
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
  }, [config, treeData, pathToId, stateConfig, flattenEmptyDirectories]);
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

  const tree = useTree<FileTreeNode>({
    ...restTreeConfig,
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
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      fileTreeSearchFeature,
      expandAllFeature,
    ],
  });

  // Populate handleRef so the FileTree class can call tree methods directly
  useEffect(() => {
    if (handleRef == null) return;
    handleRef.current = { tree, pathToId, idToPath };
    return () => {
      handleRef.current = null;
    };
  }, [tree, pathToId, idToPath, handleRef]);

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
      {tree.getItems().map((item) => {
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
        return (
          <button
            data-type="item"
            data-item-type={hasChildren ? 'folder' : 'file'}
            {...selectionProps}
            {...searchMatchProps}
            {...focusedProps}
            data-item-id={item.getId()}
            id={getItemDomId(item.getId())}
            {...item.getProps()}
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
