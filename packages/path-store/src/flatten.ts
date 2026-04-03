import type { NodeId } from './internal-types';
import { PATH_STORE_NODE_FLAG_ROOT } from './internal-types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './internal-types';
import { isDirectoryExpanded } from './state';
import type { PathStoreState } from './state';

export function getFlattenedChildDirectoryId(
  state: PathStoreState,
  directoryNodeId: NodeId
): NodeId | null {
  if (state.snapshot.options.flattenEmptyDirectories !== true) {
    return null;
  }

  const directoryNode = state.snapshot.nodes[directoryNodeId];
  if (
    directoryNode == null ||
    directoryNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
    (directoryNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0 ||
    !isDirectoryExpanded(state, directoryNodeId, directoryNode)
  ) {
    return null;
  }

  const directoryIndex = state.snapshot.directories.get(directoryNodeId);
  if (directoryIndex == null || directoryIndex.childIds.length !== 1) {
    return null;
  }

  const childId = directoryIndex.childIds[0];
  if (childId == null) {
    return null;
  }

  const childNode = state.snapshot.nodes[childId];
  if (childNode == null || childNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
    return null;
  }

  return childId;
}

export function getFlattenedTerminalDirectoryId(
  state: PathStoreState,
  directoryNodeId: NodeId
): NodeId {
  let currentDirectoryId = directoryNodeId;

  while (true) {
    const nextDirectoryId = getFlattenedChildDirectoryId(
      state,
      currentDirectoryId
    );
    if (nextDirectoryId == null) {
      return currentDirectoryId;
    }

    currentDirectoryId = nextDirectoryId;
  }
}

export function collectFlattenedDirectoryChainIds(
  state: PathStoreState,
  directoryNodeId: NodeId
): NodeId[] {
  const chainIds = [directoryNodeId];
  let currentDirectoryId = directoryNodeId;

  while (true) {
    const nextDirectoryId = getFlattenedChildDirectoryId(
      state,
      currentDirectoryId
    );
    if (nextDirectoryId == null) {
      return chainIds;
    }

    chainIds.push(nextDirectoryId);
    currentDirectoryId = nextDirectoryId;
  }
}
