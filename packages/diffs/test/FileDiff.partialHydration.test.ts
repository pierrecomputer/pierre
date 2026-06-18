import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import {
  disposeHighlighter,
  FileDiff,
  parseDiffFromFile,
  parsePatchFiles,
} from '../src';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { installDom, wait } from './domHarness';
import { assertDefined } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  getExpandedHunkForTest(index: number) {
    return this.hunksRenderer.getExpandedHunk(index);
  }

  getPendingHydrationPromiseForTest() {
    return this.pendingDiffHydration?.promise;
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function parseSinglePartialFile(patch: string): FileDiffMetadata {
  const file = parsePatchFiles(patch, 'partial', true)[0]?.files[0];
  assertDefined(file, 'expected patch to contain one file');
  expect(file.isPartial).toBe(true);
  return file;
}

function createPartialChange(name = 'partial.txt'): {
  oldFile: FileContents;
  newFile: FileContents;
  partial: FileDiffMetadata;
} {
  const oldFile: FileContents = {
    name,
    contents: ['keep 1\n', 'old value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:old`,
  };
  const newFile: FileContents = {
    name,
    contents: ['keep 1\n', 'new value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:new`,
  };
  const partial = parseSinglePartialFile(
    createTwoFilesPatch(
      oldFile.name,
      newFile.name,
      oldFile.contents,
      newFile.contents,
      undefined,
      undefined,
      { context: 0 }
    )
  );
  expect(partial.hunks[0]?.collapsedBefore).toBeGreaterThan(0);
  return { oldFile, newFile, partial };
}

function createPartialPureRename(): {
  newFile: FileContents;
  partial: FileDiffMetadata;
} {
  const partial = parseSinglePartialFile(
    [
      'diff --git a/old-name.txt b/new-name.txt\n',
      'similarity index 100%\n',
      'rename from old-name.txt\n',
      'rename to new-name.txt\n',
    ].join('')
  );
  const newFile: FileContents = {
    name: 'new-name.txt',
    contents: 'alpha\nbeta\n',
    cacheKey: 'rename:new',
  };
  expect(partial.type).toBe('rename-pure');
  expect(partial.hunks).toEqual([]);
  return { newFile, partial };
}

async function waitForHydrated(instance: FileDiff<undefined>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (instance.fileDiff?.isPartial === false) {
      return;
    }
    await wait(10);
  }
  throw new Error('Timed out waiting for partial diff hydration');
}

describe('FileDiff partial hydration', () => {
  test('expandHunk hydrates once and preserves expansion state changes made while loading', async () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const loadedContents = { oldFile, newFile };
      const deferred = createDeferred<typeof loadedContents>();
      let loadCalls = 0;
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        loadDiffFiles: (fileDiff) => {
          loadCalls++;
          expect(fileDiff).toBe(partial);
          return deferred.promise;
        },
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'down', 1);
      instance.expandHunk(0, 'up', 2);

      expect(loadCalls).toBe(1);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 2,
        fromEnd: 1,
      });

      deferred.resolve(loadedContents);
      await waitForHydrated(instance);

      expect(instance.fileDiff).not.toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.additionLines).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(instance.fileDiff?.deletionLines).toEqual([
        'keep 1\n',
        'old value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 2,
        fromEnd: 1,
      });
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('expandHunk without a file loader leaves partial diffs unhydrated', () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { partial } = createPartialChange();
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'down', 1);

      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getPendingHydrationPromiseForTest()).toBeUndefined();
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 0,
        fromEnd: 1,
      });
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('expandHunk on full diffs does not start partial hydration', () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { oldFile, newFile } = createPartialChange();
      const fullDiff = parseDiffFromFile(oldFile, newFile);
      let loadCalls = 0;
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        loadDiffFiles: () => {
          loadCalls++;
          return Promise.resolve({ oldFile, newFile });
        },
      });

      instance.render({
        fileContainer,
        fileDiff: fullDiff,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'both', 1);

      expect(loadCalls).toBe(0);
      expect(instance.fileDiff).toBe(fullDiff);
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.getPendingHydrationPromiseForTest()).toBeUndefined();
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 1,
        fromEnd: 1,
      });
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('ignores stale loader results after the rendered diff changes', async () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange('first.txt');
      const nextDiff = parseDiffFromFile(
        { name: 'second.txt', contents: 'before\n' },
        { name: 'second.txt', contents: 'after\n' }
      );
      const deferred = createDeferred<{
        oldFile: FileContents;
        newFile: FileContents;
      }>();
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        loadDiffFiles: () => deferred.promise,
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'down', 1);
      instance.render({
        fileContainer,
        fileDiff: nextDiff,
        deferManagers: true,
        preventEmit: true,
      });

      deferred.resolve({ oldFile, newFile });
      await wait(10);

      expect(instance.fileDiff).toBe(nextDiff);
      expect(instance.fileDiff?.name).toBe('second.txt');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.additionLines).toEqual(['after\n']);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('expandUnchanged starts hydration for pure rename partial diffs', async () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { newFile, partial } = createPartialPureRename();
      let loadCalls = 0;
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        expandUnchanged: true,
        loadDiffFiles: (fileDiff) => {
          loadCalls++;
          expect(fileDiff).toBe(partial);
          return Promise.resolve({ oldFile: null, newFile });
        },
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });

      expect(loadCalls).toBe(1);
      await waitForHydrated(instance);

      expect(instance.fileDiff?.type).toBe('rename-pure');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.additionLines).toEqual(['alpha\n', 'beta\n']);
      expect(instance.fileDiff?.deletionLines).toEqual(['alpha\n', 'beta\n']);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('logs loader errors, keeps partial diff intact, and allows retry', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    let instance: TestFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const loadedContents = { oldFile, newFile };
      const loadError = new Error('load failed');
      let loadCalls = 0;
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableFileHeader: true,
        loadDiffFiles: () => {
          loadCalls++;
          if (loadCalls === 1) {
            return Promise.reject(loadError);
          }
          return Promise.resolve(loadedContents);
        },
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'down', 1);
      await wait(10);

      expect(loadCalls).toBe(1);
      expect(consoleError.mock.calls[0]?.[0]).toBe(loadError);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getPendingHydrationPromiseForTest()).toBeUndefined();

      instance.expandHunk(0, 'up', 1);
      expect(loadCalls).toBe(2);
      await waitForHydrated(instance);

      expect(instance.fileDiff).not.toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.additionLines).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
    } finally {
      consoleError.mockRestore();
      instance?.cleanUp();
      cleanup();
    }
  });

  test('rejects the hydration promise when disableErrorHandling is true', async () => {
    const { cleanup } = installDom();
    let instance: TestFileDiff | undefined;
    try {
      const { partial } = createPartialChange();
      const loadError = new Error('load failed');
      const fileContainer = document.createElement('div');
      instance = new TestFileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        loadDiffFiles: () => Promise.reject(loadError),
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(0, 'down', 1);
      const hydrationPromise = instance.getPendingHydrationPromiseForTest();
      assertDefined(hydrationPromise, 'expected hydration to be pending');

      let rejectedError: unknown;
      try {
        await hydrationPromise;
      } catch (error: unknown) {
        rejectedError = error;
      }

      expect(rejectedError).toBe(loadError);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getPendingHydrationPromiseForTest()).toBeUndefined();
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });
});
