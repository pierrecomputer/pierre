import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { disposeHighlighter, parseDiffFromFile, parsePatchFiles } from '../src';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import type { Virtualizer } from '../src/components/Virtualizer';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { linesToArray } from '../src/utils/diffLines';
import { installDom, wait } from './domHarness';
import { assertDefined, linesOf } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

class TestVirtualizedFileDiff extends VirtualizedFileDiff<undefined> {
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

function createVirtualizer(visible = true): {
  virtualizer: Virtualizer;
  instanceChangedCalls: { layoutDirty: boolean }[];
} {
  const instanceChangedCalls: { layoutDirty: boolean }[] = [];
  const virtualizer = {
    config: { resizeDebugging: false },
    type: 'simple',
    connect() {},
    disconnect() {},
    getOffsetInScrollContainer() {
      return 0;
    },
    getWindowSpecs() {
      return { top: 0, bottom: 1000 };
    },
    instanceChanged(_instance: unknown, layoutDirty: boolean) {
      instanceChangedCalls.push({ layoutDirty });
    },
    requestHeightReconcile() {},
    isInstanceVisible() {
      return visible;
    },
  } as unknown as Virtualizer;

  return { virtualizer, instanceChangedCalls };
}

function createAdvancedVirtualizer(): {
  virtualizer: Virtualizer;
  instanceChangedCalls: { layoutDirty: boolean }[];
} {
  const instanceChangedCalls: { layoutDirty: boolean }[] = [];
  const virtualizer = {
    config: { resizeDebugging: false },
    type: 'advanced',
    getLocalTopForInstance() {
      return 0;
    },
    getWindowSpecs() {
      return { top: 0, bottom: 1000 };
    },
    instanceChanged(_instance: unknown, layoutDirty: boolean) {
      instanceChangedCalls.push({ layoutDirty });
    },
  } as unknown as Virtualizer;

  return { virtualizer, instanceChangedCalls };
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

async function waitForHydrated(
  instance: VirtualizedFileDiff<undefined>
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (instance.fileDiff?.isPartial === false) {
      return;
    }
    await wait(10);
  }
  throw new Error('Timed out waiting for virtualized partial diff hydration');
}

describe('VirtualizedFileDiff partial hydration', () => {
  test('expandHunk hydrates once, preserves expansion state, and marks layout dirty', async () => {
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const loadedContents = { oldFile, newFile };
      const deferred = createDeferred<typeof loadedContents>();
      const virtualizerState = createVirtualizer();
      let loadCalls = 0;
      instance = new TestVirtualizedFileDiff(
        {
          disableFileHeader: true,
          loadDiffFiles: (fileDiff) => {
            loadCalls++;
            expect(fileDiff).toBe(partial);
            return deferred.promise;
          },
        },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(partial, 0);
      instance.expandHunk(0, 'down', 1);
      instance.expandHunk(0, 'up', 1);

      expect(loadCalls).toBe(1);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 1,
        fromEnd: 1,
      });
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
        { layoutDirty: true },
      ]);

      deferred.resolve(loadedContents);
      await waitForHydrated(instance);

      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(linesOf(instance.fileDiff?.additionLines)).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(linesOf(instance.fileDiff?.deletionLines)).toEqual([
        'keep 1\n',
        'old value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 1,
        fromEnd: 1,
      });
      expect(virtualizerState.instanceChangedCalls.at(-1)).toEqual({
        layoutDirty: true,
      });
      expect(virtualizerState.instanceChangedCalls).toHaveLength(3);
      const hydratedInstanceFileDiff = instance.fileDiff;
      assertDefined(
        hydratedInstanceFileDiff,
        'expected VirtualizedFileDiff to keep hydrated file diff'
      );
    } finally {
      instance?.cleanUp();
    }
  });

  test('expanding the synthetic bottom hunk starts hydration and marks layout dirty', async () => {
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const loadedContents = { oldFile, newFile };
      const deferred = createDeferred<typeof loadedContents>();
      const virtualizerState = createVirtualizer();
      let loadCalls = 0;
      instance = new TestVirtualizedFileDiff(
        {
          disableFileHeader: true,
          loadDiffFiles: (fileDiff) => {
            loadCalls++;
            expect(fileDiff).toBe(partial);
            return deferred.promise;
          },
        },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(partial, 0);
      instance.expandHunk(partial.hunks.length, 'up', 1);
      instance.expandHunk(partial.hunks.length, 'up', 1);

      expect(loadCalls).toBe(1);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
      expect(instance.getExpandedHunkForTest(partial.hunks.length)).toEqual({
        fromStart: 2,
        fromEnd: 0,
      });
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
        { layoutDirty: true },
      ]);

      deferred.resolve(loadedContents);
      await waitForHydrated(instance);

      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(virtualizerState.instanceChangedCalls.at(-1)).toEqual({
        layoutDirty: true,
      });
      expect(virtualizerState.instanceChangedCalls).toHaveLength(3);
    } finally {
      instance?.cleanUp();
    }
  });

  test('ignores stale loader results after the prepared diff changes', async () => {
    let instance: TestVirtualizedFileDiff | undefined;
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
      const virtualizerState = createVirtualizer();
      instance = new TestVirtualizedFileDiff(
        {
          disableFileHeader: true,
          loadDiffFiles: () => deferred.promise,
        },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(partial, 0);
      instance.expandHunk(0, 'down', 1);
      instance.prepareCodeViewItem(nextDiff, 0);

      deferred.resolve({ oldFile, newFile });
      await wait(10);

      expect(instance.fileDiff).toBe(nextDiff);
      expect(instance.fileDiff?.name).toBe('second.txt');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(linesOf(instance.fileDiff?.additionLines)).toEqual(['after\n']);
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
      ]);
    } finally {
      instance?.cleanUp();
    }
  });

  test('rendering a partial diff after a full diff replaces the rendered metadata', () => {
    const { cleanup } = installDom();
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const fullDiff = parseDiffFromFile(oldFile, newFile);
      const virtualizerState = createVirtualizer();
      const fileContainer = document.createElement('div');
      instance = new TestVirtualizedFileDiff(
        { disableFileHeader: true },
        virtualizerState.virtualizer
      );

      instance.render({
        fileContainer,
        fileDiff: fullDiff,
        deferManagers: true,
        preventEmit: true,
      });

      instance.render({
        fileContainer,
        fileDiff: partial,
        deferManagers: true,
        preventEmit: true,
      });

      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('prepareCodeViewItem accepts a partial diff after a full diff', () => {
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange();
      const fullDiff = parseDiffFromFile(oldFile, newFile);
      const virtualizerState = createVirtualizer();
      instance = new TestVirtualizedFileDiff(
        { disableFileHeader: true },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(fullDiff, 0);

      const height = instance.prepareCodeViewItem(partial, 0);

      expect(typeof height).toBe('number');
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(true);
    } finally {
      instance?.cleanUp();
    }
  });

  test('applies pending CodeView expansions when the prepared diff changes', () => {
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const firstChange = createPartialChange('first.txt');
      const secondChange = createPartialChange('second.txt');
      const virtualizerState = createAdvancedVirtualizer();
      instance = new TestVirtualizedFileDiff(
        { disableFileHeader: true },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(firstChange.partial, 0);
      instance.expandHunk(0, 'down', 1);
      instance.prepareCodeViewItem(secondChange.partial, 0);
      instance.consumeCodeViewLayoutChanges(secondChange.partial);

      expect(instance.getExpandedHunkForTest(0)).toEqual({
        fromStart: 0,
        fromEnd: 1,
      });
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
      ]);
    } finally {
      instance?.cleanUp();
    }
  });

  test('stages a hydrated clone for CodeView until layout changes are consumed', async () => {
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange('partial.ts');
      const loadedContents = { oldFile, newFile };
      const deferred = createDeferred<typeof loadedContents>();
      const virtualizerState = createAdvancedVirtualizer();
      instance = new TestVirtualizedFileDiff(
        {
          disableFileHeader: true,
          loadDiffFiles: () => deferred.promise,
        },
        virtualizerState.virtualizer
      );

      instance.prepareCodeViewItem(partial, 0);
      instance.expandHunk(0, 'down', 1);
      deferred.resolve(loadedContents);
      await wait(10);

      expect(partial.isPartial).toBe(true);
      expect(instance.fileDiff).toBe(partial);
      expect(linesOf(instance.fileDiff?.additionLines)).toEqual([
        'new value\n',
      ]);
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
        { layoutDirty: true },
      ]);

      const nextDiff = instance.consumeCodeViewLayoutChanges(partial);

      assertDefined(nextDiff, 'expected next diff');
      expect(nextDiff).not.toBe(partial);
      expect(nextDiff.isPartial).toBe(false);
      expect(linesToArray(nextDiff.additionLines)).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(instance.fileDiff).toBe(partial);
      instance.prepareCodeViewItem(nextDiff, 0);
      expect(instance.fileDiff).toBe(nextDiff);
      expect(partial.isPartial).toBe(true);
    } finally {
      instance?.cleanUp();
    }
  });

  test('expandUnchanged starts hydration for pure rename partial diffs', async () => {
    const { cleanup } = installDom();
    let instance: TestVirtualizedFileDiff | undefined;
    try {
      const { newFile, partial } = createPartialPureRename();
      const virtualizerState = createVirtualizer();
      let loadCalls = 0;
      const fileContainer = document.createElement('div');
      instance = new TestVirtualizedFileDiff(
        {
          disableErrorHandling: true,
          disableFileHeader: true,
          expandUnchanged: true,
          loadDiffFiles: (fileDiff) => {
            loadCalls++;
            expect(fileDiff).toBe(partial);
            return Promise.resolve({ oldFile: null, newFile });
          },
        },
        virtualizerState.virtualizer
      );

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
      expect(linesOf(instance.fileDiff?.additionLines)).toEqual([
        'alpha\n',
        'beta\n',
      ]);
      expect(linesOf(instance.fileDiff?.deletionLines)).toEqual([
        'alpha\n',
        'beta\n',
      ]);
      expect(virtualizerState.instanceChangedCalls.at(-1)).toEqual({
        layoutDirty: true,
      });
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });
});
