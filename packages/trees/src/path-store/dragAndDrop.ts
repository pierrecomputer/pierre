import type { PathStoreOperation } from '@pierre/path-store';

import type {
  PathStoreTreesDropContext,
  PathStoreTreesDropResult,
  PathStoreTreesDropTarget,
  PathStoreTreesPublicId,
} from './types';

export interface PathStoreTreesDragSession {
  draggedPaths: readonly PathStoreTreesPublicId[];
  primaryPath: PathStoreTreesPublicId;
  target: PathStoreTreesDropTarget | null;
}

function isCanonicalDirectoryPath(path: string): boolean {
  return path.endsWith('/');
}

function getPathBasename(path: string): string {
  const trimmedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlashIndex = trimmedPath.lastIndexOf('/');
  const basename =
    lastSlashIndex < 0 ? trimmedPath : trimmedPath.slice(lastSlashIndex + 1);
  return path.endsWith('/') ? `${basename}/` : basename;
}

// Multi-select drags should move each subtree once, even when callers selected
// both a folder and descendants inside that same folder.
export function normalizeDraggedPaths(
  paths: readonly PathStoreTreesPublicId[]
): readonly PathStoreTreesPublicId[] {
  const uniquePaths: PathStoreTreesPublicId[] = [];
  const seenPaths = new Set<PathStoreTreesPublicId>();
  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    uniquePaths.push(path);
  }

  const keptPaths = new Set<PathStoreTreesPublicId>();
  for (const path of uniquePaths.toSorted((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length;
    }

    return left.localeCompare(right);
  })) {
    const trimmedPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const segments = trimmedPath.split('/');
    let hasSelectedAncestor = false;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const ancestorPath = `${segments.slice(0, index + 1).join('/')}/`;
      if (!keptPaths.has(ancestorPath)) {
        continue;
      }

      hasSelectedAncestor = true;
      break;
    }

    if (hasSelectedAncestor) {
      continue;
    }

    keptPaths.add(path);
  }

  return uniquePaths.filter((path) => keptPaths.has(path));
}

export function resolveDraggedPathsForStart(
  path: PathStoreTreesPublicId,
  selectedPaths: readonly PathStoreTreesPublicId[]
): readonly PathStoreTreesPublicId[] {
  return selectedPaths.includes(path)
    ? normalizeDraggedPaths(selectedPaths)
    : [path];
}

export function dropTargetsEqual(
  left: PathStoreTreesDropTarget | null,
  right: PathStoreTreesDropTarget | null
): boolean {
  if (left === right) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  return (
    left.kind === right.kind &&
    left.directoryPath === right.directoryPath &&
    left.flattenedSegmentPath === right.flattenedSegmentPath &&
    left.hoveredPath === right.hoveredPath
  );
}

export function createDropContext(
  draggedPaths: readonly PathStoreTreesPublicId[],
  target: PathStoreTreesDropTarget
): PathStoreTreesDropContext {
  return {
    draggedPaths,
    target,
  };
}

export function isSelfOrDescendantDrop(
  draggedPaths: readonly PathStoreTreesPublicId[],
  target: PathStoreTreesDropTarget
): boolean {
  if (target.kind !== 'directory' || target.directoryPath == null) {
    return false;
  }

  for (const draggedPath of draggedPaths) {
    if (!isCanonicalDirectoryPath(draggedPath)) {
      continue;
    }

    if (
      target.directoryPath === draggedPath ||
      target.directoryPath.startsWith(draggedPath)
    ) {
      return true;
    }
  }

  return false;
}

function resolveMoveDestinationPath(
  sourcePath: PathStoreTreesPublicId,
  target: PathStoreTreesDropTarget
): PathStoreTreesPublicId {
  if (target.kind === 'root' || target.directoryPath == null) {
    return getPathBasename(sourcePath);
  }

  return target.directoryPath;
}

export function buildDropOperations(
  draggedPaths: readonly PathStoreTreesPublicId[],
  target: PathStoreTreesDropTarget
): {
  operations: readonly PathStoreOperation[];
  result: PathStoreTreesDropResult;
} | null {
  const operations = draggedPaths
    .map((draggedPath) => {
      const destinationPath = resolveMoveDestinationPath(draggedPath, target);
      if (destinationPath === draggedPath) {
        return null;
      }

      // PathStore interprets `to: "dir/"` as "move into that directory using the
      // source basename", so drag/drop can stay path-based without recomputing the
      // full destination leaf path here.

      return {
        from: draggedPath,
        to: destinationPath,
        type: 'move',
      } satisfies PathStoreOperation;
    })
    .filter(
      (
        operation
      ): operation is Extract<PathStoreOperation, { type: 'move' }> => {
        return operation != null;
      }
    );

  if (operations.length === 0) {
    return null;
  }

  return {
    operations,
    result: {
      draggedPaths,
      operation: operations.length === 1 ? 'move' : 'batch',
      target,
    },
  };
}
