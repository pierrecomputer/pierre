import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, File, isFileAnnotationCollection } from '../src';
import type {
  FileEditCompleteEvent,
  FileEditCompleteHandler,
} from '../src/components/File';
import { Editor } from '../src/editor/editor';
import type {
  EditorChangeEvent,
  FileContents,
  LineAnnotation,
} from '../src/types';
import { installDom, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFile extends File<undefined> {
  getLatestFileForTest(): FileContents | undefined {
    return this.getLatestFile();
  }

  getRenderedFileForTest(): FileContents | undefined {
    return this.getRenderedFile();
  }

  getRendererFileForTest(): FileContents | undefined {
    return this.fileRenderer.fileCache;
  }

  getExternalAnnotationsForTest(): LineAnnotation<undefined>[] {
    return this.lineAnnotations;
  }

  getLatestAnnotationsForTest(): LineAnnotation<undefined>[] {
    return this.getLatestAnnotations();
  }
}

const EXTERNAL_FILE: FileContents = {
  name: 'session.ts',
  contents: 'alpha\nbravo\n',
  cacheKey: 'external:file-v1',
};

async function createFixture(options?: {
  lineAnnotations?: LineAnnotation<undefined>[];
  onChange?(
    contents: string,
    lineAnnotations: LineAnnotation<undefined>[] | undefined
  ): void;
}) {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const externalFile = { ...EXTERNAL_FILE };
  const instance = new TestFile({
    disableErrorHandling: true,
    disableFileHeader: true,
  });
  const editor = new Editor<undefined>({
    onChange({ file, lineAnnotations }) {
      options?.onChange?.(
        file.contents,
        lineAnnotations == null || isFileAnnotationCollection(lineAnnotations)
          ? lineAnnotations
          : undefined
      );
    },
  });

  instance.render({
    file: externalFile,
    fileContainer,
    forceRender: true,
    lineAnnotations: options?.lineAnnotations,
  });
  editor.edit(instance);
  await waitFor(() => editor.getText() === externalFile.contents, {
    timeout: 4_000,
  });

  return {
    dom,
    editor,
    externalFile,
    fileContainer,
    instance,
    cleanup() {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    },
  };
}

function replaceDocument(editor: Editor<undefined>, contents: string): void {
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

describe('editing a File without changing its input', () => {
  test('editing methods throw before editing starts', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    const externalFile = { ...EXTERNAL_FILE };
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    try {
      instance.render({ file: externalFile, fileContainer, forceRender: true });
      expect(() =>
        instance.updateRenderCache(new Map([[0, [[0, '', 'edited']]]]), 'dark')
      ).toThrow('File.updateRenderCache: requires an active edit session');
      expect(() =>
        instance.applyDocumentChange({
          lineCount: 1,
          getLineText: () => 'edited',
          getText: () => 'edited',
        })
      ).toThrow('File.applyDocumentChange: requires an active edit session');
      expect(externalFile).toEqual(EXTERNAL_FILE);
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('attaching an editor creates a separate file without a cache key', async () => {
    const fixture = await createFixture();
    try {
      const editSessionFile = fixture.instance.getLatestFileForTest();
      expect(fixture.instance.file).toBe(fixture.externalFile);
      expect(editSessionFile).not.toBe(fixture.externalFile);
      expect(editSessionFile?.cacheKey).toBeUndefined();
      expect(editSessionFile?.contents).toBe(fixture.externalFile.contents);
      expect(fixture.instance.getRenderedFileForTest()).toBe(editSessionFile);
      expect(fixture.instance.getRendererFileForTest()).toBe(editSessionFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('edits and annotation renders never change the external file', async () => {
    const fixture = await createFixture();
    const externalBefore = structuredClone(fixture.externalFile);
    try {
      replaceDocument(fixture.editor, 'edited\nbravo\ncharlie\n');
      expect(fixture.editor.getFile()?.cacheKey).toBeUndefined();

      fixture.instance.render({
        file: fixture.externalFile,
        fileContainer: fixture.fileContainer,
        forceRender: true,
        lineAnnotations: [{ lineNumber: 2, metadata: undefined }],
      });

      await waitFor(() => {
        const text = fixture.fileContainer.shadowRoot?.textContent ?? '';
        return (
          text.includes('edited') &&
          text.includes('charlie') &&
          fixture.fileContainer.shadowRoot?.querySelector(
            '[data-line-annotation]'
          ) != null
        );
      });
      const renderedText = fixture.fileContainer.shadowRoot?.textContent ?? '';
      expect(renderedText).toContain('edited');
      expect(renderedText).toContain('charlie');
      expect(
        fixture.fileContainer.shadowRoot?.querySelector(
          '[data-line-annotation]'
        )
      ).not.toBeNull();
      expect(fixture.instance.getLatestFileForTest()?.contents).toBe(
        'edited\nbravo\ncharlie\n'
      );
      expect(fixture.instance.getRendererFileForTest()).toBe(
        fixture.instance.getLatestFileForTest()
      );
      expect(fixture.externalFile).toEqual(externalBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('synchronously rendering moved annotations observes the edited document', async () => {
    let contents = EXTERNAL_FILE.contents;
    let lineAnnotations: LineAnnotation<undefined>[] = [
      { lineNumber: 2, metadata: undefined },
    ];
    const fixture = await createFixture({
      lineAnnotations,
      onChange(nextContents, nextLineAnnotations) {
        contents = nextContents;
        lineAnnotations = nextLineAnnotations ?? [];
        fixture.instance.render({
          file: fixture.externalFile,
          fileContainer: fixture.fileContainer,
          forceRender: true,
          lineAnnotations,
        });
      },
    });

    try {
      fixture.editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '\n\n',
        },
      ]);

      expect(lineAnnotations).toEqual([{ lineNumber: 4, metadata: undefined }]);
      expect(contents).toBe('\n\nalpha\nbravo\n');
      expect(fixture.editor.getText()).toBe('\n\nalpha\nbravo\n');
      expect(
        fixture.fileContainer.shadowRoot?.querySelector('[data-line="4"]')
      ).not.toBeNull();
      expect(
        fixture.fileContainer.shadowRoot?.querySelector(
          '[data-line-annotation]'
        )
      ).not.toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  test('rendering another file with the same cache key preserves current edits', async () => {
    const fixture = await createFixture();
    try {
      replaceDocument(fixture.editor, 'edited\n');
      const editSessionFile = fixture.instance.getLatestFileForTest();

      fixture.instance.render({
        file: { ...fixture.externalFile },
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });

      expect(fixture.instance.file).toBe(fixture.externalFile);
      expect(fixture.instance.getLatestFileForTest()).toBe(editSessionFile);
      expect(fixture.editor.getText()).toBe('edited\n');
      expect(fixture.externalFile).toEqual(EXTERNAL_FILE);
    } finally {
      fixture.cleanup();
    }
  });

  test('replacing the file contents can be undone as one change', async () => {
    const changes: string[] = [];
    const fixture = await createFixture({
      onChange: (contents) => changes.push(contents),
    });
    const initialBefore = structuredClone(fixture.externalFile);
    const replacement: FileContents = {
      name: 'session.ts',
      contents: 'charlie\n',
      cacheKey: 'external:file-v2',
    };
    const replacementBefore = structuredClone(replacement);

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      fixture.instance.render({
        file: replacement,
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });
      await waitFor(() => fixture.editor.getText() === 'charlie\n', {
        timeout: 4_000,
      });

      expect(fixture.instance.file).toBe(replacement);
      expect(fixture.instance.getLatestFileForTest()).not.toBe(replacement);
      expect(fixture.instance.getLatestFileForTest()?.cacheKey).toBeUndefined();
      expect(changes).toEqual(['bravo\n', 'charlie\n']);

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\nbravo\n');
      expect(fixture.externalFile).toEqual(initialBefore);
      expect(replacement).toEqual(replacementBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('a file-name change that is replaced immediately does not clear undo history', async () => {
    const changes: string[] = [];
    const fixture = await createFixture({
      onChange: (contents) => changes.push(contents),
    });
    const intermediate: FileContents = {
      name: 'intermediate.js',
      contents: 'intermediate\n',
      cacheKey: 'external:file-v2',
    };
    const replacement: FileContents = {
      name: EXTERNAL_FILE.name,
      contents: 'charlie\n',
      cacheKey: 'external:file-v3',
    };

    try {
      replaceDocument(fixture.editor, 'bravo\n');
      fixture.instance.render({
        file: intermediate,
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });
      fixture.instance.render({
        file: replacement,
        fileContainer: fixture.fileContainer,
        forceRender: true,
      });
      await waitFor(() => fixture.editor.getText() === 'charlie\n', {
        timeout: 4_000,
      });

      expect(changes).toEqual(['bravo\n', 'charlie\n']);
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('bravo\n');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe(EXTERNAL_FILE.contents);
    } finally {
      fixture.cleanup();
    }
  });

  test('changing the file name or language clears undo history', async () => {
    for (const replacement of [
      {
        name: 'renamed.ts',
        contents: 'charlie\n',
        cacheKey: 'external:renamed',
      },
      {
        name: 'session.ts',
        lang: 'javascript' as const,
        contents: 'charlie\n',
        cacheKey: 'external:javascript',
      },
    ]) {
      const fixture = await createFixture();
      try {
        replaceDocument(fixture.editor, 'bravo\n');
        fixture.instance.render({
          file: replacement,
          fileContainer: fixture.fileContainer,
          forceRender: true,
        });
        await waitFor(() => fixture.editor.getText() === 'charlie\n', {
          timeout: 4_000,
        });
        expect(fixture.editor.canUndo).toBe(false);
        expect(fixture.editor.canRedo).toBe(false);
      } finally {
        fixture.cleanup();
      }
    }
  });
});

describe('component onEditChange', () => {
  test('receives the exact event the editor emits, alongside editor onChange', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const editorEvents: EditorChangeEvent<undefined, 'file' | 'diff'>[] = [];
    const componentEvents: EditorChangeEvent<undefined, 'file'>[] = [];
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditChange: (event) => componentEvents.push(event),
    });
    const editor = new Editor<undefined>({
      onChange: (event) => editorEvents.push(event),
    });
    try {
      instance.render({ file: externalFile, fileContainer, forceRender: true });
      editor.edit(instance);
      await waitFor(() => editor.getText() === externalFile.contents, {
        timeout: 4_000,
      });
      replaceDocument(editor, 'edited\n');
      expect(editorEvents).toHaveLength(1);
      expect(componentEvents).toHaveLength(1);
      expect(componentEvents[0]).toBe(editorEvents[0]);
      expect(componentEvents[0]?.file.contents).toBe('edited\n');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('fires without an editor onChange and setOptions swaps the live handler', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const firstEvents: EditorChangeEvent<undefined, 'file'>[] = [];
    const secondEvents: EditorChangeEvent<undefined, 'file'>[] = [];
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditChange: (event) => firstEvents.push(event),
    });
    const editor = new Editor<undefined>({});
    try {
      instance.render({ file: externalFile, fileContainer, forceRender: true });
      editor.edit(instance);
      await waitFor(() => editor.getText() === externalFile.contents, {
        timeout: 4_000,
      });
      replaceDocument(editor, 'first\n');
      expect(firstEvents).toHaveLength(1);
      instance.setOptions({
        disableErrorHandling: true,
        disableFileHeader: true,
        onEditChange: (event) => secondEvents.push(event),
      });
      replaceDocument(editor, 'second\n');
      expect(firstEvents).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);
      expect(secondEvents[0]?.file.contents).toBe('second\n');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a recycle detach and reattach keeps the resumed session reporting', async () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const events: EditorChangeEvent<undefined, 'file'>[] = [];
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditChange: (event) => events.push(event),
    });
    const editor = new Editor<undefined>({});
    try {
      instance.render({ file: externalFile, fileContainer, forceRender: true });
      editor.edit(instance);
      await waitFor(() => editor.getText() === externalFile.contents, {
        timeout: 4_000,
      });
      replaceDocument(editor, 'first\n');
      expect(events).toHaveLength(1);

      editor.cleanUp(true);
      editor.edit(instance);
      await waitFor(() => editor.getText() === 'first\n', { timeout: 4_000 });
      replaceDocument(editor, 'second\n');
      expect(events).toHaveLength(2);
      expect(events[1]?.file.contents).toBe('second\n');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });
});

describe('session-owned line annotations', () => {
  async function createAnnotatedFixture() {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const externalAnnotations: LineAnnotation<undefined>[] = [
      { lineNumber: 2 },
    ];
    const events: EditorChangeEvent<undefined, 'file'>[] = [];
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditChange: (event) => events.push(event),
    });
    const editor = new Editor<undefined>({});
    instance.render({
      file: externalFile,
      fileContainer,
      forceRender: true,
      lineAnnotations: externalAnnotations,
    });
    editor.edit(instance);
    await waitFor(() => editor.getText() === externalFile.contents, {
      timeout: 4_000,
    });
    return {
      dom,
      editor,
      events,
      externalAnnotations,
      externalFile,
      fileContainer,
      instance,
      cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        dom.cleanup();
      },
    };
  }

  function insertLineAtStart(editor: Editor<undefined>): void {
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'inserted\n',
      },
    ]);
  }

  // Read the rendered annotation row: the slot it exposes and the data-line of
  // the code row it sits under.
  function annotationRowInfo(fileContainer: HTMLElement): {
    slotName: string | undefined;
    dataLine: string | undefined;
  } {
    const row = fileContainer.shadowRoot?.querySelector(
      '[data-line-annotation]'
    );
    const slotName = row?.querySelector('slot')?.getAttribute('name');
    const line = row?.previousElementSibling;
    return {
      slotName: slotName ?? undefined,
      dataLine: line instanceof HTMLElement ? line.dataset.line : undefined,
    };
  }

  test('a remap moves only the private session collection', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, events, externalAnnotations, instance } = fixture;
      insertLineAtStart(editor);

      const latest = instance.getLatestAnnotationsForTest();
      expect(latest).not.toBe(externalAnnotations);
      expect(latest).toEqual([{ lineNumber: 3 }]);
      expect(instance.getExternalAnnotationsForTest()).toBe(
        externalAnnotations
      );
      expect(externalAnnotations).toEqual([{ lineNumber: 2 }]);
      expect(events.at(-1)?.lineAnnotations).toBe(latest);
    } finally {
      fixture.cleanup();
    }
  });

  test('a stale caller collection re-render does not move annotations', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, externalAnnotations, externalFile, fileContainer } =
        fixture;
      insertLineAtStart(editor);
      const latest = fixture.instance.getLatestAnnotationsForTest();

      fixture.instance.render({
        file: externalFile,
        fileContainer,
        forceRender: true,
        lineAnnotations: externalAnnotations,
      });

      expect(fixture.instance.getLatestAnnotationsForTest()).toBe(latest);
      expect(annotationRowInfo(fileContainer).dataLine).toBe('3');
    } finally {
      fixture.cleanup();
    }
  });

  test('frozen slot names keep projection while annotation rows move', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, fileContainer, instance } = fixture;
      const before = annotationRowInfo(fileContainer);
      expect(before.slotName).toBe('annotation-2');
      expect(before.dataLine).toBe('2');

      insertLineAtStart(editor);

      const after = annotationRowInfo(fileContainer);
      expect(after.slotName).toBe('annotation-2');
      expect(after.dataLine).toBe('3');
      const moved = instance.getLatestAnnotationsForTest().at(0);
      if (moved == null) {
        throw new Error('Expected the remapped annotation to survive');
      }
      expect(moved.lineNumber).toBe(3);
      expect(instance.getAnnotationSlotName(moved)).toBe('annotation-2');
    } finally {
      fixture.cleanup();
    }
  });

  test('an annotation-only write mid-session lands in session space', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, externalAnnotations, externalFile, fileContainer } =
        fixture;
      insertLineAtStart(editor);

      const written: LineAnnotation<undefined>[] = [{ lineNumber: 1 }];
      fixture.instance.render({
        file: externalFile,
        fileContainer,
        forceRender: true,
        lineAnnotations: written,
      });

      expect(fixture.instance.getLatestAnnotationsForTest()).toBe(written);
      expect(fixture.instance.getExternalAnnotationsForTest()).toBe(
        externalAnnotations
      );
      const single = written.at(0);
      if (single == null) {
        throw new Error('Expected the written annotation to exist');
      }
      expect(fixture.instance.getAnnotationSlotName(single)).toBe(
        'annotation-1'
      );
    } finally {
      fixture.cleanup();
    }
  });

  test('an external replacement with annotations rebaselines both collections', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { fileContainer, instance } = fixture;
      insertLineAtStart(fixture.editor);
      const moved = instance.getLatestAnnotationsForTest().at(0);
      if (moved == null) {
        throw new Error('Expected the remapped annotation to survive');
      }

      const replacementFile: FileContents = {
        name: EXTERNAL_FILE.name,
        contents: 'delta\nepsilon\nzeta\n',
        cacheKey: 'external:file-v2',
      };
      const replacementAnnotations: LineAnnotation<undefined>[] = [
        moved,
        { lineNumber: 1 },
      ];
      instance.render({
        file: replacementFile,
        fileContainer,
        forceRender: true,
        lineAnnotations: replacementAnnotations,
      });

      expect(instance.getExternalAnnotationsForTest()).toBe(
        replacementAnnotations
      );
      expect(instance.getLatestAnnotationsForTest()).toBe(
        replacementAnnotations
      );
      // A surviving annotation keeps the name the outgoing session resolved
      // for it — light-DOM content committed under that name stays projected
      // — while the new annotation freezes at its arrival position.
      expect(instance.getAnnotationSlotName(moved)).toBe('annotation-2');
      const added = replacementAnnotations.at(1);
      if (added == null) {
        throw new Error('Expected the added annotation to exist');
      }
      expect(instance.getAnnotationSlotName(added)).toBe('annotation-1');
    } finally {
      fixture.cleanup();
    }
  });

  test('deleting an annotated line drops it from the session collection only', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, externalAnnotations, instance } = fixture;
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: '',
        },
      ]);

      expect(instance.getLatestAnnotationsForTest()).toEqual([]);
      expect(externalAnnotations).toEqual([{ lineNumber: 2 }]);
      expect(instance.getExternalAnnotationsForTest()).toBe(
        externalAnnotations
      );
    } finally {
      fixture.cleanup();
    }
  });

  // Edits that move or drop annotations record the collection on both sides
  // of the edit, so history replays annotations together with the text.
  test('undo restores an annotation dropped with its deleted line and redo drops it again', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, externalFile, instance } = fixture;
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: '',
        },
      ]);
      expect(instance.getLatestAnnotationsForTest()).toEqual([]);

      editor.undo();
      expect(editor.getText()).toBe(externalFile.contents);
      const restored = instance.getLatestAnnotationsForTest().at(0);
      if (restored == null) {
        throw new Error('Expected undo to restore the dropped annotation');
      }
      expect(restored.lineNumber).toBe(2);
      // The restored collection holds the session's own annotation objects,
      // so the frozen slot name still resolves and slotted content stays
      // projected across the round trip.
      expect(instance.getAnnotationSlotName(restored)).toBe('annotation-2');

      editor.redo();
      expect(instance.getLatestAnnotationsForTest()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  // Caller writes are not history entries: undoing an edit replays the
  // collection recorded at that edit, which predates the write. Annotations
  // written mid-session disappear when history rewinds past their write
  // point, and redo replays the edit's own collection without them.
  test('undoing a pre-write edit discards a caller-written annotation', async () => {
    const fixture = await createAnnotatedFixture();
    try {
      const { editor, externalFile, fileContainer, instance } = fixture;
      insertLineAtStart(editor);
      const live = instance.getLatestAnnotationsForTest();
      expect(live).toEqual([{ lineNumber: 3 }]);

      const written: LineAnnotation<undefined>[] = [...live, { lineNumber: 1 }];
      instance.render({
        file: externalFile,
        fileContainer,
        forceRender: true,
        lineAnnotations: written,
      });
      expect(instance.getLatestAnnotationsForTest()).toBe(written);

      editor.undo();
      expect(editor.getText()).toBe(externalFile.contents);
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { lineNumber: 2 },
      ]);

      editor.redo();
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { lineNumber: 3 },
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('completeEditSession', () => {
  async function createCompletionFixture(config?: {
    onEditComplete?: FileEditCompleteHandler<undefined>;
    onEditChange?: (event: EditorChangeEvent<undefined, 'file'>) => void;
    lineAnnotations?: LineAnnotation<undefined>[];
  }) {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete: config?.onEditComplete,
      onEditChange: config?.onEditChange,
    });
    const editor = new Editor<undefined>({});
    instance.render({
      file: externalFile,
      fileContainer,
      forceRender: true,
      lineAnnotations: config?.lineAnnotations,
    });
    editor.edit(instance);
    await waitFor(() => editor.getText() === externalFile.contents, {
      timeout: 4_000,
    });
    return {
      editor,
      externalFile,
      fileContainer,
      instance,
      detach() {
        editor.cleanUp();
      },
      cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        dom.cleanup();
      },
    };
  }

  function insertLinesAtStart(editor: Editor<undefined>): void {
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

  test('a changed session delivers a fresh keyless file and the exact external file', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      instance.completeEditSession();

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.file.contents).toBe('edited\nbravo\n');
      expect(event.file.cacheKey).toBeUndefined();
      expect(event.file).not.toBe(externalFile);
      expect(event.originalFile).toBe(externalFile);
      expect(externalFile.contents).toBe(EXTERNAL_FILE.contents);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning the event file installs it with the session annotations', async () => {
    const externalAnnotations: LineAnnotation<undefined>[] = [
      { lineNumber: 2 },
    ];
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete(event) {
        events.push(event);
        event.file.cacheKey = 'external:file-v2';
        return event.file;
      },
    });
    try {
      const { editor, instance } = fixture;
      insertLinesAtStart(editor);
      fixture.detach();
      instance.completeEditSession();

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(instance.file).toBe(event.file);
      expect(instance.getLatestFileForTest()).toBe(event.file);
      expect(instance.file?.cacheKey).toBe('external:file-v2');
      expect(event.lineAnnotations).toBe(
        instance.getExternalAnnotationsForTest()
      );
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { lineNumber: 4 },
      ]);

      // Settled: calling again does not fire the handler a second time.
      instance.completeEditSession();
      expect(events).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning null restores the external file and annotations', async () => {
    const externalAnnotations: LineAnnotation<undefined>[] = [
      { lineNumber: 2 },
    ];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete: () => null,
    });
    try {
      const { editor, externalFile, instance } = fixture;
      insertLinesAtStart(editor);
      expect(instance.getLatestAnnotationsForTest()).toEqual([
        { lineNumber: 4 },
      ]);
      fixture.detach();
      instance.completeEditSession();

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
      expect(instance.getLatestAnnotationsForTest()).toBe(externalAnnotations);
      expect(externalAnnotations).toEqual([{ lineNumber: 2 }]);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning the exact originalFile reverts like null', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete: (event) => event.originalFile,
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      instance.completeEditSession();

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('a missing handler reverts a changed session', async () => {
    const fixture = await createCompletionFixture();
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      instance.completeEditSession();

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('returning a clone throws and still settles on the external file', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete: (event) => ({ ...event.file }),
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      expect(() => instance.completeEditSession()).toThrow(
        'onEditComplete must return null, the event file, or the event originalFile'
      );

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
      // Settled: a second call has no session left to complete.
      instance.completeEditSession();
    } finally {
      fixture.cleanup();
    }
  });

  test('accepting with the replaced cacheKey throws and reverts', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        event.file.cacheKey = EXTERNAL_FILE.cacheKey;
        return event.file;
      },
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      expect(() => instance.completeEditSession()).toThrow(
        'must not reuse the replaced file cacheKey'
      );

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('a handler exception settles on the external file and propagates', async () => {
    const fixture = await createCompletionFixture({
      onEditComplete() {
        throw new Error('owner exploded');
      },
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      expect(() => instance.completeEditSession()).toThrow('owner exploded');

      expect(instance.file).toBe(externalFile);
      expect(instance.getLatestFileForTest()).toBe(externalFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('unchanged contents skip the handler and keep session annotation writes', async () => {
    const externalAnnotations: LineAnnotation<undefined>[] = [
      { lineNumber: 2 },
    ];
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createCompletionFixture({
      lineAnnotations: externalAnnotations,
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { externalFile, fileContainer, instance } = fixture;
      const written: LineAnnotation<undefined>[] = [{ lineNumber: 1 }];
      instance.render({
        file: externalFile,
        fileContainer,
        forceRender: true,
        lineAnnotations: written,
      });
      fixture.detach();
      instance.completeEditSession();

      expect(events).toHaveLength(0);
      expect(instance.file).toBe(externalFile);
      expect(instance.getExternalAnnotationsForTest()).toBe(written);
      expect(instance.getLatestAnnotationsForTest()).toBe(written);
    } finally {
      fixture.cleanup();
    }
  });

  test('editing and undoing back to the external contents does not complete', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, externalFile, instance } = fixture;
      insertLinesAtStart(editor);
      editor.undo();
      expect(editor.getText()).toBe(externalFile.contents);
      fixture.detach();
      instance.completeEditSession();

      expect(events).toHaveLength(0);
      expect(instance.file).toBe(externalFile);
    } finally {
      fixture.cleanup();
    }
  });

  test('completion emits no onEditChange', async () => {
    const changeEvents: EditorChangeEvent<undefined, 'file'>[] = [];
    const fixture = await createCompletionFixture({
      onEditChange: (event) => changeEvents.push(event),
      onEditComplete(event) {
        event.file.cacheKey = 'external:file-v2';
        return event.file;
      },
    });
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      fixture.detach();
      const changesBefore = changeEvents.length;
      instance.completeEditSession();
      expect(changeEvents.length).toBe(changesBefore);
    } finally {
      fixture.cleanup();
    }
  });

  test('completing with an attached editor throws', async () => {
    const fixture = await createCompletionFixture();
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      expect(() => instance.completeEditSession()).toThrow(
        'detach the editor before completing the session'
      );
    } finally {
      fixture.cleanup();
    }
  });

  test('a replacement accepted mid-session becomes the event originalFile', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createCompletionFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, fileContainer, instance } = fixture;
      const replacementFile: FileContents = {
        name: EXTERNAL_FILE.name,
        contents: 'replaced\nbravo\n',
        cacheKey: 'external:file-v2',
      };
      instance.render({
        file: replacementFile,
        fileContainer,
        forceRender: true,
      });
      await waitFor(() => editor.getText() === replacementFile.contents, {
        timeout: 4_000,
      });
      replaceDocument(editor, 'edited again\nbravo\n');
      fixture.detach();
      instance.completeEditSession();

      expect(events).toHaveLength(1);
      expect(events[0].originalFile).toBe(replacementFile);
      expect(instance.file).toBe(replacementFile);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('editor session lifecycle', () => {
  async function createLifecycleFixture(config?: {
    onEditComplete?: FileEditCompleteHandler<undefined>;
  }) {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete: config?.onEditComplete,
    });
    const editor = new Editor<undefined>({});
    instance.render({ file: externalFile, fileContainer, forceRender: true });
    const finishSession = editor.edit(instance);
    await waitFor(() => editor.getText() === externalFile.contents, {
      timeout: 4_000,
    });
    return {
      editor,
      externalFile,
      fileContainer,
      finishSession,
      instance,
      cleanup() {
        editor.cleanUp();
        instance.cleanUp();
        dom.cleanup();
      },
    };
  }

  test('the disposer from edit() finishes the session exactly once', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createLifecycleFixture({
      onEditComplete(event) {
        events.push(event);
        event.file.cacheKey = 'external:file-v2';
        return event.file;
      },
    });
    try {
      const { editor, finishSession, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      finishSession();

      expect(events).toHaveLength(1);
      expect(instance.file).toBe(events[0].file);
      expect(instance.getLatestFileForTest()).toBe(events[0].file);

      finishSession();
      expect(events).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  test('editor.cleanUp() tears down without finishing the session', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createLifecycleFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      editor.cleanUp();

      expect(events).toHaveLength(0);
      // The session survives the silent teardown.
      expect(instance.getLatestFileForTest()?.contents).toBe('edited\nbravo\n');
    } finally {
      fixture.cleanup();
    }
  });

  test('a recycle keeps the session and a later disposer finishes it once', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const dom = installDom();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const externalFile = { ...EXTERNAL_FILE };
    const instance = new TestFile({
      disableErrorHandling: true,
      disableFileHeader: true,
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    let attachCount = 0;
    const editor = new Editor<undefined>({
      onAttach: () => {
        attachCount += 1;
      },
    });
    try {
      instance.render({ file: externalFile, fileContainer, forceRender: true });
      editor.edit(instance);
      await waitFor(() => attachCount === 1, { timeout: 4_000 });
      replaceDocument(editor, 'first\n');
      editor.cleanUp(true);
      expect(events).toHaveLength(0);
      expect(instance.getLatestFileForTest()?.contents).toBe('first\n');

      const finishResumed = editor.edit(instance);
      await waitFor(() => attachCount === 2, { timeout: 4_000 });
      replaceDocument(editor, 'first\nsecond\n');
      finishResumed();

      expect(events).toHaveLength(1);
      expect(events[0].file.contents).toBe('first\nsecond\n');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('component cleanUp finishes a changed session without installing the result', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createLifecycleFixture({
      onEditComplete(event) {
        events.push(event);
        event.file.cacheKey = 'external:file-v2';
        return event.file;
      },
    });
    try {
      const { editor, externalFile, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      instance.cleanUp();

      expect(events).toHaveLength(1);
      expect(events[0].file.contents).toBe('edited\nbravo\n');
      expect(events[0].originalFile).toBe(externalFile);
      expect(externalFile.contents).toBe(EXTERNAL_FILE.contents);
    } finally {
      fixture.cleanup();
    }
  });

  test('component cleanUp after the disposer already finished stays silent', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createLifecycleFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, finishSession, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      finishSession();
      expect(events).toHaveLength(1);

      instance.cleanUp();
      expect(events).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  test('recycle cleanUp of the component keeps the session silent', async () => {
    const events: FileEditCompleteEvent<undefined>[] = [];
    const fixture = await createLifecycleFixture({
      onEditComplete(event) {
        events.push(event);
        return null;
      },
    });
    try {
      const { editor, instance } = fixture;
      replaceDocument(editor, 'edited\nbravo\n');
      editor.cleanUp(true);
      instance.cleanUp(true);

      expect(events).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });
});
