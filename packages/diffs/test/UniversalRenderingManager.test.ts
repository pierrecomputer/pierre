import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  dequeueRender,
  queueRender,
} from '../src/managers/UniversalRenderingManager';
import { installDom } from './domHarness';

function installFrameHarness() {
  const dom = installDom();
  const frames = new Map<number, FrameRequestCallback>();
  const cancelledFrameIds: number[] = [];
  let nextFrameId = 0;

  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const frameId = ++nextFrameId;
    frames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId: number) => {
    cancelledFrameIds.push(frameId);
    frames.delete(frameId);
  };

  return {
    cancelledFrameIds,
    cleanup: dom.cleanup,
    frames,
    runFrame(frameId: number, time = performance.now()) {
      const callback = frames.get(frameId);
      if (callback === undefined) {
        throw new Error(`frame ${frameId} is not pending`);
      }
      frames.delete(frameId);
      callback(time);
    },
  };
}

describe('UniversalRenderingManager', () => {
  let harness: ReturnType<typeof installFrameHarness>;

  beforeEach(() => {
    harness = installFrameHarness();
  });

  afterEach(() => {
    harness.cleanup();
  });

  test('queues the same callback once per frame', () => {
    const callback = mock(() => {});

    queueRender(callback);
    queueRender(callback);

    expect([...harness.frames.keys()]).toEqual([1]);
    harness.runFrame(1, 42);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(42);
    expect(harness.frames.size).toBe(0);

    queueRender(callback);
    expect([...harness.frames.keys()]).toEqual([2]);

    harness.runFrame(2, 84);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(84);
  });

  test('dequeues the same callback idempotently', () => {
    const callback = mock(() => {});

    queueRender(callback);
    dequeueRender(callback);
    dequeueRender(callback);

    expect(callback).not.toHaveBeenCalled();
    expect(harness.cancelledFrameIds).toEqual([1]);
    expect(harness.frames.size).toBe(0);
  });

  test('keeps the shared frame when dequeuing one callback', () => {
    const dequeuedCallback = mock(() => {});
    const queuedCallback = mock(() => {});

    queueRender(dequeuedCallback);
    queueRender(queuedCallback);
    dequeueRender(dequeuedCallback);
    dequeueRender(dequeuedCallback);

    expect(harness.cancelledFrameIds).toEqual([]);
    expect([...harness.frames.keys()]).toEqual([1]);

    harness.runFrame(1);
    expect(dequeuedCallback).not.toHaveBeenCalled();
    expect(queuedCallback).toHaveBeenCalledTimes(1);
  });

  test('ignores dequeues for callbacks that are not queued', () => {
    const queuedCallback = mock(() => {});
    const unknownCallback = mock(() => {});

    queueRender(queuedCallback);
    dequeueRender(unknownCallback);

    expect(harness.cancelledFrameIds).toEqual([]);
    expect([...harness.frames.keys()]).toEqual([1]);

    harness.runFrame(1);
    expect(queuedCallback).toHaveBeenCalledTimes(1);
    expect(unknownCallback).not.toHaveBeenCalled();
  });

  test('queues a new frame after the previous frame is cancelled', () => {
    const cancelledCallback = mock(() => {});
    const replacementCallback = mock(() => {});

    queueRender(cancelledCallback);
    dequeueRender(cancelledCallback);
    queueRender(replacementCallback);

    expect(harness.cancelledFrameIds).toEqual([1]);
    expect([...harness.frames.keys()]).toEqual([2]);

    harness.runFrame(2);
    expect(cancelledCallback).not.toHaveBeenCalled();
    expect(replacementCallback).toHaveBeenCalledTimes(1);
  });

  test('does not cancel the active frame when callbacks requeue during render', () => {
    const staleCallback = mock(() => {});
    const replacementCallback = mock(() => {});

    queueRender(() => {
      dequeueRender(staleCallback);
      queueRender(replacementCallback);
    });
    queueRender(staleCallback);

    expect([...harness.frames.keys()]).toEqual([1]);
    harness.runFrame(1);

    // The stale callback was already copied into this pass, while its
    // replacement belongs to exactly one follow-up frame.
    expect(staleCallback).toHaveBeenCalledTimes(1);
    expect(harness.cancelledFrameIds).toEqual([]);
    expect([...harness.frames.keys()]).toEqual([2]);

    harness.runFrame(2);
    expect(replacementCallback).toHaveBeenCalledTimes(1);
    expect(harness.frames.size).toBe(0);
  });
});
