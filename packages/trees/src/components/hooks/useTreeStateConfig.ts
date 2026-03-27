import { useMemo } from 'preact/hooks';

import { FLATTENED_PREFIX } from '../../constants';
import type { TreeConfig } from '../../core/types/core';
import type { FileTreeStateConfig } from '../../FileTree';
import type { FileTreeNode } from '../../types';
import { controlledExpandedPathsToExpandedIds } from '../../utils/controlledExpandedState';
import { expandPathsWithAncestors } from '../../utils/expandPaths';

type TreeConfigStateSlice = Pick<
  TreeConfig<FileTreeNode>,
  'initialState' | 'state'
>;

export interface UseTreeStateConfigArgs {
  pathToId: Map<string, string>;
  stateConfig: FileTreeStateConfig | undefined;
  flattenEmptyDirectories: boolean | undefined;
}

/**
 * Maps the public path-based state config into the internal ID-based state that
 * headless-tree expects. This hook only derives top-level expanded/selected
 * state, so once those arrays are converted to IDs there is nothing left to
 * remap.
 */
export function useTreeStateConfig({
  pathToId,
  stateConfig,
  flattenEmptyDirectories,
}: UseTreeStateConfigArgs): TreeConfigStateSlice {
  'use no memo';
  return useMemo<TreeConfigStateSlice>(() => {
    // Maps a file path to its rendered node ID, preferring flattened IDs when
    // the tree is actually rendering flattened directories.
    const mapPathToId = (path: string): string | undefined => {
      if (path.startsWith(FLATTENED_PREFIX)) {
        return pathToId.get(path);
      }

      const shouldFlatten = flattenEmptyDirectories === true;
      if (shouldFlatten) {
        return pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path);
      }
      return pathToId.get(path);
    };

    const mapPathsToIds = (
      paths: string[] | undefined
    ): string[] | undefined => {
      if (paths == null) {
        return undefined;
      }

      const ids = paths
        .map(mapPathToId)
        .filter((id): id is string => id != null);
      return ids.length > 0 ? ids : [];
    };

    const topLevelInitialExpanded = stateConfig?.initialExpandedItems;
    const topLevelInitialSelected = stateConfig?.initialSelectedItems;
    const topLevelInitialSearch = stateConfig?.initialSearchQuery;
    const topLevelExpanded = stateConfig?.expandedItems;
    const topLevelSelected = stateConfig?.selectedItems;

    const topLevelInitialExpandedIds =
      topLevelInitialExpanded != null
        ? expandPathsWithAncestors(topLevelInitialExpanded, pathToId, {
            flattenEmptyDirectories,
          })
        : undefined;
    const topLevelInitialSelectedIds = mapPathsToIds(topLevelInitialSelected);
    const topLevelExpandedIds =
      topLevelExpanded != null
        ? controlledExpandedPathsToExpandedIds(topLevelExpanded, pathToId, {
            flattenEmptyDirectories,
          })
        : undefined;
    const topLevelSelectedIds = mapPathsToIds(topLevelSelected);

    const hasInitialState =
      topLevelInitialExpanded != null ||
      topLevelInitialSelected != null ||
      topLevelInitialSearch != null;
    const hasControlledState =
      topLevelExpanded != null || topLevelSelected != null;

    return {
      ...(hasInitialState && {
        initialState: {
          ...(topLevelInitialExpandedIds != null && {
            expandedItems: topLevelInitialExpandedIds,
          }),
          ...(topLevelInitialSelectedIds != null && {
            selectedItems: topLevelInitialSelectedIds,
          }),
          ...(topLevelInitialSearch != null && {
            search: topLevelInitialSearch,
          }),
        },
      }),
      ...(hasControlledState && {
        state: {
          ...(topLevelExpandedIds != null && {
            expandedItems: topLevelExpandedIds,
          }),
          ...(topLevelSelectedIds != null && {
            selectedItems: topLevelSelectedIds,
          }),
        },
      }),
    };
  }, [pathToId, stateConfig, flattenEmptyDirectories]);
}
