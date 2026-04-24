// Converts PathStore mutation events into FileTree's narrower public mutation surface.
// Only exported functions form this module's cross-file contract; unexported helpers
// are private mapping steps.
import type { PathStoreEvent } from '@pierre/path-store';

import type {
  FileTreeBatchEvent,
  FileTreeMutationEvent,
  FileTreeMutationSemanticEvent,
} from './publicTypes';

export function isPathMutationEvent(
  event: PathStoreEvent
): event is Extract<
  PathStoreEvent,
  { operation: 'add' | 'remove' | 'move' | 'batch' }
> {
  return (
    event.operation === 'add' ||
    event.operation === 'remove' ||
    event.operation === 'move' ||
    event.operation === 'batch'
  );
}

// Applies a directory/file move to a tracked public path so focus/selection can
// follow moved items instead of falling back as if they were deleted.
function remapMovedPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  const descendantPrefix = fromPath.endsWith('/') ? fromPath : `${fromPath}/`;
  if (!path.startsWith(descendantPrefix)) {
    return path;
  }

  const targetPrefix = toPath.endsWith('/') ? toPath : `${toPath}/`;
  return `${targetPrefix}${path.slice(descendantPrefix.length)}`;
}

// Determines whether a tracked public path disappeared because a remove event
// deleted that exact item or a whole removed directory subtree.
function isPathRemoved(path: string, removedPath: string): boolean {
  if (path === removedPath) {
    return true;
  }

  const descendantPrefix = removedPath.endsWith('/')
    ? removedPath
    : `${removedPath}/`;
  return path.startsWith(descendantPrefix);
}

// Rewrites focus/selection paths through mutation events so controller state
// stays aligned with the mutated topology before the next projection rebuild.
export function remapPathThroughMutation(
  path: string | null,
  event: PathStoreEvent,
  preserveRemovedPath: boolean = false
): string | null {
  if (path == null) {
    return null;
  }

  switch (event.operation) {
    case 'add':
    case 'expand':
    case 'collapse':
    case 'mark-directory-unloaded':
    case 'begin-child-load':
    case 'apply-child-patch':
    case 'complete-child-load':
    case 'fail-child-load':
    case 'cleanup':
      return path;
    case 'remove':
      return isPathRemoved(path, event.path)
        ? preserveRemovedPath
          ? path
          : null
        : path;
    case 'move':
      return remapMovedPath(path, event.from, event.to);
    case 'batch': {
      let nextPath: string | null = path;
      for (const childEvent of event.events) {
        nextPath = remapPathThroughMutation(
          nextPath,
          childEvent,
          preserveRemovedPath
        );
        if (nextPath == null) {
          return null;
        }
      }
      return nextPath;
    }
  }
}

function createMutationInvalidation(event: PathStoreEvent): {
  canonicalChanged: boolean;
  projectionChanged: boolean;
  visibleCountDelta: number | null;
} {
  return {
    canonicalChanged: event.canonicalChanged,
    projectionChanged: event.projectionChanged,
    visibleCountDelta: event.visibleCountDelta,
  };
}

function toTreesMutationSemanticEvent(
  event: Extract<PathStoreEvent, { operation: 'add' | 'remove' | 'move' }>
): FileTreeMutationSemanticEvent {
  switch (event.operation) {
    case 'add':
      return {
        ...createMutationInvalidation(event),
        operation: 'add',
        path: event.path,
      };
    case 'remove':
      return {
        ...createMutationInvalidation(event),
        operation: 'remove',
        path: event.path,
        recursive: event.recursive,
      };
    case 'move':
      return {
        ...createMutationInvalidation(event),
        from: event.from,
        operation: 'move',
        to: event.to,
      };
  }
}

function toTreesBatchEvent(
  event: Extract<PathStoreEvent, { operation: 'batch' }>
): FileTreeBatchEvent {
  return {
    ...createMutationInvalidation(event),
    events: event.events
      .filter(
        (
          childEvent
        ): childEvent is Extract<
          PathStoreEvent,
          { operation: 'add' | 'remove' | 'move' }
        > =>
          childEvent.operation === 'add' ||
          childEvent.operation === 'remove' ||
          childEvent.operation === 'move'
      )
      .map((childEvent) => toTreesMutationSemanticEvent(childEvent)),
    operation: 'batch',
  };
}

export function toTreesMutationEvent(
  event: PathStoreEvent
): FileTreeMutationEvent | null {
  switch (event.operation) {
    case 'add':
    case 'remove':
    case 'move':
      return toTreesMutationSemanticEvent(event);
    case 'batch':
      return toTreesBatchEvent(event);
    default:
      return null;
  }
}
