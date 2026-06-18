import { afterAll, describe, expect, test } from 'bun:test';
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
});
