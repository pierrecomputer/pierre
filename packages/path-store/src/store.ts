import { PathStoreBuilder, preparePaths } from './builder';
import { parseInputPath, parseLookupPath } from './path';
import { getSegmentValue, internSegment } from './segments';
import { compareSegmentValues } from './sort';
import type {
  DirectoryChildIndex,
  NodeId,
  PathStoreCollisionStrategy,
  PathStoreCompareEntry,
  PathStoreConstructorOptions,
  PathStoreEvent,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreRemoveOptions,
  PathStoreSnapshot,
  PathStoreVisibleRow,
} from './types';
import { PATH_STORE_NODE_FLAG_EXPLICIT } from './types';
import { PATH_STORE_NODE_FLAG_REMOVED } from './types';
import { PATH_STORE_NODE_FLAG_ROOT } from './types';
import { PATH_STORE_NODE_KIND_DIRECTORY } from './types';
import { PATH_STORE_NODE_KIND_FILE } from './types';

interface TransactionFrame {
  readonly affectedAncestorIds: Set<NodeId>;
  readonly affectedNodeIds: Set<NodeId>;
  readonly events: PathStoreEvent[];
  readonly explicit: boolean;
}

interface MoveTarget {
  basename: string;
  existingNodeId: NodeId | null;
  parentId: NodeId;
}

function createUnimplementedError(methodName: string): Error {
  return new Error(`PathStore.${methodName}() is not implemented yet`);
}

function createTransactionFrame(explicit: boolean): TransactionFrame {
  return {
    affectedAncestorIds: new Set<NodeId>(),
    affectedNodeIds: new Set<NodeId>(),
    events: [],
    explicit,
  };
}

export class PathStore {
  readonly #snapshot: PathStoreSnapshot;
  readonly #listeners = new Map<string, Set<(event: PathStoreEvent) => void>>();
  readonly #transactionStack: TransactionFrame[] = [];
  #activeNodeCount: number;
  #pathCacheVersion = 0;

  public constructor(options: PathStoreConstructorOptions = {}) {
    const builder = PathStore.createBuilder(options);
    const inputPaths = options.paths ?? [];
    const preparedPaths =
      options.presorted === true
        ? [...inputPaths]
        : preparePaths(inputPaths, options);

    builder.appendPaths(preparedPaths);
    this.#snapshot = builder.finish();
    this.#activeNodeCount = this.#snapshot.nodes.length - 1;
  }

  public static createBuilder(
    options: Omit<PathStoreConstructorOptions, 'paths' | 'presorted'> = {}
  ): PathStoreBuilder {
    return new PathStoreBuilder(options);
  }

  public static preparePaths(
    paths: readonly string[],
    options: Omit<PathStoreConstructorOptions, 'paths' | 'presorted'> = {}
  ): string[] {
    return preparePaths(paths, options);
  }

  public list(path?: string): string[] {
    const nodeId = path == null ? this.#snapshot.rootId : this.findNodeId(path);
    if (nodeId == null) {
      return [];
    }

    return this.collectCanonicalEntries(nodeId);
  }

  public add(path: string): void {
    const event = this.addInternal(path);
    this.recordEvent(event);
  }

  public remove(path: string, options: PathStoreRemoveOptions = {}): void {
    const event = this.removeInternal(path, options);
    this.recordEvent(event);
  }

  public move(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions = {}
  ): void {
    const event = this.moveInternal(fromPath, toPath, options);
    if (event != null) {
      this.recordEvent(event);
    }
  }

  public batch(
    operations: readonly PathStoreOperation[] | ((store: PathStore) => void)
  ): void {
    this.withExplicitTransaction(() => {
      if (typeof operations === 'function') {
        operations(this);
        return;
      }

      for (const operation of operations) {
        switch (operation.type) {
          case 'add':
            this.add(operation.path);
            break;
          case 'remove':
            this.remove(operation.path, { recursive: operation.recursive });
            break;
          case 'move':
            this.move(operation.from, operation.to, {
              collision: operation.collision,
            });
            break;
        }
      }
    });
  }

  public getVisibleCount(): number {
    throw createUnimplementedError('getVisibleCount');
  }

  public getVisibleSlice(
    _start: number,
    _end: number
  ): readonly PathStoreVisibleRow[] {
    throw createUnimplementedError('getVisibleSlice');
  }

  public expand(_path: string): void {
    throw createUnimplementedError('expand');
  }

  public collapse(_path: string): void {
    throw createUnimplementedError('collapse');
  }

  public on(
    type: string,
    handler: (event: PathStoreEvent) => void
  ): () => void {
    const existingListeners = this.#listeners.get(type);
    if (existingListeners != null) {
      existingListeners.add(handler);
    } else {
      this.#listeners.set(type, new Set([handler]));
    }

    return () => {
      const listeners = this.#listeners.get(type);
      if (listeners == null) {
        return;
      }

      listeners.delete(handler);
      if (listeners.size === 0) {
        this.#listeners.delete(type);
      }
    };
  }

  public cleanup(): void {}

  public getNodeCount(): number {
    return this.#activeNodeCount;
  }

  // Materializes canonical full paths only for the nodes the caller touches,
  // which keeps subtree moves cheap while later phases build better invalidation.
  private materializeNodePath(nodeId: NodeId): string {
    const node = this.requireNode(nodeId);

    if (
      node.pathCache != null &&
      node.pathCacheVersion === this.#pathCacheVersion
    ) {
      return node.pathCache;
    }

    if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
      node.pathCache = '';
      node.pathCacheVersion = this.#pathCacheVersion;
      return node.pathCache;
    }

    const parentPath = this.materializeNodePath(node.parentId);
    const nodeName = getSegmentValue(this.#snapshot.segmentTable, node.nameId);
    const path =
      parentPath.length === 0 ? nodeName : `${parentPath}${nodeName}`;
    node.pathCache =
      node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? `${path}/` : path;
    node.pathCacheVersion = this.#pathCacheVersion;
    return node.pathCache;
  }

  // Canonical list output intentionally only includes files and explicit empty
  // directories so the output can round-trip the same topology without bloating
  // the serialized path list with non-empty ancestor directories.
  private collectCanonicalEntries(nodeId: NodeId): string[] {
    const node = this.#snapshot.nodes[nodeId];
    if (
      node === undefined ||
      (node.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0
    ) {
      return [];
    }

    if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      return [this.materializeNodePath(nodeId)];
    }

    const directoryIndex = this.getDirectoryIndex(nodeId);
    if (directoryIndex.childIds.length === 0) {
      return (node.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0 &&
        (node.flags & PATH_STORE_NODE_FLAG_ROOT) === 0
        ? [this.materializeNodePath(nodeId)]
        : [];
    }

    const entries: string[] = [];
    for (const childId of directoryIndex.childIds) {
      entries.push(...this.collectCanonicalEntries(childId));
    }

    return entries;
  }

  private addInternal(path: string): PathStoreEvent {
    const preparedPath = parseInputPath(path);
    const parentSegments = preparedPath.isDirectory
      ? preparedPath.segments
      : preparedPath.segments.slice(0, -1);
    const { createdNodeIds, directoryId } =
      this.ensureDirectoryChain(parentSegments);

    const affectedNodeIds = new Set<NodeId>(createdNodeIds);
    let addedNodeId = directoryId;

    if (preparedPath.isDirectory) {
      const directoryNode = this.requireNode(directoryId);
      const wasExplicit =
        (directoryNode.flags & PATH_STORE_NODE_FLAG_EXPLICIT) !== 0;
      if (wasExplicit) {
        throw new Error(`Path already exists: "${path}"`);
      }

      directoryNode.flags |= PATH_STORE_NODE_FLAG_EXPLICIT;
      directoryNode.pathCache = path;
      directoryNode.pathCacheVersion = this.#pathCacheVersion;
      affectedNodeIds.add(directoryId);
    } else {
      addedNodeId = this.createFileNode(directoryId, preparedPath.basename);
      affectedNodeIds.add(addedNodeId);
    }

    this.recomputeCountsUpwardFrom(directoryId);
    const affectedAncestorIds = this.collectAncestorIds(addedNodeId);

    return {
      affectedAncestorIds,
      affectedNodeIds: [...affectedNodeIds],
      changeset: { path },
      operation: 'add',
    };
  }

  private removeInternal(
    path: string,
    options: PathStoreRemoveOptions
  ): PathStoreEvent {
    const nodeId = this.findNodeId(path);
    if (nodeId == null) {
      throw new Error(`Path does not exist: "${path}"`);
    }

    const node = this.requireNode(nodeId);
    if ((node.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
      throw new Error('The root node cannot be removed');
    }

    if (
      node.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      this.getDirectoryIndex(nodeId).childIds.length > 0 &&
      options.recursive !== true
    ) {
      throw new Error(
        `Cannot remove a non-empty directory without recursive: "${path}"`
      );
    }

    const parentId = node.parentId;
    const removedNodeIds = this.removeSubtree(nodeId);
    this.removeChildReference(parentId, nodeId, node.nameId);
    this.promoteEmptyAncestorsToExplicit(parentId);
    this.recomputeCountsUpwardFrom(parentId);

    return {
      affectedAncestorIds: this.collectAncestorIds(parentId),
      affectedNodeIds: removedNodeIds,
      changeset: { path, recursive: options.recursive === true },
      operation: 'remove',
    };
  }

  private moveInternal(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions
  ): PathStoreEvent | null {
    const sourceNodeId = this.findNodeId(fromPath);
    if (sourceNodeId == null) {
      throw new Error(`Source path does not exist: "${fromPath}"`);
    }

    const sourceNode = this.requireNode(sourceNodeId);
    if ((sourceNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0) {
      throw new Error('The root node cannot be moved');
    }

    const collision = options.collision ?? 'error';
    const moveTarget = this.resolveMoveTarget(sourceNodeId, toPath);
    const sourceName = getSegmentValue(
      this.#snapshot.segmentTable,
      sourceNode.nameId
    );
    const targetNameId = internSegment(
      this.#snapshot.segmentTable,
      moveTarget.basename
    );

    if (
      moveTarget.parentId === sourceNode.parentId &&
      sourceName === moveTarget.basename
    ) {
      return null;
    }

    if (
      sourceNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      this.isAncestor(sourceNodeId, moveTarget.parentId)
    ) {
      throw new Error('Cannot move a directory into one of its descendants');
    }

    const siblingCollisionId = this.getDirectoryIndex(
      moveTarget.parentId
    ).childIdByNameId.get(targetNameId);
    const collisionNodeId =
      moveTarget.existingNodeId ?? siblingCollisionId ?? null;

    if (collisionNodeId != null && collisionNodeId !== sourceNodeId) {
      const resolvedCollision = this.handleMoveCollision(
        collisionNodeId,
        collision,
        sourceNode.kind
      );
      if (resolvedCollision === 'skip') {
        return null;
      }
    }

    const previousParentId = sourceNode.parentId;
    const previousSubtreeSize = sourceNode.subtreeNodeCount;
    this.removeChildReference(
      previousParentId,
      sourceNodeId,
      sourceNode.nameId
    );

    sourceNode.parentId = moveTarget.parentId;
    sourceNode.nameId = targetNameId;
    sourceNode.pathCache = null;
    sourceNode.pathCacheVersion = -1;
    this.recomputeDepths(sourceNodeId);
    this.insertChildReference(moveTarget.parentId, sourceNodeId);
    this.promoteEmptyAncestorsToExplicit(previousParentId);
    this.#pathCacheVersion++;
    this.recomputeCountsUpwardFrom(previousParentId);
    if (moveTarget.parentId !== previousParentId) {
      this.recomputeCountsUpwardFrom(moveTarget.parentId);
    }

    const affectedAncestorIds = [
      ...new Set([
        ...this.collectAncestorIds(previousParentId),
        ...this.collectAncestorIds(moveTarget.parentId),
      ]),
    ];

    return {
      affectedAncestorIds,
      affectedNodeIds: [sourceNodeId],
      changeset: {
        from: fromPath,
        subtreeNodeCount: previousSubtreeSize,
        to: this.materializeNodePath(sourceNodeId),
      },
      operation: 'move',
    };
  }

  private withExplicitTransaction(run: () => void): void {
    const frame = createTransactionFrame(true);
    this.#transactionStack.push(frame);

    try {
      run();
    } catch (error) {
      this.finishExplicitTransaction(frame, false);
      throw error;
    }

    this.finishExplicitTransaction(frame, true);
  }

  private recordEvent(event: PathStoreEvent): void {
    const currentFrame =
      this.#transactionStack[this.#transactionStack.length - 1] ?? null;
    if (currentFrame == null) {
      this.emitEvent(event);
      return;
    }

    currentFrame.events.push(event);
    if (event.affectedNodeIds != null) {
      for (const nodeId of event.affectedNodeIds) {
        currentFrame.affectedNodeIds.add(nodeId);
      }
    }

    if (event.affectedAncestorIds != null) {
      for (const nodeId of event.affectedAncestorIds) {
        currentFrame.affectedAncestorIds.add(nodeId);
      }
    }
  }

  private createBatchEvent(frame: TransactionFrame): PathStoreEvent {
    return {
      affectedAncestorIds: [...frame.affectedAncestorIds],
      affectedNodeIds: [...frame.affectedNodeIds],
      changeset: { events: frame.events },
      operation: 'batch',
    };
  }

  private mergeFrameMetadata(
    target: TransactionFrame,
    source: TransactionFrame
  ): void {
    for (const nodeId of source.affectedAncestorIds) {
      target.affectedAncestorIds.add(nodeId);
    }

    for (const nodeId of source.affectedNodeIds) {
      target.affectedNodeIds.add(nodeId);
    }
  }

  private finishExplicitTransaction(
    frame: TransactionFrame,
    emit: boolean
  ): void {
    const poppedFrame = this.#transactionStack.pop();
    if (poppedFrame !== frame) {
      throw new Error('Transaction stack underflow');
    }

    if (!emit) {
      return;
    }

    const batchEvent = this.createBatchEvent(frame);
    const parentFrame =
      this.#transactionStack[this.#transactionStack.length - 1] ?? null;
    if (parentFrame != null) {
      parentFrame.events.push(batchEvent);
      this.mergeFrameMetadata(parentFrame, frame);
      return;
    }

    this.emitEvent(batchEvent);
  }

  private emitEvent(event: PathStoreEvent): void {
    const specificListeners = this.#listeners.get(event.operation);
    specificListeners?.forEach((handler) => handler(event));
    const wildcardListeners = this.#listeners.get('*');
    wildcardListeners?.forEach((handler) => handler(event));
  }

  private ensureDirectoryChain(directorySegments: readonly string[]): {
    createdNodeIds: NodeId[];
    directoryId: NodeId;
  } {
    const createdNodeIds: NodeId[] = [];
    let currentDirectoryId = this.#snapshot.rootId;

    for (const segment of directorySegments) {
      const segmentId = internSegment(this.#snapshot.segmentTable, segment);
      const currentIndex = this.getDirectoryIndex(currentDirectoryId);
      const existingChildId = currentIndex.childIdByNameId.get(segmentId);

      if (existingChildId !== undefined) {
        const existingChild = this.requireNode(existingChildId);
        if (existingChild.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
          throw new Error(
            `Cannot create a directory that collides with an existing file: "${segment}"`
          );
        }

        currentDirectoryId = existingChildId;
        continue;
      }

      currentDirectoryId = this.createDirectoryNode(
        currentDirectoryId,
        segmentId
      );
      createdNodeIds.push(currentDirectoryId);
    }

    return { createdNodeIds, directoryId: currentDirectoryId };
  }

  private createDirectoryNode(parentId: NodeId, nameId: number): NodeId {
    const parentNode = this.requireNode(parentId);
    const nodeId = this.#snapshot.nodes.length;
    const node = {
      childIndexRef: nodeId,
      depth: parentNode.depth + 1,
      flags: 0,
      id: nodeId,
      kind: PATH_STORE_NODE_KIND_DIRECTORY,
      nameId,
      parentId,
      pathCache: null,
      pathCacheVersion: -1,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    } as const;

    this.#snapshot.nodes.push(node);
    this.#snapshot.directories.set(nodeId, {
      childIds: [],
      childIdByNameId: new Map(),
    });
    this.insertChildReference(parentId, nodeId);
    this.#activeNodeCount++;
    return nodeId;
  }

  private createFileNode(parentId: NodeId, basename: string): NodeId {
    const nameId = internSegment(this.#snapshot.segmentTable, basename);
    const parentIndex = this.getDirectoryIndex(parentId);
    if (parentIndex.childIdByNameId.has(nameId)) {
      throw new Error(
        `Path already exists: "${this.buildPathPreview(parentId, basename)}"`
      );
    }

    const parentNode = this.requireNode(parentId);
    const nodeId = this.#snapshot.nodes.length;
    this.#snapshot.nodes.push({
      childIndexRef: null,
      depth: parentNode.depth + 1,
      flags: 0,
      id: nodeId,
      kind: PATH_STORE_NODE_KIND_FILE,
      nameId,
      parentId,
      pathCache: null,
      pathCacheVersion: -1,
      subtreeNodeCount: 1,
      visibleSubtreeCount: 1,
    });

    this.insertChildReference(parentId, nodeId);
    this.#activeNodeCount++;
    return nodeId;
  }

  private insertChildReference(parentId: NodeId, childId: NodeId): void {
    const parentIndex = this.getDirectoryIndex(parentId);
    const childNode = this.requireNode(childId);
    parentIndex.childIdByNameId.set(childNode.nameId, childId);

    let insertIndex = parentIndex.childIds.length;
    for (let index = 0; index < parentIndex.childIds.length; index++) {
      const existingChildId = parentIndex.childIds[index];
      const comparison = this.compareSiblingNodes(childId, existingChildId);
      if (comparison < 0) {
        insertIndex = index;
        break;
      }
    }

    parentIndex.childIds.splice(insertIndex, 0, childId);
  }

  private removeChildReference(
    parentId: NodeId,
    childId: NodeId,
    childNameId: number
  ): void {
    const parentIndex = this.getDirectoryIndex(parentId);
    parentIndex.childIdByNameId.delete(childNameId);

    const childIndex = parentIndex.childIds.indexOf(childId);
    if (childIndex >= 0) {
      parentIndex.childIds.splice(childIndex, 1);
    }
  }

  private compareSiblingNodes(leftId: NodeId, rightId: NodeId): number {
    const sortOption = this.#snapshot.options.sort;
    if (sortOption === 'default') {
      return this.compareSiblingNodesDefault(leftId, rightId);
    }

    const leftEntry = this.createCompareEntry(leftId);
    const rightEntry = this.createCompareEntry(rightId);
    return sortOption(leftEntry, rightEntry);
  }

  private compareSiblingNodesDefault(leftId: NodeId, rightId: NodeId): number {
    const leftNode = this.requireNode(leftId);
    const rightNode = this.requireNode(rightId);

    if (leftNode.kind !== rightNode.kind) {
      return leftNode.kind === PATH_STORE_NODE_KIND_DIRECTORY ? -1 : 1;
    }

    const leftName = getSegmentValue(
      this.#snapshot.segmentTable,
      leftNode.nameId
    );
    const rightName = getSegmentValue(
      this.#snapshot.segmentTable,
      rightNode.nameId
    );
    const comparison = compareSegmentValues(leftName, rightName);
    if (comparison !== 0) {
      return comparison;
    }

    return leftId < rightId ? -1 : 1;
  }

  private createCompareEntry(nodeId: NodeId): PathStoreCompareEntry {
    const node = this.requireNode(nodeId);
    const path = this.materializeNodePath(nodeId);
    const normalizedPath =
      node.kind === PATH_STORE_NODE_KIND_DIRECTORY ? path.slice(0, -1) : path;
    const segments =
      normalizedPath.length === 0 ? [] : normalizedPath.split('/');

    return {
      basename: getSegmentValue(this.#snapshot.segmentTable, node.nameId),
      depth: node.depth,
      isDirectory: node.kind === PATH_STORE_NODE_KIND_DIRECTORY,
      path,
      segments,
    };
  }

  private resolveMoveTarget(sourceNodeId: NodeId, toPath: string): MoveTarget {
    const sourceNode = this.requireNode(sourceNodeId);
    const existingDestinationId = this.findNodeId(toPath);
    if (existingDestinationId != null) {
      const existingDestination = this.requireNode(existingDestinationId);
      if (existingDestination.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
        return {
          basename: getSegmentValue(
            this.#snapshot.segmentTable,
            sourceNode.nameId
          ),
          existingNodeId: null,
          parentId: existingDestinationId,
        };
      }

      const destinationSegments = parseLookupPath(toPath).segments;
      const basename = destinationSegments[destinationSegments.length - 1];
      if (basename === undefined) {
        throw new Error(`Invalid destination path: "${toPath}"`);
      }

      return {
        basename,
        existingNodeId: existingDestinationId,
        parentId: existingDestination.parentId,
      };
    }

    const destinationLookup = parseLookupPath(toPath);
    const basename =
      destinationLookup.segments[destinationLookup.segments.length - 1];
    if (basename === undefined) {
      throw new Error(`Invalid destination path: "${toPath}"`);
    }

    const parentSegments = destinationLookup.segments.slice(0, -1);
    const parentId =
      parentSegments.length === 0
        ? this.#snapshot.rootId
        : this.findNodeIdBySegments(parentSegments, true);
    if (parentId == null) {
      throw new Error(`Destination parent does not exist: "${toPath}"`);
    }

    return {
      basename,
      existingNodeId: null,
      parentId,
    };
  }

  private handleMoveCollision(
    collisionNodeId: NodeId,
    strategy: PathStoreCollisionStrategy,
    sourceKind: number
  ): 'handled' | 'skip' {
    if (strategy === 'skip') {
      return 'skip';
    }

    if (strategy === 'error') {
      throw new Error(
        `Destination already exists: "${this.materializeNodePath(collisionNodeId)}"`
      );
    }

    const collisionNode = this.requireNode(collisionNodeId);
    if (collisionNode.kind !== sourceKind) {
      throw new Error(
        'replace collision requires the same source and destination kinds'
      );
    }

    if (
      collisionNode.kind === PATH_STORE_NODE_KIND_DIRECTORY &&
      this.getDirectoryIndex(collisionNodeId).childIds.length > 0
    ) {
      throw new Error(
        'replace collision does not support non-empty directories'
      );
    }

    const collisionParentId = collisionNode.parentId;
    const collisionNameId = collisionNode.nameId;
    this.removeSubtree(collisionNodeId);
    this.removeChildReference(
      collisionParentId,
      collisionNodeId,
      collisionNameId
    );
    this.promoteEmptyAncestorsToExplicit(collisionParentId);
    this.recomputeCountsUpwardFrom(collisionParentId);
    return 'handled';
  }

  private removeSubtree(nodeId: NodeId): NodeId[] {
    const node = this.requireNode(nodeId);
    const removedNodeIds: NodeId[] = [];

    if (node.kind === PATH_STORE_NODE_KIND_DIRECTORY) {
      const directoryIndex = this.getDirectoryIndex(nodeId);
      for (const childId of [...directoryIndex.childIds]) {
        removedNodeIds.push(...this.removeSubtree(childId));
      }

      this.#snapshot.directories.delete(nodeId);
    }

    node.flags |= PATH_STORE_NODE_FLAG_REMOVED;
    node.pathCache = null;
    node.pathCacheVersion = -1;
    this.#activeNodeCount--;
    removedNodeIds.push(nodeId);
    return removedNodeIds;
  }

  private promoteEmptyAncestorsToExplicit(startDirectoryId: NodeId): void {
    let currentDirectoryId: NodeId | null = startDirectoryId;

    while (currentDirectoryId != null) {
      const currentNode = this.requireNode(currentDirectoryId);
      if (
        currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY ||
        (currentNode.flags & PATH_STORE_NODE_FLAG_ROOT) !== 0
      ) {
        return;
      }

      const currentIndex = this.getDirectoryIndex(currentDirectoryId);
      if (currentIndex.childIds.length > 0) {
        return;
      }

      currentNode.flags |= PATH_STORE_NODE_FLAG_EXPLICIT;
      currentDirectoryId =
        currentNode.parentId === currentDirectoryId
          ? null
          : currentNode.parentId;
    }
  }

  private recomputeCountsUpwardFrom(startNodeId: NodeId): void {
    let currentNodeId: NodeId | null = startNodeId;

    while (currentNodeId != null) {
      const currentNode = this.requireNode(currentNodeId);
      if (currentNode.kind === PATH_STORE_NODE_KIND_FILE) {
        currentNode.subtreeNodeCount = 1;
        currentNode.visibleSubtreeCount = 1;
      } else {
        const currentIndex = this.getDirectoryIndex(currentNodeId);
        let subtreeNodeCount = 1;
        for (const childId of currentIndex.childIds) {
          subtreeNodeCount += this.requireNode(childId).subtreeNodeCount;
        }

        currentNode.subtreeNodeCount = subtreeNodeCount;
        currentNode.visibleSubtreeCount = subtreeNodeCount;
      }

      if (currentNodeId === this.#snapshot.rootId) {
        return;
      }

      currentNodeId = currentNode.parentId;
    }
  }

  private recomputeDepths(nodeId: NodeId): void {
    const node = this.requireNode(nodeId);
    const parentDepth =
      nodeId === this.#snapshot.rootId
        ? -1
        : this.requireNode(node.parentId).depth;
    node.depth = parentDepth + 1;

    if (node.kind !== PATH_STORE_NODE_KIND_DIRECTORY) {
      return;
    }

    const directoryIndex = this.getDirectoryIndex(nodeId);
    for (const childId of directoryIndex.childIds) {
      this.recomputeDepths(childId);
    }
  }

  private collectAncestorIds(nodeId: NodeId): NodeId[] {
    const ancestorIds: NodeId[] = [];
    let currentNodeId: NodeId | null = nodeId;

    while (currentNodeId != null) {
      const currentNode = this.requireNode(currentNodeId);
      ancestorIds.push(currentNodeId);
      if (currentNodeId === this.#snapshot.rootId) {
        break;
      }

      currentNodeId = currentNode.parentId;
    }

    return ancestorIds;
  }

  private isAncestor(ancestorNodeId: NodeId, nodeId: NodeId): boolean {
    let currentNodeId: NodeId | null = nodeId;

    while (currentNodeId != null) {
      if (currentNodeId === ancestorNodeId) {
        return true;
      }

      const currentNode = this.requireNode(currentNodeId);
      if (currentNodeId === this.#snapshot.rootId) {
        return false;
      }

      currentNodeId = currentNode.parentId;
    }

    return false;
  }

  private buildPathPreview(parentId: NodeId, basename: string): string {
    const parentPath = this.materializeNodePath(parentId);
    return parentPath.length === 0 ? basename : `${parentPath}${basename}`;
  }

  private findNodeId(path: string): NodeId | null {
    if (path.length === 0) {
      return this.#snapshot.rootId;
    }

    const lookupPath = parseLookupPath(path);
    const nodeId = this.findNodeIdBySegments(
      lookupPath.segments,
      lookupPath.requiresDirectory
    );
    if (nodeId == null) {
      return null;
    }

    return nodeId;
  }

  private findNodeIdBySegments(
    segments: readonly string[],
    requireDirectory: boolean
  ): NodeId | null {
    let currentNodeId = this.#snapshot.rootId;

    for (const segment of segments) {
      const segmentId = this.#snapshot.segmentTable.idByValue.get(segment);
      if (segmentId === undefined) {
        return null;
      }

      const currentIndex = this.getDirectoryIndex(currentNodeId);
      const nextNodeId = currentIndex.childIdByNameId.get(segmentId);
      if (nextNodeId === undefined) {
        return null;
      }

      currentNodeId = nextNodeId;
    }

    const currentNode = this.requireNode(currentNodeId);
    if (
      requireDirectory &&
      currentNode.kind !== PATH_STORE_NODE_KIND_DIRECTORY
    ) {
      return null;
    }

    return currentNodeId;
  }

  private getDirectoryIndex(directoryId: NodeId): DirectoryChildIndex {
    const directoryIndex = this.#snapshot.directories.get(directoryId);
    if (directoryIndex === undefined) {
      throw new Error(
        `Unknown directory child index for node ${String(directoryId)}`
      );
    }

    return directoryIndex;
  }

  private requireNode(nodeId: NodeId) {
    const node = this.#snapshot.nodes[nodeId];
    if (
      node === undefined ||
      (node.flags & PATH_STORE_NODE_FLAG_REMOVED) !== 0
    ) {
      throw new Error(`Unknown node ID: ${String(nodeId)}`);
    }

    return node;
  }
}
