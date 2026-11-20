import { describe, expect, test } from 'bun:test';

import {
  dequeueBackgroundTask,
  queueBackgroundTask,
} from '../src/managers/BackgroundTaskQueue';
import { installDom, waitFor } from './domHarness';

describe('BackgroundTaskQueue', () => {
  test('background callbacks run in separate tasks and can be canceled', async () => {
    const dom = installDom();
    const calls: string[] = [];
    const canceled = () => calls.push('canceled');
    try {
      queueBackgroundTask(() => {
        calls.push('first');
        queueMicrotask(() => calls.push('microtask'));
      });
      queueBackgroundTask(() => calls.push('second'));
      queueBackgroundTask(canceled);
      dequeueBackgroundTask(canceled);
      await waitFor(() => calls.includes('second'));
      expect(calls).toEqual(['first', 'microtask', 'second']);
    } finally {
      dom.cleanup();
    }
  });
});
