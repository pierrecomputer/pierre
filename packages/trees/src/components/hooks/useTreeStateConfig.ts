import { useMemo } from 'preact/hooks';

import { FLATTENED_PREFIX } from '../../constants';
import type { TreeConfig } from '../../core/types/core';
import type { FileTreeStateConfig } from '../../FileTree';
import type { FileTreeNode } from '../../types';
import { controlledExpandedPathsToExpandedIds } from '../../utils/controlledExpandedState';
import { expandPathsWithAncestors } from '../../utils/expandPaths';

type TreeStateConfig = {
  expandedItems?: string[];
  selectedItems?: string[];
  focusedItem?: string | null;
  renamingItem?: string | null;
  checkedItems?: string[];
  loadingCheckPropagationItems?: string[];
  [key: string]: unknown;
};
type TreeConfigStateSlice = Pick<
  TreeConfig<FileTreeNode>,
  'initialState' | 'state'
>;

export interface UseTreeStateConfigArgs {
  treeData: Record<string, FileTreeNode>;
  pathToId: Map<string, string>;
  stateConfig: FileTreeStateConfig | undefined;
  flattenEmptyDirectories: boolean | undefined;
}

/**
 * Assembles the tree's initial and controlled state by mapping external
 * path-based identifiers to the internal node IDs used by headless-tree.
 * Merges top-level initialExpandedItems/initialSelectedItems/initialSearchQuery
 * and controlled expandedItems/selectedItems from stateConfig.
 */
export function useTreeStateConfig({
  treeData,
  pathToId,
  stateConfig,
  flattenEmptyDirectories,
}: UseTreeStateConfigArgs): TreeConfigStateSlice {
  'use no memo';
  return useMemo<TreeConfigStateSlice>(() => {
    // Maps a single path-or-id reference to an internal tree node ID.
    const mapId = (item: string): string => {
      if (treeData[item] != null) {
        return item;
      }
      return pathToId.get(item) ?? item;
    };

    // Maps an array of path-or-id references, returning the original array
    // when nothing changed (for referential stability).
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

    // Maps all path-based state fields to their internal ID equivalents.
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

    const baseConfig: TreeConfigStateSlice = {};

    // Maps a file path to its rendered node ID, preferring flattened IDs
    // when the tree is rendering flattened directories.
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

    const configWithMergedState: TreeConfigStateSlice = {
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
}
