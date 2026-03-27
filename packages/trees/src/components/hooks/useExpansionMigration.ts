import { useEffect, useRef } from 'preact/hooks';

import { FLATTENED_PREFIX } from '../../constants';
import type { TreeInstance } from '../../core/types/core';
import type { FileTreeNode } from '../../types';
import { expandPathsWithAncestors } from '../../utils/expandPaths';
import { remapExpandedPathsForFolderRename } from '../../utils/renameFileTreePaths';

/** Produces a quick content hash of a file list for equality comparison. */
export const getFilesSignature = (files: string[]): string =>
  `${files.length}\0${files.join('\0')}`;

/**
 * Maps a file path to the rendered tree node ID, preferring flattened
 * IDs when the tree is configured to flatten empty directories.
 */
function resolvePathToRenderedId(
  path: string,
  pathToId: Map<string, string>,
  flattenEmptyDirectories: boolean
): string | null {
  if (path.startsWith(FLATTENED_PREFIX)) {
    return pathToId.get(path) ?? null;
  }
  if (flattenEmptyDirectories) {
    return pathToId.get(FLATTENED_PREFIX + path) ?? pathToId.get(path) ?? null;
  }
  return pathToId.get(path) ?? null;
}

export interface PendingDropTarget {
  path: string;
  expectedFilesSignature: string;
}

export interface PendingRenameExpandedRemap {
  sourcePath: string;
  destinationPath: string;
}

export interface PendingRenameFocusRestore {
  destinationPath: string;
  expectedFilesSignature: string;
}

export interface UseExpansionMigrationArgs {
  tree: TreeInstance<FileTreeNode>;
  files: string[];
  pathToId: Map<string, string>;
  idToPath: Pick<Map<string, string>, 'get' | 'has'>;
  flattenEmptyDirectories: boolean | undefined;
  pendingDropTargetExpandRef: { current: PendingDropTarget | null };
  pendingRenameExpandedRemapRef: {
    current: PendingRenameExpandedRemap | null;
  };
  pendingRenameFocusRestoreRef: {
    current: PendingRenameFocusRestore | null;
  };
}

/**
 * Tracks and migrates expanded-item state when the file list changes.
 *
 * When files are renamed or moved via D&D, flattened chains may break or
 * form, changing node IDs. This hook snapshots expanded paths using the
 * previous idToPath during render, then re-maps them to new IDs in an
 * effect. It also handles auto-expanding drop targets and restoring focus
 * after renames.
 *
 * The pending refs are owned by Root and shared with the onDrop/onRename
 * callbacks that write to them. This hook reads and clears them.
 */
export function useExpansionMigration({
  tree,
  files,
  pathToId,
  idToPath,
  flattenEmptyDirectories,
  pendingDropTargetExpandRef,
  pendingRenameExpandedRemapRef,
  pendingRenameFocusRestoreRef,
}: UseExpansionMigrationArgs): void {
  'use no memo';
  // Keep the previous idToPath so we can translate stale expanded IDs -> paths
  // when files change (DnD or controlled update).
  const prevIdToPathRef = useRef<Pick<Map<string, string>, 'get' | 'has'>>(
    idToPath
  );

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
      const pendingRename = pendingRenameExpandedRemapRef.current;
      if (pendingRename != null) {
        pendingExpandMigrationRef.current = remapExpandedPathsForFolderRename({
          expandedPaths: pendingExpandMigrationRef.current,
          sourcePath: pendingRename.sourcePath,
          destinationPath: pendingRename.destinationPath,
        });
      }
    }
  }
  prevIdToPathRef.current = idToPath;

  // Migrate expanded state after file list changes.
  // When the file list changes (DnD drop or controlled update), flattened
  // chains may break or form, changing node IDs. This effect re-maps the
  // previously-expanded paths to new IDs and optionally expands a drop target
  // when the applied files match a pending drop result.
  useEffect(() => {
    const filesSignature = getFilesSignature(files);
    const previousPaths = pendingExpandMigrationRef.current;
    const pendingDropTarget = pendingDropTargetExpandRef.current;
    const pendingRenameFocus = pendingRenameFocusRestoreRef.current;
    const dropTarget =
      pendingDropTarget != null &&
      pendingDropTarget.expectedFilesSignature === filesSignature
        ? pendingDropTarget.path
        : null;
    const renameFocusPath =
      pendingRenameFocus != null &&
      pendingRenameFocus.expectedFilesSignature === filesSignature
        ? pendingRenameFocus.destinationPath
        : null;
    pendingExpandMigrationRef.current = null;
    pendingDropTargetExpandRef.current = null;
    pendingRenameExpandedRemapRef.current = null;
    if (renameFocusPath != null) {
      pendingRenameFocusRestoreRef.current = null;
    }

    if (
      previousPaths == null &&
      dropTarget == null &&
      renameFocusPath == null
    ) {
      return;
    }

    if (previousPaths != null || dropTarget != null) {
      const pathsToExpand = previousPaths != null ? [...previousPaths] : [];
      if (dropTarget != null) {
        pathsToExpand.push(dropTarget);
      }

      const expandIds = expandPathsWithAncestors(pathsToExpand, pathToId, {
        flattenEmptyDirectories,
      });

      if (previousPaths != null) {
        // Full replacement -- re-map all expanded paths to new IDs.
        tree.applySubStateUpdate('expandedItems', () => expandIds);
      } else {
        // Just adding the drop target -- merge with existing expanded state.
        const currentExpanded = tree.getState().expandedItems ?? [];
        const currentSet = new Set(currentExpanded);
        const newIds = expandIds.filter((id) => !currentSet.has(id));
        if (newIds.length > 0) {
          tree.applySubStateUpdate('expandedItems', (prev) => [
            ...(prev ?? []),
            ...newIds,
          ]);
        }
      }
      tree.rebuildTree();
    }

    if (renameFocusPath != null) {
      const nextFocusedId = resolvePathToRenderedId(
        renameFocusPath,
        pathToId,
        flattenEmptyDirectories === true
      );
      if (nextFocusedId != null) {
        tree.applySubStateUpdate('focusedItem', nextFocusedId);
        tree.updateDomFocus();
      }
    }
  }, [
    files,
    pathToId,
    tree,
    flattenEmptyDirectories,
    pendingDropTargetExpandRef,
    pendingRenameExpandedRemapRef,
    pendingRenameFocusRestoreRef,
  ]);
}
