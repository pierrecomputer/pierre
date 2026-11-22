// Listener registry and batch transactions, with the same event shapes and
// merge rules as @pierre/path-store's events module.

import type {
  PathStoreBatchEvent,
  PathStoreEvent,
  PathStoreEventForType,
  PathStoreEventType,
  PathStoreSemanticEvent,
} from '@pierre/path-store';

export interface TransactionFrame {
  readonly affectedAncestorIds: Set<number>;
  readonly affectedNodeIds: Set<number>;
  readonly events: PathStoreSemanticEvent[];
}

export interface EventState {
  getVisibleCount(): number;
  listeners: Map<string, Set<(event: PathStoreEvent) => void>>;
  transactionStack: TransactionFrame[];
}

export function createEventState(getVisibleCount: () => number): EventState {
  return {
    getVisibleCount,
    listeners: new Map(),
    transactionStack: [],
  };
}

export function subscribe<TType extends PathStoreEventType | '*'>(
  state: EventState,
  type: TType,
  handler: (event: PathStoreEventForType<TType>) => void
): () => void {
  const rawHandler = handler as (event: PathStoreEvent) => void;
  const existing = state.listeners.get(type);
  if (existing != null) {
    existing.add(rawHandler);
  } else {
    state.listeners.set(type, new Set([rawHandler]));
  }

  return () => {
    const listeners = state.listeners.get(type);
    if (listeners == null) {
      return;
    }
    listeners.delete(rawHandler);
    if (listeners.size === 0) {
      state.listeners.delete(type);
    }
  };
}

/** Stamp the visible-count delta a mutation produced onto its event. */
export function finalizeEvent(
  state: EventState,
  previousVisibleCount: number,
  event: PathStoreSemanticEvent
): PathStoreSemanticEvent {
  return {
    ...event,
    visibleCountDelta: state.getVisibleCount() - previousVisibleCount,
  };
}

export function batchEvents(state: EventState, run: () => void): void {
  const previousVisibleCount = state.getVisibleCount();
  const frame: TransactionFrame = {
    affectedAncestorIds: new Set(),
    affectedNodeIds: new Set(),
    events: [],
  };
  state.transactionStack.push(frame);

  try {
    run();
  } catch (error) {
    finishTransaction(state, frame, false);
    throw error;
  }

  finishTransaction(
    state,
    frame,
    true,
    state.getVisibleCount() - previousVisibleCount
  );
}

export function recordEvent(
  state: EventState,
  event: PathStoreSemanticEvent
): void {
  const frame = state.transactionStack[state.transactionStack.length - 1];
  if (frame == null) {
    emitEvent(state, event);
    return;
  }

  frame.events.push(event);
  for (const nodeId of event.affectedNodeIds) {
    frame.affectedNodeIds.add(nodeId);
  }
  for (const nodeId of event.affectedAncestorIds) {
    frame.affectedAncestorIds.add(nodeId);
  }
}

function finishTransaction(
  state: EventState,
  frame: TransactionFrame,
  emit: boolean,
  visibleCountDelta: number | null = null
): void {
  const popped = state.transactionStack.pop();
  if (popped !== frame) {
    throw new Error('Transaction stack underflow');
  }

  if (!emit) {
    return;
  }

  const parent = state.transactionStack[state.transactionStack.length - 1];
  if (parent != null) {
    for (const event of frame.events) {
      parent.events.push(event);
    }
    for (const nodeId of frame.affectedAncestorIds) {
      parent.affectedAncestorIds.add(nodeId);
    }
    for (const nodeId of frame.affectedNodeIds) {
      parent.affectedNodeIds.add(nodeId);
    }
    return;
  }

  const batchEvent: PathStoreBatchEvent = {
    affectedAncestorIds: [...frame.affectedAncestorIds],
    affectedNodeIds: [...frame.affectedNodeIds],
    canonicalChanged: frame.events.some((event) => event.canonicalChanged),
    events: [...frame.events],
    operation: 'batch',
    projectionChanged: frame.events.some((event) => event.projectionChanged),
    visibleCountDelta,
  };
  emitEvent(state, batchEvent);
}

function emitEvent(state: EventState, event: PathStoreEvent): void {
  state.listeners.get(event.operation)?.forEach((handler) => handler(event));
  state.listeners.get('*')?.forEach((handler) => handler(event));
}
