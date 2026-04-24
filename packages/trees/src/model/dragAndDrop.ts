import type {
  FileTreeBatchOperation,
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeDropTarget,
  FileTreePublicId,
} from './publicTypes';

export interface FileTreeDragSession {
  draggedPaths: readonly FileTreePublicId[];
  primaryPath: FileTreePublicId;
  target: FileTreeDropTarget | null;
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
  paths: readonly FileTreePublicId[]
): readonly FileTreePublicId[] {
  const uniquePaths: FileTreePublicId[] = [];
  const seenPaths = new Set<FileTreePublicId>();
  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    uniquePaths.push(path);
  }

  const keptPaths = new Set<FileTreePublicId>();
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
  path: FileTreePublicId,
  selectedPaths: readonly FileTreePublicId[]
): readonly FileTreePublicId[] {
  return selectedPaths.includes(path)
    ? normalizeDraggedPaths(selectedPaths)
    : [path];
}

export function dropTargetsEqual(
  left: FileTreeDropTarget | null,
  right: FileTreeDropTarget | null
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
  draggedPaths: readonly FileTreePublicId[],
  target: FileTreeDropTarget
): FileTreeDropContext {
  return {
    draggedPaths,
    target,
  };
}

export function isSelfOrDescendantDrop(
  draggedPaths: readonly FileTreePublicId[],
  target: FileTreeDropTarget
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
  sourcePath: FileTreePublicId,
  target: FileTreeDropTarget
): FileTreePublicId {
  if (target.kind === 'root' || target.directoryPath == null) {
    return getPathBasename(sourcePath);
  }

  return target.directoryPath;
}

export function buildDropOperations(
  draggedPaths: readonly FileTreePublicId[],
  target: FileTreeDropTarget
): {
  operations: readonly FileTreeBatchOperation[];
  result: FileTreeDropResult;
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
      } satisfies FileTreeBatchOperation;
    })
    .filter(
      (
        operation
      ): operation is Extract<FileTreeBatchOperation, { type: 'move' }> => {
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
