import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { disposeHighlighter, parseDiffFromFile, parsePatchFiles } from '../src';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import type { Virtualizer } from '../src/components/Virtualizer';
import type { DiffsEditor, FileContents, FileDiffMetadata } from '../src/types';
import { installDom, wait } from './domHarness';
import { assertDefined, createDeferred } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

class TestVirtualizedFileDiff extends VirtualizedFileDiff<undefined> {
  getLatestDiffForTest() {
    return this.getLatestDiff();
  }

  getExpandedHunkForTest(index: number) {
    return this.hunksRenderer.getExpandedHunk(index);
  }

  getPendingFileLoadPromiseForTest() {
    return this.pendingFiles?.promise;
  }
}

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp() {},
    edit: () => () => {},
    __captureFocusForDOMReplacement() {},
    __emitEditComplete() {},
    __getDocumentContents: () => undefined,
    __getDocumentSessionState: () => undefined,
    __postponeBgTokenizeToNextFrame() {},
    __syncRenderView() {},
  } as unknown as DiffsEditor<undefined>;
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
    markDOMDirty() {},
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

      instance.updateCodeViewLayout(partial, 0);
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

      instance.updateCodeViewLayout(partial, 0);
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

      instance.updateCodeViewLayout(partial, 0);
      instance.expandHunk(0, 'down', 1);
      instance.updateCodeViewLayout(nextDiff, 0);

      deferred.resolve({ oldFile, newFile });
      await wait(10);

      expect(instance.fileDiff).toBe(nextDiff);
      expect(instance.fileDiff?.name).toBe('second.txt');
      expect(instance.fileDiff?.isPartial).toBe(false);
      expect(instance.fileDiff?.additionLines).toEqual(['after\n']);
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

      instance.updateCodeViewLayout(fullDiff, 0);

      const height = instance.updateCodeViewLayout(partial, 0);

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

      instance.updateCodeViewLayout(firstChange.partial, 0);
      instance.expandHunk(0, 'down', 1);
      instance.updateCodeViewLayout(secondChange.partial, 0);

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

  test('commits staged CodeView hydration at the layout-consumption boundary', async () => {
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

      instance.updateCodeViewLayout(partial, 0);
      instance.expandHunk(0, 'down', 1);
      deferred.resolve(loadedContents);
      await wait(10);

      expect(partial.isPartial).toBe(true);
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.additionLines).toEqual(['new value\n']);
      expect(virtualizerState.instanceChangedCalls).toEqual([
        { layoutDirty: true },
        { layoutDirty: true },
      ]);

      instance.updateCodeViewLayout(partial, 0);

      expect(instance.fileDiff).toBe(partial);
      expect(partial.isPartial).toBe(false);
      expect(partial.additionLines).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(instance.fileDiff).toBe(partial);
    } finally {
      instance?.cleanUp();
    }
  });

  test('advanced edit hydration survives recycling before layout consumption', async () => {
    const { oldFile, newFile, partial } = createPartialChange('advanced.ts');
    partial.cacheKey = 'external:advanced-partial';
    const deferred = createDeferred<{
      oldFile: FileContents;
      newFile: FileContents;
    }>();
    const virtualizerState = createAdvancedVirtualizer();
    const instance = new TestVirtualizedFileDiff(
      {
        disableFileHeader: true,
        loadDiffFiles: () => deferred.promise,
      },
      virtualizerState.virtualizer
    );
    let detach:
      | ReturnType<TestVirtualizedFileDiff['__attachEditor']>
      | undefined;

    try {
      instance.updateCodeViewLayout(partial, 0);
      const editor = createEditorStub();
      detach = instance.__attachEditor(editor);
      const loadPromise = instance.getPendingFileLoadPromiseForTest();
      assertDefined(loadPromise, 'expected edit hydration to be pending');

      deferred.resolve({ oldFile, newFile });
      await loadPromise;

      expect(partial.isPartial).toBe(true);
      expect(instance.getLatestDiffForTest()).toBe(partial);

      instance.cleanUp(true);
      instance.updateCodeViewLayout(partial, 0);

      const recycledSession = instance.getLatestDiffForTest();
      expect(recycledSession).not.toBe(partial);
      expect(recycledSession?.cacheKey).toBeUndefined();
      expect(partial.isPartial).toBe(false);

      instance.virtualizedSetup();
      instance.updateCodeViewLayout(partial, 0);
      instance.__resumeEditor(editor);

      const sessionDiff = instance.getLatestDiffForTest();
      expect(sessionDiff).toBe(recycledSession);
      expect(instance.fileDiff).toBe(partial);
      expect(partial.isPartial).toBe(false);
      expect(partial.cacheKey).toBe('external:advanced-partial:hydrated');
      expect(sessionDiff).not.toBe(partial);
      expect(sessionDiff?.cacheKey).toBeUndefined();
      expect(sessionDiff?.additionLines).toBe(partial.additionLines);
      expect(sessionDiff?.deletionLines).toBe(partial.deletionLines);
      expect(sessionDiff?.hunks).toBe(partial.hunks);
    } finally {
      detach?.();
      instance.cleanUp();
    }
  });

  test('advanced replacement hydration keeps the previous session until layout consumes it', async () => {
    const initial = parseDiffFromFile(
      {
        name: 'replacement.ts',
        contents: 'keep 1\nold value\nkeep 3\nkeep 4\n',
      },
      {
        name: 'replacement.ts',
        contents: 'keep 1\nfirst value\nkeep 3\nkeep 4\n',
      }
    );
    initial.cacheKey = 'external:replacement-v1';
    const { oldFile, newFile, partial } = createPartialChange('replacement.ts');
    partial.cacheKey = 'external:replacement-partial';
    const deferred = createDeferred<{
      oldFile: FileContents;
      newFile: FileContents;
    }>();
    const virtualizerState = createAdvancedVirtualizer();
    const instance = new TestVirtualizedFileDiff(
      {
        disableFileHeader: true,
        loadDiffFiles: () => deferred.promise,
      },
      virtualizerState.virtualizer
    );
    let detach:
      | ReturnType<TestVirtualizedFileDiff['__attachEditor']>
      | undefined;

    try {
      instance.updateCodeViewLayout(initial, 0);
      detach = instance.__attachEditor(createEditorStub());
      const previousSession = instance.getLatestDiffForTest();
      expect(previousSession).not.toBe(initial);

      instance.updateCodeViewLayout(partial, 0);
      const loadPromise = instance.getPendingFileLoadPromiseForTest();
      assertDefined(
        loadPromise,
        'expected replacement hydration to be pending'
      );
      expect(instance.fileDiff).toBe(partial);
      expect(instance.getLatestDiffForTest()).toBe(previousSession);

      deferred.resolve({ oldFile, newFile });
      await loadPromise;
      expect(partial.isPartial).toBe(true);
      expect(instance.getLatestDiffForTest()).toBe(previousSession);

      instance.updateCodeViewLayout(partial, 0);
      const nextSession = instance.getLatestDiffForTest();
      expect(partial.isPartial).toBe(false);
      expect(nextSession).not.toBe(previousSession);
      expect(nextSession).not.toBe(partial);
      expect(nextSession?.cacheKey).toBeUndefined();
      expect(nextSession?.additionLines).toBe(partial.additionLines);
      expect(nextSession?.deletionLines).toBe(partial.deletionLines);
    } finally {
      detach?.();
      instance.cleanUp();
    }
  });

  test('simple edit hydration creates its session from the hydrated base', async () => {
    const { oldFile, newFile, partial } = createPartialChange('simple.ts');
    partial.cacheKey = 'external:simple-partial';
    const deferred = createDeferred<{
      oldFile: FileContents;
      newFile: FileContents;
    }>();
    const virtualizerState = createVirtualizer();
    const instance = new TestVirtualizedFileDiff(
      {
        disableFileHeader: true,
        loadDiffFiles: () => deferred.promise,
      },
      virtualizerState.virtualizer
    );
    let detach:
      | ReturnType<TestVirtualizedFileDiff['__attachEditor']>
      | undefined;

    try {
      instance.updateCodeViewLayout(partial, 0);
      detach = instance.__attachEditor(createEditorStub());
      const loadPromise = instance.getPendingFileLoadPromiseForTest();
      assertDefined(loadPromise, 'expected edit hydration to be pending');

      deferred.resolve({ oldFile, newFile });
      await loadPromise;

      const sessionDiff = instance.getLatestDiffForTest();
      expect(instance.fileDiff).toBe(partial);
      expect(partial.isPartial).toBe(false);
      expect(partial.cacheKey).toBe('external:simple-partial:hydrated');
      expect(sessionDiff).not.toBe(partial);
      expect(sessionDiff?.cacheKey).toBeUndefined();
      expect(sessionDiff?.additionLines).toBe(partial.additionLines);
      expect(sessionDiff?.deletionLines).toBe(partial.deletionLines);
      expect(sessionDiff?.hunks).toBe(partial.hunks);
    } finally {
      detach?.();
      instance.cleanUp();
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
      expect(instance.fileDiff?.additionLines).toEqual(['alpha\n', 'beta\n']);
      expect(instance.fileDiff?.deletionLines).toEqual(['alpha\n', 'beta\n']);
      expect(virtualizerState.instanceChangedCalls.at(-1)).toEqual({
        layoutDirty: true,
      });
    } finally {
      instance?.cleanUp();
      cleanup();
    }
  });

  test('same-key wrappers preserve the original edit-session baseline', () => {
    const { cleanup } = installDom();
    const externalDiff = parseDiffFromFile(
      { name: 'same-key.txt', contents: 'old\n' },
      { name: 'same-key.txt', contents: 'new\n' }
    );
    externalDiff.cacheKey = 'external:same-key';
    const equivalentDiff = structuredClone(externalDiff);
    const fileContainer = document.createElement('div');
    const virtualizerState = createVirtualizer(false);
    const instance = new TestVirtualizedFileDiff(
      { disableFileHeader: true },
      virtualizerState.virtualizer
    );
    let detach:
      | ReturnType<TestVirtualizedFileDiff['__attachEditor']>
      | undefined;

    try {
      instance.render({ fileContainer, fileDiff: externalDiff });
      detach = instance.__attachEditor(createEditorStub());
      const sessionDiff = instance.getLatestDiffForTest();

      instance.updateCodeViewLayout(equivalentDiff, 0);
      instance.render({
        fileContainer,
        fileDiff: equivalentDiff,
        forceRender: true,
      });

      expect(instance.fileDiff).toBe(externalDiff);
      expect(sessionDiff).not.toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(sessionDiff);
      expect(sessionDiff?.additionLines).toBe(externalDiff.additionLines);
    } finally {
      detach?.();
      instance.cleanUp();
      cleanup();
    }
  });
});
