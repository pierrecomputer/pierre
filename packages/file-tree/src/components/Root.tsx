import {
  type TreeInstance,
  expandAllFeature,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import type { JSX } from 'preact';
import { Fragment } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { fileListToTree } from 'src/utils/fileListToTree';

import type { FileTreeOptions, FileTreeSelectionItem } from '../FileTree';
import { fileTreeSearchFeature } from '../features/fileTreeSearchFeature';
import { generateSyncDataLoader } from '../loader/sync';
import type { FileTreeNode } from '../types';
import { Icon } from './Icon';
import { useTree } from './hooks/useTree';

export interface FileTreeRootProps {
  fileTreeOptions: FileTreeOptions;
}

const FLATTENED_PREFIX = 'f::';

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

export function Root({ fileTreeOptions }: FileTreeRootProps): JSX.Element {
  'use no memo';
  const { config, files, flattenEmptyDirectories } = fileTreeOptions;
  const treeData = useMemo(() => fileListToTree(files), [files]);
  const restTreeConfig = useMemo(() => {
    if (config == null) {
      return {};
    }

    type TreeStateConfig = {
      expandedItems?: string[];
      selectedItems?: string[];
      focusedItem?: string | null;
      renamingItem?: string | null;
      checkedItems?: string[];
      loadingCheckPropagationItems?: string[];
      [key: string]: unknown;
    };

    const pathToId = new Map<string, string>();
    for (const [id, node] of Object.entries(treeData)) {
      pathToId.set(node.path, id);
    }

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

    const initialState = mapState(config.initialState as TreeStateConfig);
    const state = mapState(config.state as TreeStateConfig);

    if (!initialState.changed && !state.changed) {
      return config;
    }

    return {
      ...config,
      ...(initialState.state != null && { initialState: initialState.state }),
      ...(state.state != null && { state: state.state }),
    };
  }, [config, treeData]);
  const treeDomId = 'ft';
  const getItemDomId = (itemId: string) => `${treeDomId}-${itemId}`;
  const dataLoader = useMemo(
    () =>
      generateSyncDataLoader(treeData, {
        flattenEmptyDirectories,
      }),
    [treeData, flattenEmptyDirectories]
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

  const selectionSnapshotRef = useRef<string | null>(null);
  const selectionSnapshot = tree.getState().selectedItems?.join('|') ?? '';

  const onSelection = fileTreeOptions.onSelection;
  useEffect(() => {
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
  }, [selectionSnapshot, onSelection, tree]);

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
