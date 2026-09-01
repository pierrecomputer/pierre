import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import {
  disposeHighlighter,
  FileDiff,
  parseDiffFromFile,
  parsePatchFiles,
} from '../src';
import type {
  FileDiffEditCompleteEvent,
  FileDiffEditCompleteHandler,
  FileDiffOptions,
} from '../src/components/FileDiff';
import { Editor, type EditorOptions } from '../src/editor/editor';
import type { EditorChangeEvent, EditorViewState } from '../src/editor/types';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  HighlightedToken,
} from '../src/types';
import { installDom, waitFor } from './domHarness';
import {
  createEditorInstance,
  createTextDocumentFromLines,
} from './editorTestUtils';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  throwOnRerender = false;

  getLatestDiffForTest(): FileDiffMetadata | undefined {
    return this.getLatestDiff();
  }

  getRendererDiffForTest(): FileDiffMetadata | undefined {
    return this.hunksRenderer.diffCache;
  }

  isEditorRenderReadyForTest(): boolean {
    return this.hunksRenderer.editorRenderReady();
  }

  getExternalAnnotationsForTest(): DiffLineAnnotation<undefined>[] {
    return this.lineAnnotations;
  }

  getLatestAnnotationsForTest(): DiffLineAnnotation<undefined>[] {
    return this.getLatestAnnotations();
  }

  clearRenderCacheForTest(): void {
    this.hunksRenderer.clearRenderCache();
  }

  override rerender(): void {
    if (this.throwOnRerender) {
      throw new Error('attachment failed');
    }
    super.rerender();
  }
}

function createExternalDiff(): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'session.ts', contents: 'alpha\nold value\nomega\n' },
    { name: 'session.ts', contents: 'alpha\nnew value\nomega\n' }
  );
  fileDiff.cacheKey = 'external:session-v1';
  return fileDiff;
}

function captureExternalDiffState(fileDiff: FileDiffMetadata) {
  return {
    value: structuredClone(fileDiff),
    additionLines: fileDiff.additionLines,
    deletionLines: fileDiff.deletionLines,
    hunks: fileDiff.hunks,
    hunkItems: [...fileDiff.hunks],
  };
}

function expectExternalDiffUnchanged(
  instance: TestFileDiff,
  externalDiff: FileDiffMetadata,
  before: ReturnType<typeof captureExternalDiffState>
): void {
  expect(instance.fileDiff).toBe(externalDiff);
  expect(externalDiff.additionLines).toBe(before.additionLines);
  expect(externalDiff.deletionLines).toBe(before.deletionLines);
  expect(externalDiff.hunks).toBe(before.hunks);
  for (const [index, hunk] of before.hunkItems.entries()) {
    expect(externalDiff.hunks[index]).toBe(hunk);
  }
  expect(externalDiff).toEqual(before.value);
}

function makeDirtyLines(
  edits: ReadonlyArray<[number, string]>
): Map<number, HighlightedToken[]> {
  return new Map(edits.map(([line, text]) => [line, [[0, '', text]]]));
}

async function createAttachedFixture(): Promise<{
  cleanup(): void;
  detach(): void;
  externalDiff: FileDiffMetadata;
  fileContainer: HTMLElement;
  instance: TestFileDiff;
}> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const externalDiff = createExternalDiff();
  const instance = new TestFileDiff({
    disableErrorHandling: true,
    disableFileHeader: true,
  });

  instance.render({
    fileDiff: externalDiff,
    fileContainer,
    forceRender: true,
  });
  const detachEditor = instance.__attachEditor(
    createEditorInstance('file-diff')
  );

  await waitFor(
    () => {
      const sessionDiff = instance.getLatestDiffForTest();
      return (
        sessionDiff != null &&
        sessionDiff !== externalDiff &&
        instance.isEditorRenderReadyForTest()
      );
    },
    { timeout: 4_000 }
  );
  const sessionDiff = instance.getLatestDiffForTest();
  expect(sessionDiff).toBeDefined();
  expect(sessionDiff).not.toBe(externalDiff);
  expect(instance.isEditorRenderReadyForTest()).toBe(true);

  return {
    cleanup() {
      instance.cleanUp();
      dom.cleanup();
    },
    detach() {
      detachEditor();
    },
    externalDiff,
    fileContainer,
    instance,
  };
}

describe('FileDiff edit-session ownership', () => {
  test('mutation entry points reject writes without an edit session', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });

      expect(() =>
        instance.updateRenderCache(
          makeDirtyLines([[1, 'edited value']]),
          'light'
        )
      ).toThrow('FileDiff.updateRenderCache: requires an active edit session');
      expect(() =>
        instance.applyDocumentChange(
          createTextDocumentFromLines(
            'file-diff',
            ['alpha\n', 'inserted\n', 'new value\n', 'omega\n'],
            'inmemory://file-diff-session'
          )
        )
      ).toThrow(
        'FileDiff.applyDocumentChange: requires an active edit session'
      );

      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('failed attachment releases the editor association', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    try {
      instance.render({
        fileDiff: createExternalDiff(),
        fileContainer,
        forceRender: true,
      });
      instance.clearRenderCacheForTest();
      instance.throwOnRerender = true;
      expect(() =>
        instance.__attachEditor(createEditorInstance('file-diff'))
      ).toThrow('attachment failed');

      instance.throwOnRerender = false;
      const detach = instance.__attachEditor(createEditorInstance('file-diff'));
      detach();
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('attach creates a private keyless shallow session diff', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    try {
      const sessionDiff = instance.getLatestDiffForTest();
      expect(sessionDiff).toBeDefined();
      if (sessionDiff == null) return;

      expect(sessionDiff).not.toBe(externalDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(externalDiff.cacheKey).toBe('external:session-v1');
      expect(sessionDiff.additionLines).toBe(externalDiff.additionLines);
      expect(sessionDiff.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionDiff.hunks).toBe(externalDiff.hunks);
      expect(sessionDiff.hunks[0]).toBe(externalDiff.hunks[0]);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a same-line edit copies addition lines and keeps hunks shared', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      const sessionBefore = instance.getLatestDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.additionLines).toBe(externalDiff.additionLines);
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );

      const sessionAfter = instance.getLatestDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines[1]).toBe('edited value\n');
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.editSessionDirty).toBe(true);
      expect(instance.getRendererDiffForTest()).toBe(sessionAfter);
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a structural edit rebuilds an owned hunk graph', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      const sessionBefore = instance.getLatestDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.applyDocumentChange(
        createTextDocumentFromLines(
          'file-diff',
          ['alpha\n', 'inserted\n', 'new value\n', 'omega\n'],
          'inmemory://file-diff-session'
        )
      );

      const sessionAfter = instance.getLatestDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines.join('')).toBe(
        'alpha\ninserted\nnew value\nomega\n'
      );
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).not.toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).not.toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.cacheKey).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  for (const [triggerName, triggerRender] of [
    [
      'an internal rerender',
      ({ instance }: Awaited<ReturnType<typeof createAttachedFixture>>) =>
        instance.rerender(),
    ],
    [
      'a theme-cache rerender',
      ({ instance }: Awaited<ReturnType<typeof createAttachedFixture>>) =>
        instance.onThemeChange(),
    ],
    [
      'an overlapping viewport rerender',
      ({
        externalDiff,
        fileContainer,
        instance,
      }: Awaited<ReturnType<typeof createAttachedFixture>>) => {
        instance.render({
          fileDiff: externalDiff,
          fileContainer,
          forceRender: true,
          renderRange: {
            startingLine: 0,
            totalLines: 2,
            bufferBefore: 0,
            bufferAfter: 0,
          },
        });
        instance.render({
          fileDiff: externalDiff,
          fileContainer,
          renderRange: {
            startingLine: 1,
            totalLines: 2,
            bufferBefore: 0,
            bufferAfter: 0,
          },
        });
      },
    ],
    [
      'an option-change rerender',
      ({ instance }: Awaited<ReturnType<typeof createAttachedFixture>>) => {
        instance.setOptions({
          ...instance.options,
          diffStyle: 'unified',
        });
        instance.rerender();
      },
    ],
  ] as const) {
    test(`${triggerName} renders from the private session`, async () => {
      const fixture = await createAttachedFixture();
      const { detach, externalDiff, instance } = fixture;
      const externalBefore = captureExternalDiffState(externalDiff);
      try {
        instance.updateRenderCache(
          makeDirtyLines([[1, 'edited value']]),
          'light'
        );
        const sessionDiff = instance.getLatestDiffForTest();
        expect(sessionDiff).toBeDefined();
        expect(sessionDiff).not.toBe(externalDiff);

        triggerRender(fixture);

        expect(instance.getLatestDiffForTest()).toBe(sessionDiff);
        expect(instance.getRendererDiffForTest()).toBe(sessionDiff);
        expect(sessionDiff?.additionLines[1]).toBe('edited value\n');
        expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
      } finally {
        detach();
        fixture.cleanup();
      }
    });
  }

  test('a same-key external object renders from the private session', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, fileContainer, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    const equivalentExternalDiff = structuredClone(externalDiff);
    const equivalentBefore = structuredClone(equivalentExternalDiff);
    try {
      const sessionDiff = instance.getLatestDiffForTest();
      expect(sessionDiff).toBeDefined();

      instance.render({
        fileDiff: equivalentExternalDiff,
        fileContainer,
        forceRender: true,
      });

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(sessionDiff);
      expect(instance.getRendererDiffForTest()).toBe(sessionDiff);

      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );

      expect(sessionDiff?.additionLines[1]).toBe('edited value\n');
      expect(externalDiff).toEqual(externalBefore.value);
      expect(equivalentExternalDiff).toEqual(equivalentBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('new annotations render over the private session contents', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, fileContainer, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );
      const sessionDiff = instance.getLatestDiffForTest();
      expect(sessionDiff).toBeDefined();

      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        lineAnnotations: [{ side: 'additions', lineNumber: 2 }],
      });

      expect(instance.getRendererDiffForTest()).toBe(sessionDiff);
      expect(fileContainer.shadowRoot?.textContent).toContain('edited value');
      expect(
        fileContainer.shadowRoot?.querySelector(
          'slot[name="annotation-additions-2"]'
        )
      ).not.toBeNull();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('recycling clears renderer state without writing edits to the external diff', async () => {
    const fixture = await createAttachedFixture();
    const { externalDiff, instance } = fixture;
    const externalBefore = captureExternalDiffState(externalDiff);
    try {
      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );
      const sessionDiff = instance.getLatestDiffForTest();
      expect(sessionDiff).toBeDefined();
      expect(sessionDiff?.additionLines[1]).toBe('edited value\n');

      instance.cleanUp(true);

      expect(instance.getLatestDiffForTest()).toBe(sessionDiff);
      expect(instance.getRendererDiffForTest()).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('real editor changes emit an edited keyless file without changing the external diff', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const changedFiles: FileContents[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor('file-diff', {
      onChange: (event) => changedFiles.push(event.file),
    });

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);

      await waitFor(() => editor.getText() === 'alpha\nnew value\nomega\n', {
        timeout: 4_000,
      });
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 9 },
          },
          newText: 'edited value',
        },
      ]);

      expect(changedFiles).toHaveLength(1);
      expect(changedFiles[0]).toEqual({
        name: 'session.ts',
        contents: 'alpha\nedited value\nomega\n',
      });
      expect(changedFiles[0]?.cacheKey).toBeUndefined();
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('component onEditChange receives the exact event the editor emits', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const editorEvents: EditorChangeEvent<'file-diff', undefined, undefined>[] =
      [];
    const componentEvents: EditorChangeEvent<
      'file-diff',
      undefined,
      undefined
    >[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditChange: (event) => componentEvents.push(event),
    });
    const editor = new Editor('file-diff', {
      onChange: (event) => editorEvents.push(event),
    });

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);

      await waitFor(() => editor.getText() === 'alpha\nnew value\nomega\n', {
        timeout: 4_000,
      });
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 9 },
          },
          newText: 'edited value',
        },
      ]);

      expect(editorEvents).toHaveLength(1);
      expect(componentEvents).toHaveLength(1);
      expect(componentEvents[0]).toBe(editorEvents[0]);
      expect(componentEvents[0]?.editor).toBe(editor);
      expect(componentEvents[0]?.file.contents).toBe(
        'alpha\nedited value\nomega\n'
      );
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('session-owned annotations keep frozen names while the external collection stays put', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const externalAnnotations: DiffLineAnnotation<undefined>[] = [
      { side: 'additions', lineNumber: 2 },
    ];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const editor = new Editor('file-diff');

    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
        lineAnnotations: externalAnnotations,
      });
      editor.edit(instance);

      await waitFor(() => editor.getText() === 'alpha\nnew value\nomega\n', {
        timeout: 4_000,
      });
      // Insert a line above the annotated one: the session collection remaps
      // while the caller collection and the frozen slot name stay put.
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'inserted\n',
        },
      ]);

      const latest = instance.getLatestAnnotationsForTest();
      expect(latest).toEqual([{ side: 'additions', lineNumber: 3 }]);
      expect(instance.getExternalAnnotationsForTest()).toBe(
        externalAnnotations
      );
      expect(externalAnnotations).toEqual([
        { side: 'additions', lineNumber: 2 },
      ]);
      const moved = latest.at(0);
      if (moved == null) {
        throw new Error('Expected the remapped annotation to survive');
      }
      expect(instance.getAnnotationSlotName(moved)).toBe(
        'annotation-additions-2'
      );
      await waitFor(() => {
        const names = Array.from(
          fileContainer.shadowRoot?.querySelectorAll(
            '[data-line-annotation] slot'
          ) ?? []
        ).map((slot) => slot.getAttribute('name'));
        return names.includes('annotation-additions-2');
      });
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });
});

describe('__completeEditSession', () => {
  const EXTERNAL_CONTENTS = 'alpha\nnew value\nomega\n';

  async function createCompletionFixture(config?: {
    editorOnComplete?: NonNullable<
      EditorOptions<'file-diff', undefined, undefined>['onComplete']
    >;
    onEditComplete?: FileDiffEditCompleteHandler<undefined, undefined>;
    onEditChange?: (
      event: EditorChangeEvent<'file-diff', undefined, undefined>
    ) => void;
    lineAnnotations?: DiffLineAnnotation<undefined>[];
    externalDiff?: FileDiffMetadata;
    loadDiffFiles?: FileDiffOptions<undefined, undefined>['loadDiffFiles'];
  }) {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = config?.externalDiff ?? createExternalDiff();
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete: config?.onEditComplete,
      onEditChange: config?.onEditChange,
      loadDiffFiles: config?.loadDiffFiles,
    });
    const editor = new Editor('file-diff', {
      onComplete: config?.editorOnComplete,
    });
    instance.render({
      fileDiff: externalDiff,
      fileContainer,
      forceRender: true,
      lineAnnotations: config?.lineAnnotations,
    });
    editor.edit(instance);
    await waitFor(
      () => editor.getText() === externalDiff.additionLines.join(''),
      { timeout: 4_000 }
    );
    return {
      editor,
      externalDiff,
      fileContainer,
      instance,
      detach() {
        editor.cleanUp('recycle');
      },
      cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        dom.cleanup();
      },
    };
  }

  function replaceDocument(
    editor: Editor<'file-diff', undefined>,
    contents: string
  ): void {
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: {
            line: Number.MAX_SAFE_INTEGER,
            character: Number.MAX_SAFE_INTEGER,
          },
        },
        newText: contents,
      },
    ]);
  }

  function insertLinesAtStart(editor: Editor<'file-diff', undefined>): void {
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'one\ntwo\n',
      },
    ]);
  }

  test('editor completion fires without a component handler and cannot accept', async () => {
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      editorOnComplete(event) {
        if ('fileDiff' in event) {
          events.push(event);
        }
        return 'accept';
      },
    });
    try {
      replaceDocument(fixture.editor, 'alpha\nedited value\nomega\n');
      fixture.editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      expect(events[0]?.editor).toBe(fixture.editor);
      expect(events[0]?.fileDiff.additionLines.join('')).toBe(
        'alpha\nedited value\nomega\n'
      );
      expect(fixture.instance.fileDiff).toBe(fixture.externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('a changed session delivers a recomputed detached diff and complete files', async () => {
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    let completionEditor: Editor<'file-diff', undefined> | undefined;
    let completionState: EditorViewState | undefined;
    let completionEditState: ReturnType<
      Editor<'file-diff', undefined>['getEditState']
    >;
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        events.push(event);
        completionEditor = event.editor;
        completionState = event.editor.getViewState();
        completionEditState = event.editor.getEditState();
        return 'reject';
      },
    });
    const externalBefore = captureExternalDiffState(fixture.externalDiff);
    try {
      const { editor, externalDiff, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.setSelections([
        {
          start: { line: 1, character: 6 },
          end: { line: 1, character: 6 },
          direction: 'none',
        },
      ]);
      const sessionDiff = instance.getLatestDiffForTest();
      if (sessionDiff == null) {
        throw new Error('Expected an active session diff');
      }
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      expect(completionEditor).toBe(editor);
      expect(completionState).toEqual({
        selections: [
          {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 6 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 0 },
      });
      expect(completionEditState?.document.getText()).toBe(
        'alpha\nedited value\nomega\n'
      );
      expect(completionEditState?.editor).toEqual(completionState);
      expect(editor.getEditState()).toBeUndefined();
      const event = events[0];
      expect(event.originalFileDiff).toBe(externalDiff);
      expect(event.fileDiff.cacheKey).toBeUndefined();
      expect(event.fileDiff.editSessionDirty).toBeUndefined();
      expect(event.fileDiff.additionLines.join('')).toBe(
        'alpha\nedited value\nomega\n'
      );
      expect(event.fileDiff.deletionLines.join('')).toBe(
        'alpha\nold value\nomega\n'
      );
      expect(event.fileDiff.hunks.length).toBeGreaterThan(0);
      // The completed diff shares no containers with the external diff or the
      // discarded session diff.
      expect(event.fileDiff).not.toBe(externalDiff);
      expect(event.fileDiff).not.toBe(sessionDiff);
      expect(event.fileDiff.additionLines).not.toBe(externalDiff.additionLines);
      expect(event.fileDiff.additionLines).not.toBe(sessionDiff.additionLines);
      expect(event.fileDiff.deletionLines).not.toBe(externalDiff.deletionLines);
      expect(event.fileDiff.deletionLines).not.toBe(sessionDiff.deletionLines);
      expect(event.fileDiff.hunks).not.toBe(externalDiff.hunks);
      expect(event.fileDiff.hunks).not.toBe(sessionDiff.hunks);

      expect(event.oldFile).toEqual({
        name: 'session.ts',
        contents: 'alpha\nold value\nomega\n',
      });
      expect(event.newFile).toEqual({
        name: 'session.ts',
        contents: 'alpha\nedited value\nomega\n',
      });
      expect(Object.isFrozen(event)).toBe(true);
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning the event fileDiff installs it with the session annotations', async () => {
    const externalAnnotations: DiffLineAnnotation<undefined>[] = [
      { side: 'additions', lineNumber: 2 },
    ];
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete(event) {
        events.push(event);
        event.fileDiff.cacheKey = 'external:session-v2';
        return 'accept';
      },
    });
    try {
      const { editor, instance } = fixture;
      insertLinesAtStart(editor);
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(instance.fileDiff).toBe(event.fileDiff);
      expect(instance.getLatestDiffForTest()).toBe(event.fileDiff);
      expect(instance.fileDiff?.cacheKey).toBe('external:session-v2');
      expect(event.lineAnnotations).toBe(
        instance.getExternalAnnotationsForTest()
      );
      expect(event.originalLineAnnotations).toBe(externalAnnotations);
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { side: 'additions', lineNumber: 4 },
      ]);

      // Settled: calling again does not fire the handler a second time.
      instance.__completeEditSession(editor, 'install');
      expect(events).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  test('a new external annotation mid-session survives a revert', async () => {
    const externalAnnotations: DiffLineAnnotation<undefined>[] = [
      { side: 'additions', lineNumber: 2 },
    ];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete: () => 'reject',
    });
    try {
      const { editor, fileContainer, instance } = fixture;
      insertLinesAtStart(editor);
      const sessionDiff = instance.getLatestDiffForTest();
      if (sessionDiff == null) {
        throw new Error('Expected an active session diff');
      }

      // A fresh external write while editing, trusted at the line given, is
      // the new baseline.
      const added: DiffLineAnnotation<undefined>[] = [
        ...externalAnnotations,
        { side: 'additions', lineNumber: 6 },
      ];
      instance.render({
        fileDiff: sessionDiff,
        fileContainer,
        forceRender: true,
        lineAnnotations: added,
      });
      expect(instance.getExternalAnnotationsForTest()).toBe(added);

      // The changed diff reverts, but the added annotation is kept.
      editor.cleanUp('complete');
      expect(instance.getLatestAnnotationsForTest()).toBe(added);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning null restores the external diff and annotations', async () => {
    const externalAnnotations: DiffLineAnnotation<undefined>[] = [
      { side: 'additions', lineNumber: 2 },
    ];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete: () => 'reject',
    });
    const externalBefore = captureExternalDiffState(fixture.externalDiff);
    try {
      const { editor, externalDiff, instance } = fixture;
      insertLinesAtStart(editor);
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { side: 'additions', lineNumber: 4 },
      ]);
      editor.cleanUp('complete');

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(externalDiff);
      expect(instance.getLatestAnnotationsForTest()).toBe(externalAnnotations);
      expect(externalAnnotations).toEqual([
        { side: 'additions', lineNumber: 2 },
      ]);
      expectExternalDiffUnchanged(instance, externalDiff, externalBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning reject reverts to the external diff', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete: () => 'reject',
    });
    try {
      const { editor, externalDiff, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.cleanUp('complete');

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('a missing handler reverts a changed session', async () => {
    const fixture = await createCompletionFixture();
    try {
      const { editor, externalDiff, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.cleanUp('complete');

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('accepting with the replaced cacheKey throws and reverts', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        event.fileDiff.cacheKey = 'external:session-v1';
        return 'accept';
      },
    });
    try {
      const { editor, externalDiff, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      expect(() => editor.cleanUp('complete')).toThrow(
        'must not reuse the replaced diff cacheKey'
      );

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('a handler exception settles on the external diff and propagates', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete() {
        throw new Error('owner exploded');
      },
    });
    try {
      const { editor, externalDiff, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      expect(() => editor.cleanUp('complete')).toThrow('owner exploded');

      expect(instance.fileDiff).toBe(externalDiff);
      expect(instance.getLatestDiffForTest()).toBe(externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('unchanged contents complete and can accept session annotation writes', async () => {
    const externalAnnotations: DiffLineAnnotation<undefined>[] = [
      { side: 'additions', lineNumber: 2 },
    ];
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete(event) {
        events.push(event);
        return 'accept';
      },
    });
    try {
      const { externalDiff, fileContainer, instance } = fixture;
      const written: DiffLineAnnotation<undefined>[] = [
        { side: 'additions', lineNumber: 1 },
      ];
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
        lineAnnotations: written,
      });
      fixture.editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      expect(events[0].fileDiff.additionLines).toEqual(
        externalDiff.additionLines
      );
      expect(events[0].fileDiff.cacheKey).toBeUndefined();
      expect(instance.fileDiff).toBe(events[0].fileDiff);
      expect(instance.getExternalAnnotationsForTest()).toBe(written);
      expect(instance.getLatestAnnotationsForTest()).toBe(written);
    } finally {
      fixture.cleanup();
    }
  });

  test('editing and undoing back to the external contents still completes', async () => {
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        events.push(event);
        return 'reject';
      },
    });
    try {
      const { editor, externalDiff, instance } = fixture;
      insertLinesAtStart(editor);
      editor.undo();
      expect(editor.getText()).toBe(EXTERNAL_CONTENTS);
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      expect(events[0].fileDiff.additionLines.join('')).toBe(EXTERNAL_CONTENTS);
      expect(events[0].fileDiff.cacheKey).toBeUndefined();
      expect(instance.fileDiff).toBe(externalDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('completion emits no onEditChange', async () => {
    const changeEvents: EditorChangeEvent<'file-diff', undefined, undefined>[] =
      [];
    const fixture = await createCompletionFixture({
      onEditChange: (event) => changeEvents.push(event),
      onEditComplete(event) {
        event.fileDiff.cacheKey = 'external:session-v2';
        return 'accept';
      },
    });
    try {
      const { editor } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      const changesBefore = changeEvents.length;
      editor.cleanUp('complete');
      expect(changeEvents.length).toBe(changesBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('completing with an attached editor throws', async () => {
    const fixture = await createCompletionFixture();
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      expect(() => instance.__completeEditSession(editor, 'install')).toThrow(
        'detach the editor before completing the session'
      );
    } finally {
      fixture.cleanup();
    }
  });

  test('a pair-input caller re-rendering with the event files keeps the accepted diff', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const oldFile: FileContents = {
      name: 'session.ts',
      contents: 'alpha\nold value\nomega\n',
    };
    const newFile: FileContents = {
      name: 'session.ts',
      contents: EXTERNAL_CONTENTS,
    };
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete(event) {
        events.push(event);
        event.fileDiff.cacheKey = 'external:accepted-v1';
        return 'accept';
      },
    });
    const editor = new Editor('file-diff');
    try {
      instance.render({ oldFile, newFile, fileContainer, forceRender: true });
      editor.edit(instance);
      await waitFor(() => editor.getText() === newFile.contents, {
        timeout: 4_000,
      });
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(instance.fileDiff).toBe(event.fileDiff);
      if (event.oldFile == null || event.newFile == null) {
        throw new Error('Expected both completion files for a changed diff');
      }

      // The caller stores the event files and re-renders with them: this must
      // read as the same input, not as a new pair reparsed over the accepted
      // diff.
      instance.render({
        oldFile: event.oldFile,
        newFile: event.newFile,
        fileContainer,
        forceRender: true,
      });
      expect(instance.fileDiff).toBe(event.fileDiff);
      expect(instance.getLatestDiffForTest()).toBe(event.fileDiff);

      // A genuinely different pair later still replaces the accepted diff.
      instance.render({
        oldFile: event.oldFile,
        newFile: { name: 'session.ts', contents: 'brand\nnew\n' },
        fileContainer,
        forceRender: true,
      });
      expect(instance.fileDiff).not.toBe(event.fileDiff);
      expect(instance.fileDiff?.additionLines.join('')).toBe('brand\nnew\n');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a new-file diff completes with a null oldFile', async () => {
    const newFileDiff = parseDiffFromFile(null, {
      name: 'session.ts',
      contents: EXTERNAL_CONTENTS,
    });
    newFileDiff.cacheKey = 'external:new-v1';
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      externalDiff: newFileDiff,
      onEditComplete(event) {
        events.push(event);
        return 'reject';
      },
    });
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.fileDiff.type).toBe('new');
      expect(event.oldFile).toBeNull();
      expect(event.newFile).toEqual({
        name: 'session.ts',
        contents: 'alpha\nedited value\nomega\n',
      });
      expect(instance.fileDiff).toBe(newFileDiff);
    } finally {
      fixture.cleanup();
    }
  });

  test('a partial diff hydrates, edits, and completes with full files', async () => {
    const oldFile: FileContents = {
      name: 'partial.ts',
      contents: 'keep 1\nold value\nkeep 3\nkeep 4\n',
    };
    const newFile: FileContents = {
      name: 'partial.ts',
      contents: 'keep 1\nnew value\nkeep 3\nkeep 4\n',
    };
    const partial = parsePatchFiles(
      createTwoFilesPatch(
        oldFile.name,
        newFile.name,
        oldFile.contents,
        newFile.contents,
        undefined,
        undefined,
        { context: 0 }
      ),
      'partial',
      true
    )[0]?.files[0];
    if (partial == null) {
      throw new Error('Expected the patch to parse into one partial diff');
    }
    expect(partial.isPartial).toBe(true);
    partial.cacheKey = 'external:partial-v1';

    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const fixture = await createCompletionFixture({
      externalDiff: partial,
      loadDiffFiles: () => Promise.resolve({ oldFile, newFile }),
      onEditComplete(event) {
        events.push(event);
        return 'reject';
      },
    });
    try {
      const { editor, instance } = fixture;
      expect(partial.isPartial).toBe(false);
      replaceDocument(editor, 'keep 1\nedited value\nkeep 3\nkeep 4\n');
      editor.cleanUp('complete');

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.originalFileDiff).toBe(partial);
      expect(event.oldFile?.contents).toBe(oldFile.contents);
      expect(event.newFile?.contents).toBe(
        'keep 1\nedited value\nkeep 3\nkeep 4\n'
      );
      // Rejection restores the external diff as hydrated in place.
      expect(instance.fileDiff).toBe(partial);
      expect(instance.fileDiff?.isPartial).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  test('a recycled session keeps final state through later editor cleanup', async () => {
    const completionStates: EditorViewState[] = [];
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        completionStates.push(event.editor.getViewState());
        return 'reject';
      },
    });
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'alpha\nedited value\nomega\n');
      editor.setSelections([
        {
          start: { line: 1, character: 6 },
          end: { line: 1, character: 6 },
          direction: 'none',
        },
      ]);
      editor.cleanUp('recycle');
      instance.cleanUp(true);

      expect(completionStates).toHaveLength(0);
      expect(editor.getViewState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 6 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 0 },
      });

      editor.cleanUp('complete');
      expect(completionStates).toEqual([
        {
          selections: [
            {
              start: { line: 1, character: 6 },
              end: { line: 1, character: 6 },
              direction: 0,
            },
          ],
          view: { scrollLeft: 0 },
        },
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('editor session lifecycle', () => {
  test('the disposer from edit() finishes the session exactly once', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete(event) {
        events.push(event);
        event.fileDiff.cacheKey = 'external:session-v2';
        return 'accept';
      },
    });
    const editor = new Editor('file-diff');
    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });
      const finishSession = editor.edit(instance);
      await waitFor(
        () => editor.getText() === externalDiff.additionLines.join(''),
        { timeout: 4_000 }
      );
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'inserted\n',
        },
      ]);
      finishSession();

      expect(events).toHaveLength(1);
      expect(instance.fileDiff).toBe(events[0].fileDiff);

      finishSession();
      expect(events).toHaveLength(1);
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('editor.cleanUp() completes without installing', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalDiff = createExternalDiff();
    const externalBefore = captureExternalDiffState(externalDiff);
    const events: FileDiffEditCompleteEvent<undefined, undefined>[] = [];
    const instance = new TestFileDiff({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete(event) {
        events.push(event);
        event.fileDiff.cacheKey = 'external:session-v2';
        return 'accept';
      },
    });
    const editor = new Editor('file-diff');
    try {
      instance.render({
        fileDiff: externalDiff,
        fileContainer,
        forceRender: true,
      });
      editor.edit(instance);
      await waitFor(
        () => editor.getText() === externalDiff.additionLines.join(''),
        { timeout: 4_000 }
      );
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'inserted\n',
        },
      ]);
      editor.cleanUp();
      expect(events).toHaveLength(1);

      instance.cleanUp();
      expect(events[0].fileDiff.additionLines.join('')).toBe(
        'inserted\nalpha\nnew value\nomega\n'
      );
      expect(externalDiff).toEqual(externalBefore.value);
    } finally {
      editor.cleanUp();
      dom.cleanup();
    }
  });
});
