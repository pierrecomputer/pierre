import { useEffect, useRef } from 'preact/hooks';

import type { TreeInstance } from '../../core/types/core';
import type { FileTreeCallbacks, FileTreeSelectionItem } from '../../FileTree';
import type { FileTreeNode } from '../../types';
import { filterOrphanedPaths } from '../../utils/expandPaths';
import { getSelectionPath } from '../../utils/getSelectionPath';

export interface UseStateChangeCallbacksArgs {
  tree: TreeInstance<FileTreeNode>;
  callbacksRef: { current: FileTreeCallbacks } | undefined;
  idToPath: Map<string, string>;
  pathToId: Map<string, string>;
  flattenEmptyDirectories: boolean | undefined;
}

/**
 * Watches tree selection and expansion state for changes and notifies
 * the parent via callbacksRef. Uses snapshot strings for change detection
 * to avoid firing on identical state. Returns the current selection
 * snapshot for use by other hooks (e.g. guide-line highlighting).
 */
export function useStateChangeCallbacks({
  tree,
  callbacksRef,
  idToPath,
  pathToId,
  flattenEmptyDirectories,
}: UseStateChangeCallbacksArgs): { selectionSnapshot: string } {
  'use no memo';
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

  return { selectionSnapshot };
}
