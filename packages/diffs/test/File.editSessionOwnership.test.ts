import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, File, isFileAnnotationCollection } from '../src';
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
    const editorEvents: EditorChangeEvent<undefined>[] = [];
    const componentEvents: EditorChangeEvent<undefined>[] = [];
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
    const firstEvents: EditorChangeEvent<undefined>[] = [];
    const secondEvents: EditorChangeEvent<undefined>[] = [];
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
    const events: EditorChangeEvent<undefined>[] = [];
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
