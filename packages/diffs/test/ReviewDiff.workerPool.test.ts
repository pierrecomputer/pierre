import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  REVIEW_DIFF_CLASS,
  REVIEW_DIFF_UNSAFE_CSS,
} from '../src/svelte/review/index';
import {
  acquireReviewWorkerPool,
  releaseReviewWorkerPool,
} from '../src/svelte/review/workerPool';

const originalWorker = globalThis.Worker;
const originalRequestAnimationFrame =
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame
    : undefined;
const originalCancelAnimationFrame =
  typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame
    : undefined;
let nextFrameId = 0;
const frames = new Map<number, ReturnType<typeof setTimeout>>();

beforeAll(() => {
  globalThis.requestAnimationFrame = ((callback) => {
    const id = ++nextFrameId;
    const timeout = setTimeout(() => {
      frames.delete(id);
      callback(performance.now());
    }, 0);
    frames.set(id, timeout);
    return id;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((id) => {
    const timeout = frames.get(id);
    if (timeout != null) {
      clearTimeout(timeout);
      frames.delete(id);
    }
  }) as typeof cancelAnimationFrame;
});

afterAll(() => {
  for (const timeout of frames.values()) {
    clearTimeout(timeout);
  }
  frames.clear();

  if (originalRequestAnimationFrame == null) {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  } else {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
  if (originalCancelAnimationFrame == null) {
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
  } else {
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

afterEach(async () => {
  releaseReviewWorkerPool();
  releaseReviewWorkerPool();
  if (originalWorker == null) {
    Reflect.deleteProperty(globalThis, 'Worker');
  } else {
    globalThis.Worker = originalWorker;
  }
  await disposeHighlighter();
});

describe('ReviewDiff worker pool', () => {
  test('does not acquire a worker pool outside browser workers', () => {
    Reflect.deleteProperty(globalThis, 'Worker');

    expect(acquireReviewWorkerPool()).toBeUndefined();
  });

  test('reference counts the shared worker pool', () => {
    installWorkerStub();
    const pool = acquireReviewWorkerPool();
    const again = acquireReviewWorkerPool();
    let terminated = 0;

    expect(pool).toBeDefined();
    expect(again).toBe(pool);

    if (pool != null) {
      pool.terminate = () => {
        terminated += 1;
      };
    }

    releaseReviewWorkerPool();
    expect(terminated).toBe(0);

    releaseReviewWorkerPool();
    expect(terminated).toBe(1);

    releaseReviewWorkerPool();
    expect(terminated).toBe(1);
  });

  test('exports the default review diff theme constants from the public entry', () => {
    expect(REVIEW_DIFF_CLASS).toBe('pierre-review-diff');
    expect(REVIEW_DIFF_UNSAFE_CSS).toContain('[data-unmodified-lines]');
  });
});

function installWorkerStub(): void {
  globalThis.Worker = class TestReviewWorker {
    addEventListener(): void {}

    postMessage(): void {}

    terminate(): void {}
  } as unknown as typeof Worker;
}
