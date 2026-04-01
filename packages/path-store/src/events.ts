import type { PathStoreEvent } from './public-types';
import { createTransactionFrame } from './state';
import type { PathStoreState, TransactionFrame } from './state';

export function subscribe(
  state: PathStoreState,
  type: string,
  handler: (event: PathStoreEvent) => void
): () => void {
  const existingListeners = state.listeners.get(type);
  if (existingListeners != null) {
    existingListeners.add(handler);
  } else {
    state.listeners.set(type, new Set([handler]));
  }

  return () => {
    const listeners = state.listeners.get(type);
    if (listeners == null) {
      return;
    }

    listeners.delete(handler);
    if (listeners.size === 0) {
      state.listeners.delete(type);
    }
  };
}

export function batchEvents(state: PathStoreState, run: () => void): void {
  const frame = createTransactionFrame();
  state.transactionStack.push(frame);

  try {
    run();
  } catch (error) {
    finishTransaction(state, frame, false);
    throw error;
  }

  finishTransaction(state, frame, true);
}

export function recordEvent(
  state: PathStoreState,
  event: PathStoreEvent
): void {
  const currentFrame =
    state.transactionStack[state.transactionStack.length - 1] ?? null;
  if (currentFrame == null) {
    emitEvent(state, event);
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

function finishTransaction(
  state: PathStoreState,
  frame: TransactionFrame,
  emit: boolean
): void {
  const poppedFrame = state.transactionStack.pop();
  if (poppedFrame !== frame) {
    throw new Error('Transaction stack underflow');
  }

  if (!emit) {
    return;
  }

  const batchEvent = createBatchEvent(frame);
  const parentFrame =
    state.transactionStack[state.transactionStack.length - 1] ?? null;
  if (parentFrame != null) {
    parentFrame.events.push(batchEvent);
    mergeFrameMetadata(parentFrame, frame);
    return;
  }

  emitEvent(state, batchEvent);
}

function createBatchEvent(frame: TransactionFrame): PathStoreEvent {
  return {
    affectedAncestorIds: [...frame.affectedAncestorIds],
    affectedNodeIds: [...frame.affectedNodeIds],
    changeset: { events: frame.events },
    operation: 'batch',
  };
}

function mergeFrameMetadata(
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

function emitEvent(state: PathStoreState, event: PathStoreEvent): void {
  const specificListeners = state.listeners.get(event.operation);
  specificListeners?.forEach((handler) => handler(event));
  const wildcardListeners = state.listeners.get('*');
  wildcardListeners?.forEach((handler) => handler(event));
}
