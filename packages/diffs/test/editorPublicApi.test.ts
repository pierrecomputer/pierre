import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import {
  Editor,
  type EditorFocusOptions,
  type EditorOptions,
} from '../src/editor/editor';
import type { Marker } from '../src/editor/marker';
import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffsEditableComponent,
  FileContents,
  FileDiffMetadata,
  LineAnnotation,
} from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = Array.from(
      container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ??
        []
    ).find(
      (element) =>
        element.contentEditable === 'true' ||
        element.getAttribute('contenteditable') === 'true'
    );
    if (content != null) {
      return content;
    }
    await wait(0);
  }

  throw new Error('editor content did not become editable');
}

interface EditorFixture {
  cleanup(): void;
  complete(): void;
  container: HTMLElement;
  content: HTMLElement;
  editor: Editor<undefined>;
  file: File<undefined>;
}

class TestFileDiff extends FileDiff<undefined> {
  getCurrentType(): FileDiffMetadata['type'] | undefined {
    return this.getLatestDiff()?.type;
  }
}

interface DiffEditorFixture {
  cleanup(): void;
  complete(): void;
  container: HTMLElement;
  content: HTMLElement;
  editor: Editor<undefined>;
  fileDiff: TestFileDiff;
}

interface PendingEditorFixture {
  cleanup(): void;
  complete(): void;
  editor: Editor<undefined>;
}

// Mounts a real File-backed editor, mirroring the harness the applyEdits and
// marker suites use, and returns the editor plus its contenteditable element.
async function createEditorFixture(
  contents: string,
  editorOptions?: EditorOptions<undefined>,
  lineAnnotations?: LineAnnotation<undefined>[],
  documentKey?: string,
  fileInfo: Pick<FileContents, 'lang' | 'name'> = { name: 'edits.ts' }
): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>('file', editorOptions, documentKey);
  const initialFile: FileContents = { ...fileInfo, contents };

  file.render({
    file: initialFile,
    fileContainer,
    forceRender: true,
    lineAnnotations,
  });
  const complete = editor.edit(file);

  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    complete,
    container: fileContainer,
    content,
    editor,
    file,
  };
}

function createKeyedEditorFixture(
  contents: string,
  documentKey: string,
  lineAnnotations?: LineAnnotation<undefined>[],
  fileInfo?: Pick<FileContents, 'lang' | 'name'>
): Promise<EditorFixture> {
  return createEditorFixture(
    contents,
    undefined,
    lineAnnotations,
    documentKey,
    fileInfo
  );
}

function createPendingEditorFixture(
  contents: string,
  documentKey: string
): PendingEditorFixture {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>('file', {}, documentKey);
  file.render({
    file: { name: 'edits.ts', contents },
    fileContainer,
    forceRender: true,
  });
  const complete = editor.edit(file);
  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    complete,
    editor,
  };
}

async function createDiffEditorFixture(
  diffStyle: 'split' | 'unified',
  editorOptions?: EditorOptions<undefined>,
  documentKey?: string,
  newContents = 'alpha\nnew\ncharlie',
  files?: { oldFile: FileContents; newFile: FileContents }
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new TestFileDiff({
    disableFileHeader: true,
    diffStyle,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>('file-diff', editorOptions, documentKey);
  fileDiff.render({
    oldFile:
      files?.oldFile ??
      ({
        name: 'edits.ts',
        contents: 'alpha\nold\ncharlie',
      } satisfies FileContents),
    newFile:
      files?.newFile ??
      ({ name: 'edits.ts', contents: newContents } satisfies FileContents),
    fileContainer: container,
    forceRender: true,
  });
  let complete: () => void;
  try {
    complete = editor.edit(fileDiff);
  } catch (error) {
    editor.cleanUp();
    fileDiff.cleanUp();
    dom.cleanup();
    throw error;
  }

  const content = await waitForEditableContent(container);
  return {
    cleanup() {
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
    complete,
    container,
    content,
    editor,
    fileDiff,
  };
}

function setEditorViewport(
  file: DiffsEditableComponent<undefined>,
  viewport: HTMLElement | Document
): void {
  file.getEditorViewport = () => viewport;
}

function setRect(element: Element, top: number, bottom: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        bottom,
        height: bottom - top,
        left: 0,
        right: 100,
        top,
        width: 100,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      }) as DOMRect,
  });
}

function getLineRows(content: HTMLElement): HTMLElement[] {
  return Array.from(content.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.line != null
  );
}

function insertText(
  editor: Editor<undefined>,
  line: number,
  character: number,
  text: string,
  updateHistory = true
): void {
  editor.applyEdits(
    [
      {
        range: {
          start: { line, character },
          end: { line, character },
        },
        newText: text,
      },
    ],
    updateHistory
  );
}

function markerPopover(content: HTMLElement): HTMLElement | null {
  return (content.getRootNode() as ShadowRoot).querySelector(
    '[data-marker-popover]'
  );
}

// Hovers the marker over `oneIndexedLine` by dispatching a mouseover whose
// composedPath points at that row's first tokenized span, matching the marker
// popover suite (jsdom does not report composedPath across the shadow boundary).
function hoverMarkerLine(content: HTMLElement, oneIndexedLine: number): void {
  const lineElement = Array.from(
    content.querySelectorAll<HTMLElement>('[data-line]')
  ).find((el) => el.dataset.line === String(oneIndexedLine));
  const charSpan = lineElement?.querySelector<HTMLElement>('[data-char]');
  if (charSpan == null) {
    throw new Error(`no tokenized span found on line ${oneIndexedLine}`);
  }
  const event = new Event('mouseover', { bubbles: true, composed: true });
  Object.defineProperty(event, 'composedPath', { value: () => [charSpan] });
  content.dispatchEvent(event);
}

describe('Editor document registry surfaces', () => {
  test('a retained document repaints a File surface', async () => {
    Editor.clearDocuments();
    const documentKey = 'file-surface';
    const first = await createKeyedEditorFixture(
      'alpha\nbravo\ncharlie',
      documentKey
    );
    insertText(first.editor, 1, 5, ' retained');
    const editedText = first.editor.getText();
    first.cleanup();

    const second = await createKeyedEditorFixture(
      'new external baseline',
      documentKey
    );
    try {
      expect(second.editor.getText()).toBe(editedText);
      await waitFor(() =>
        Boolean(
          second.container.shadowRoot?.textContent?.includes('bravo retained')
        )
      );
      expect(second.container.shadowRoot?.textContent).toContain(
        'bravo retained'
      );
      second.file.render({
        file: { name: 'edits.ts', contents: 'external replacement' },
        fileContainer: second.container,
        forceRender: true,
      });
      await waitFor(() => second.editor.getText() === 'external replacement');
      second.editor.undo();
      expect(second.editor.getText()).toBe(editedText);
      second.editor.undo();
      expect(second.editor.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      second.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a File adopts retained name and explicit language with its text', async () => {
    Editor.clearDocuments();
    const documentKey = 'file-identity';
    const retainedFile = {
      name: 'retained.txt',
      lang: 'typescript',
    } as const;
    const first = await createKeyedEditorFixture(
      'const retained = true;',
      documentKey,
      undefined,
      retainedFile
    );
    insertText(first.editor, 0, 22, '\n');
    const retainedContents = first.editor.getText();
    first.cleanup();

    const cloneForAnnotations = spyOn(
      TextDocument.prototype,
      'cloneForAnnotations'
    );
    let second: EditorFixture | undefined;
    try {
      second = await createKeyedEditorFixture(
        'incoming baseline',
        documentKey,
        undefined,
        { name: 'incoming.txt', lang: 'text' }
      );
      const adoptedDocument = cloneForAnnotations.mock.results.at(-1)?.value as
        | TextDocument<unknown>
        | undefined;
      expect(adoptedDocument?.uri).toBe('file:///retained.txt');
      expect(adoptedDocument?.languageId).toBe(retainedFile.lang);
      expect(second.editor.getFile()).toEqual({
        ...retainedFile,
        contents: retainedContents,
      });
      expect(second.content.ariaLabel).toBe(retainedFile.name);
      second.file.render({
        file: {
          ...retainedFile,
          contents: 'const external = true;',
        },
        fileContainer: second.container,
        forceRender: true,
      });
      await waitFor(
        () => second?.editor.getText() === 'const external = true;'
      );
      second.editor.undo();
      expect(second.editor.getText()).toBe(retainedContents);
      await waitFor(
        () => (second?.content.querySelectorAll('span[style]').length ?? 0) > 0
      );
      second.editor.undo();
      expect(second.editor.getText()).toBe('const retained = true;');
      second.editor.redo();
      expect(second.editor.getText()).toBe(retainedContents);
      second.editor.redo();
      expect(second.editor.getText()).toBe('const external = true;');
    } finally {
      cloneForAnnotations.mockRestore();
      second?.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a File retains annotation history without diff sides', async () => {
    Editor.clearDocuments();
    const documentKey = 'file-annotations';
    const first = await createKeyedEditorFixture('alpha\nbravo', documentKey, [
      { lineNumber: 2, metadata: undefined },
    ]);
    insertText(first.editor, 0, 0, 'inserted\n');
    first.cleanup();

    const second = await createKeyedEditorFixture('alpha\nbravo', documentKey, [
      { lineNumber: 3, metadata: undefined },
    ]);
    try {
      expect(second.editor.getText()).toBe('inserted\nalpha\nbravo');
      second.editor.undo();
      expect(second.editor.getText()).toBe('alpha\nbravo');
    } finally {
      second.cleanup();
      Editor.clearDocuments();
    }
  });

  test('File and FileDiff retain independent documents for the same key', async () => {
    Editor.clearDocuments();
    const documentKey = 'shared-surface-key';
    const fileBaseline = 'plain file contents';
    const diffBaseline = 'alpha\nnew\ncharlie';
    const firstFile = await createKeyedEditorFixture(fileBaseline, documentKey);
    insertText(firstFile.editor, 0, fileBaseline.length, ' retained');
    const retainedFileText = firstFile.editor.getText();

    const firstDiff = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      diffBaseline
    );
    expect(firstDiff.editor.getText()).toBe(diffBaseline);
    insertText(firstDiff.editor, 1, 3, ' retained');
    const retainedDiffText = firstDiff.editor.getText();
    firstDiff.cleanup();
    firstFile.cleanup();

    const resumedFile = await createKeyedEditorFixture(
      'incoming file contents',
      documentKey
    );
    expect(resumedFile.editor.getText()).toBe(retainedFileText);
    resumedFile.cleanup();

    const resumedDiff = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      diffBaseline
    );
    expect(resumedDiff.editor.getText()).toBe(retainedDiffText);
    resumedDiff.cleanup();

    expect(Editor.disposeFile(documentKey)).toBe(true);
    expect(Editor.disposeFileDiff(documentKey)).toBe(true);

    const freshFile = await createKeyedEditorFixture(
      'fresh file contents',
      documentKey
    );
    expect(freshFile.editor.getText()).toBe('fresh file contents');
    freshFile.cleanup();

    const freshDiff = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      diffBaseline
    );
    try {
      expect(freshDiff.editor.getText()).toBe(diffBaseline);
      expect(freshDiff.editor.canUndo).toBe(false);
    } finally {
      freshDiff.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a never-edited FileDiff does not create retained state', async () => {
    Editor.clearDocuments();
    const documentKey = 'clean-diff';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    first.cleanup();

    expect(Editor.disposeFileDiff(documentKey)).toBe(false);

    const second = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      'fresh incoming diff'
    );
    try {
      expect(second.editor.getText()).toBe('fresh incoming diff');
      expect(second.editor.canUndo).toBe(false);
    } finally {
      second.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a retained document repaints a FileDiff surface', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-surface';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    const originalText = first.editor.getText();
    insertText(first.editor, 1, 3, ' retained');
    const editedText = first.editor.getText();
    first.cleanup();

    const second = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      'new external baseline'
    );
    try {
      expect(second.editor.getText()).toBe(editedText);
      await waitFor(() =>
        Boolean(
          second.container.shadowRoot?.textContent?.includes('new retained')
        )
      );
      expect(second.container.shadowRoot?.textContent).toContain(
        'new retained'
      );
      second.fileDiff.render({
        oldFile: { name: 'edits.ts', contents: 'alpha\nold\ncharlie' },
        newFile: { name: 'edits.ts', contents: 'external replacement' },
        fileContainer: second.container,
        forceRender: true,
      });
      await waitFor(() => second.editor.getText() === 'external replacement');
      second.editor.undo();
      expect(second.editor.getText()).toBe(editedText);
      second.editor.undo();
      expect(second.editor.getText()).toBe(originalText);
    } finally {
      second.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a FileDiff adopts retained addition identity with a compatible old side', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-identity';
    const retainedFile = {
      name: 'retained.txt',
      lang: 'typescript',
      contents: 'const retained = true;\n',
    } as const;
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      undefined,
      {
        oldFile: {
          name: 'original-base.txt',
          contents: 'const retained = false;\n',
        },
        newFile: retainedFile,
      }
    );
    insertText(first.editor, 0, 22, '// kept\n');
    const retainedContents = first.editor.getText();
    first.cleanup();

    const cloneForAnnotations = spyOn(
      TextDocument.prototype,
      'cloneForAnnotations'
    );
    let second: DiffEditorFixture | undefined;
    try {
      second = await createDiffEditorFixture(
        'split',
        undefined,
        documentKey,
        undefined,
        {
          oldFile: {
            name: 'original-base.txt',
            contents: 'const retained = false;\n',
          },
          newFile: {
            name: 'incoming.txt',
            lang: 'text',
            contents: 'incoming new side\n',
          },
        }
      );
      const adoptedDocument = cloneForAnnotations.mock.results.at(-1)?.value as
        | TextDocument<unknown>
        | undefined;
      expect(adoptedDocument?.uri).toBe('file:///retained.txt');
      expect(adoptedDocument?.languageId).toBe(retainedFile.lang);
      expect(second.editor.getFile()).toEqual({
        name: retainedFile.name,
        lang: retainedFile.lang,
        contents: retainedContents,
      });
      expect(second.content.ariaLabel).toBe(retainedFile.name);
      expect(
        second.container.shadowRoot?.querySelector(
          '[data-code][data-deletions]'
        )?.textContent
      ).toContain('const retained = false;');
      second.fileDiff.render({
        oldFile: {
          name: 'original-base.txt',
          contents: 'const retained = false;\n',
        },
        newFile: {
          name: retainedFile.name,
          lang: retainedFile.lang,
          contents: 'const external = true;\n',
        },
        fileContainer: second.container,
        forceRender: true,
      });
      await waitFor(
        () => second?.editor.getText() === 'const external = true;\n'
      );
      second.editor.undo();
      expect(second.editor.getText()).toBe(retainedContents);
      await waitFor(
        () => (second?.content.querySelectorAll('span[style]').length ?? 0) > 0
      );
      second.editor.undo();
      expect(second.editor.getText()).toBe(retainedFile.contents);
      second.editor.redo();
      expect(second.editor.getText()).toBe(retainedContents);
      second.editor.redo();
      expect(second.editor.getText()).toBe('const external = true;\n');
    } finally {
      cloneForAnnotations.mockRestore();
      second?.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a FileDiff rejects retained edits against a different old file', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-incompatible-old-file';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    insertText(first.editor, 1, 3, ' retained');
    first.cleanup();

    try {
      expect(
        createDiffEditorFixture(
          'split',
          undefined,
          documentKey,
          'alpha\nnew\ncharlie',
          {
            oldFile: {
              name: 'edits.ts',
              contents: 'different old side',
            },
            newFile: {
              name: 'edits.ts',
              contents: 'alpha\nnew\ncharlie',
            },
          }
        )
      ).rejects.toThrow(
        'FileDiff: retained session cannot resume against a different old file'
      );

      const resumed = await createDiffEditorFixture(
        'split',
        undefined,
        documentKey
      );
      try {
        expect(resumed.editor.getText()).toBe('alpha\nnew retained\ncharlie');
        expect(resumed.editor.canUndo).toBe(true);
      } finally {
        resumed.cleanup();
      }
    } finally {
      Editor.clearDocuments();
    }
  });

  test('a clean external replacement drops previously retained diff state', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-clean-replacement';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    insertText(first.editor, 1, 3, ' retained');
    first.cleanup();

    const second = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    second.fileDiff.render({
      oldFile: { name: 'edits.ts', contents: 'replacement old side' },
      newFile: { name: 'edits.ts', contents: 'replacement new side' },
      fileContainer: second.container,
      forceRender: true,
    });
    await waitFor(() => second.editor.getText() === 'replacement new side');
    expect(second.editor.canUndo).toBe(false);
    expect(second.editor.canRedo).toBe(false);
    second.cleanup();

    expect(Editor.disposeFileDiff(documentKey)).toBe(false);

    const fresh = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      'fresh incoming diff'
    );
    try {
      expect(fresh.editor.getText()).toBe('fresh incoming diff');
      expect(fresh.editor.canUndo).toBe(false);
    } finally {
      fresh.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a compatible external replacement retains its undo history', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-compatible-replacement';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    first.fileDiff.render({
      oldFile: { name: 'edits.ts', contents: 'alpha\nold\ncharlie' },
      newFile: { name: 'edits.ts', contents: 'replacement contents' },
      fileContainer: first.container,
      forceRender: true,
    });
    await waitFor(() => first.editor.getText() === 'replacement contents');
    first.cleanup();

    const resumed = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      'replacement contents'
    );
    try {
      expect(resumed.editor.canUndo).toBe(true);
      resumed.editor.undo();
      expect(resumed.editor.getText()).toBe('alpha\nnew\ncharlie');
    } finally {
      resumed.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a pending compatible replacement retains the outgoing edits', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-pending-compatible-replacement';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    insertText(first.editor, 1, 3, ' retained');
    const retainedText = first.editor.getText();
    first.fileDiff.render({
      oldFile: { name: 'edits.ts', contents: 'alpha\nold\ncharlie' },
      newFile: { name: 'edits.ts', contents: 'replacement contents' },
      fileContainer: first.container,
      forceRender: true,
    });
    first.cleanup();

    const resumed = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      'replacement contents'
    );
    try {
      expect(resumed.editor.getText()).toBe(retainedText);
      expect(resumed.editor.canUndo).toBe(true);
    } finally {
      resumed.cleanup();
      Editor.clearDocuments();
    }
  });

  test('a resumed diff keeps its original type until the edit session ends', async () => {
    Editor.clearDocuments();
    const documentKey = 'diff-type';
    const files = {
      oldFile: { name: 'before.ts', contents: 'same contents\n' },
      newFile: { name: 'after.ts', contents: 'changed contents\n' },
    };
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      undefined,
      files
    );
    expect(first.fileDiff.getCurrentType()).toBe('rename-changed');
    first.editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: {
            line: Number.MAX_SAFE_INTEGER,
            character: Number.MAX_SAFE_INTEGER,
          },
        },
        newText: files.oldFile.contents,
      },
    ]);
    expect(first.editor.getText()).toBe(files.oldFile.contents);
    expect(first.fileDiff.getCurrentType()).toBe('rename-changed');
    first.cleanup();

    const second = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey,
      undefined,
      files
    );
    try {
      expect(second.editor.getText()).toBe(files.oldFile.contents);
      expect(second.fileDiff.getCurrentType()).toBe('rename-changed');

      second.editor.cleanUp();
      expect(second.fileDiff.getCurrentType()).toBe('rename-pure');
    } finally {
      second.cleanup();
      Editor.clearDocuments();
    }
  });

  for (const [mismatch, replacement] of [
    ['name', { name: 'renamed.ts', contents: 'const replacement = true;' }],
    [
      'language',
      {
        name: 'retained.ts',
        lang: 'javascript',
        contents: 'const replacement = true;',
      },
    ],
  ] as const) {
    test(`a keyed File ${mismatch} update starts fresh history`, async () => {
      Editor.clearDocuments();
      const documentKey = `file-incompatible-${mismatch}`;
      const fileInfo = { name: 'retained.ts', lang: 'typescript' } as const;
      const first = await createKeyedEditorFixture(
        'const original = true;',
        documentKey,
        undefined,
        fileInfo
      );
      insertText(first.editor, 0, 0, '// retained\n');
      first.cleanup();

      const second = await createKeyedEditorFixture(
        'incoming baseline',
        documentKey,
        undefined,
        fileInfo
      );
      try {
        second.file.render({
          file: replacement,
          fileContainer: second.container,
          forceRender: true,
        });
        await waitFor(() => second.editor.getText() === replacement.contents);
        expect(second.editor.canUndo).toBe(false);
        expect(second.editor.canRedo).toBe(false);
      } finally {
        second.cleanup();
        Editor.clearDocuments();
      }
    });
  }

  for (const decision of ['accept', 'reject'] as const) {
    test(`a keyed File ${decision} completion retains history until disposal`, async () => {
      Editor.clearDocuments();
      const documentKey = `file-completion-${decision}`;
      const baseline = 'const original = true;';
      const first = await createKeyedEditorFixture(baseline, documentKey);
      first.file.setOptions({
        ...first.file.options,
        onEditComplete: () => decision,
      });
      insertText(first.editor, 0, 0, `// ${decision}\n`);
      const editedText = first.editor.getText();
      first.complete();
      first.cleanup();

      const resumed = await createKeyedEditorFixture(baseline, documentKey);
      expect(resumed.editor.getText()).toBe(editedText);
      resumed.editor.undo();
      expect(resumed.editor.getText()).toBe(baseline);
      resumed.editor.redo();
      expect(resumed.editor.getText()).toBe(editedText);
      resumed.cleanup();

      expect(Editor.disposeFile(documentKey)).toBe(true);
      const fresh = await createKeyedEditorFixture(baseline, documentKey);
      try {
        expect(fresh.editor.getText()).toBe(baseline);
        expect(fresh.editor.canUndo).toBe(false);
        expect(fresh.editor.canRedo).toBe(false);
      } finally {
        fresh.cleanup();
        Editor.clearDocuments();
      }
    });

    test(`a keyed FileDiff ${decision} completion retains history until disposal`, async () => {
      Editor.clearDocuments();
      const documentKey = `diff-completion-${decision}`;
      const baseline = 'alpha\nnew\ncharlie';
      const first = await createDiffEditorFixture(
        'split',
        undefined,
        documentKey,
        baseline
      );
      first.fileDiff.setOptions({
        ...first.fileDiff.options,
        onEditComplete: () => decision,
      });
      insertText(first.editor, 1, 3, ` ${decision}`);
      const editedText = first.editor.getText();
      first.complete();
      first.cleanup();

      const resumed = await createDiffEditorFixture(
        'split',
        undefined,
        documentKey,
        baseline
      );
      expect(resumed.editor.getText()).toBe(editedText);
      resumed.editor.undo();
      expect(resumed.editor.getText()).toBe(baseline);
      resumed.editor.redo();
      expect(resumed.editor.getText()).toBe(editedText);
      resumed.cleanup();

      expect(Editor.disposeFileDiff(documentKey)).toBe(true);
      const fresh = await createDiffEditorFixture(
        'split',
        undefined,
        documentKey,
        baseline
      );
      try {
        expect(fresh.editor.getText()).toBe(baseline);
        expect(fresh.editor.canUndo).toBe(false);
        expect(fresh.editor.canRedo).toBe(false);
      } finally {
        fresh.cleanup();
        Editor.clearDocuments();
      }
    });
  }

  test('completion before initial sync retains a claimed document', async () => {
    Editor.clearDocuments();
    const documentKey = 'pending-completion';
    const first = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    insertText(first.editor, 1, 5, ' retained');
    first.cleanup();

    const pending = createPendingEditorFixture('alpha\nbravo', documentKey);
    pending.complete();
    pending.cleanup();

    const fresh = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    try {
      expect(fresh.editor.getText()).toBe('alpha\nbravo retained');
      expect(fresh.editor.canUndo).toBe(true);
    } finally {
      fresh.cleanup();
      Editor.clearDocuments();
    }
  });

  test('disposing a pending adoption does not re-register it', async () => {
    Editor.clearDocuments();
    const documentKey = 'pending-disposal';
    const first = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    insertText(first.editor, 1, 5, ' retained');
    const retainedText = first.editor.getText();
    first.cleanup();

    const pending = createPendingEditorFixture('alpha\nbravo', documentKey);
    expect(Editor.disposeFile(documentKey)).toBe(true);
    await waitFor(() => pending.editor.getText() === retainedText);
    expect(pending.editor.getText()).toBe(retainedText);
    pending.cleanup();

    const fresh = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    try {
      expect(fresh.editor.getText()).toBe('alpha\nbravo');
      expect(fresh.editor.canUndo).toBe(false);
    } finally {
      fresh.cleanup();
      Editor.clearDocuments();
    }
  });
});

describe('Editor state round trip', () => {
  test('setState restores selections without rebuilding the document or dropping undo history', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      insertText(editor, 1, 0, 'ZZ', true);
      expect(editor.canUndo).toBe(true);
      const editedText = editor.getText();

      editor.setSelections([
        {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          direction: 'forward',
        },
      ]);
      const state = editor.getState();

      // Move the caret elsewhere, then restore the captured state.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      editor.setState(state);

      expect(editor.getState().selections).toEqual(state.selections);
      // getState/setState carry no cacheKey, so restoring state neither rebuilds
      // the document nor discards its undo history.
      expect(editor.canUndo).toBe(true);
      expect(editor.getText()).toBe(editedText);
      editor.undo();
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setOptions', () => {
  test('applies an option change after construction', async () => {
    const onChange = mock(() => {});
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo');
    try {
      // With no onChange configured, an edit notifies nobody.
      insertText(editor, 0, 5, 'X', true);
      expect(onChange).not.toHaveBeenCalled();

      // Installing onChange at runtime makes the next edit report the change.
      editor.setOptions({ onChange });
      insertText(editor, 0, 0, 'Y', true);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe('Editor focus lifecycle', () => {
  test('fires onAttach when the editor attaches to a file', async () => {
    let onAttachCompleted = false;
    const onAttach = mock(
      (
        attachedEditor: Editor<undefined>,
        _file: DiffsEditableComponent<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted = true;
      }
    );
    const { cleanup, editor, file } = await createEditorFixture(
      'alpha\nbravo',
      { onAttach }
    );
    try {
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(true);
      expect(onAttach.mock.calls[0]?.[0]).toBe(editor);
      expect(onAttach.mock.calls[0]?.[1]).toBe(file);
    } finally {
      cleanup();
    }
  });

  test('fires onFocus and onBlur as the content gains and loses focus', async () => {
    const onFocus = mock(() => {});
    const onBlur = mock(() => {});
    const { cleanup, content } = await createEditorFixture('alpha\nbravo', {
      onFocus,
      onBlur,
    });
    try {
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onBlur).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('blur() blurs the content element', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      const blurSpy = spyOn(content, 'blur');
      editor.blur();
      expect(blurSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('focus() without a selection focuses the content and honors preventScroll', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      editor.setSelections([]);
      const focusSpy = spyOn(content, 'focus');
      editor.focus();
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: false });
      editor.focus({ preventScroll: true });
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    } finally {
      cleanup();
    }
  });

  test('focus() with a selection defers the content focus to a frame', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      const focusSpy = spyOn(content, 'focus');
      editor.focus();
      // The real focus() runs in a rAF so it does not clobber the re-anchored
      // native selection.
      expect(focusSpy).not.toHaveBeenCalled();
      await wait(0);
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: false });
    } finally {
      cleanup();
    }
  });

  test('focus() targets and normalizes a one-based document line', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const firstTarget: EditorFocusOptions = {
        lineNumber: 2,
        preventScroll: true,
      };
      editor.focus(firstTarget);
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
      ]);

      editor.focus({ lineNumber: 99, character: 99, preventScroll: true });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 7 },
          direction: 0,
        },
      ]);

      editor.focus({
        lineNumber: Number.NaN,
        character: Number.NaN,
        preventScroll: true,
      });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('targeted focus honors preventScroll', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo');
    const scrollIntoView = spyOn(HTMLElement.prototype, 'scrollIntoView');
    try {
      editor.focus({ lineNumber: 2, preventScroll: true });
      expect(scrollIntoView).not.toHaveBeenCalled();

      editor.focus({ lineNumber: 1 });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      scrollIntoView.mockRestore();
      cleanup();
    }
  });

  test('targeted focus before attachment is a no-op', () => {
    const editor = new Editor<undefined>('file');
    try {
      editor.focus({ lineNumber: 2 });
      expect(editor.getState().selections).toBeUndefined();
    } finally {
      editor.cleanUp();
    }
  });

  test('first-visible focus targets the first row whose top is in an element viewport', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 10, 50);

      const rows = getLineRows(content);
      setRect(rows[0], 0, 20);
      setRect(rows[1], 40, 60);
      setRect(rows[2], 60, 80);

      editor.focus({
        lineNumber: 'first-visible',
        character: 4,
        preventScroll: true,
      });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus falls back to document viewport bounds', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 50,
      });

      const rows = getLineRows(content);
      setRect(rows[0], -1, 19);
      setRect(rows[1], 19, 39);
      setRect(rows[2], 39, 59);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start).toEqual({
        line: 1,
        character: 0,
      });
    } finally {
      cleanup();
    }
  });

  test('first-visible focus falls back to the nearest scrollable ancestor', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const fileContainer = (content.getRootNode() as ShadowRoot)
        .host as HTMLElement;
      const viewport = document.createElement('div');
      viewport.style.overflowY = 'auto';
      document.body.appendChild(viewport);
      viewport.appendChild(fileContainer);
      setRect(viewport, 10, 50);

      const rows = getLineRows(content);
      setRect(rows[0], 0, 20);
      setRect(rows[1], 20, 40);
      setRect(rows[2], 40, 60);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start).toEqual({
        line: 1,
        character: 0,
      });
    } finally {
      cleanup();
    }
  });

  test('first-visible focus applies a top offset after sticky headers', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 0, 60);

      const shadowRoot = content.getRootNode() as ShadowRoot;
      const header = document.createElement('div');
      header.dataset.diffsHeader = 'file';
      header.dataset.sticky = '';
      setRect(header, 0, 20);
      shadowRoot.prepend(header);

      for (const lineType of [
        'annotation',
        'separator',
        'buffer',
        'change-deletion',
      ]) {
        const row = document.createElement('div');
        row.dataset.line = '99';
        row.dataset.lineType = lineType;
        setRect(row, 35, 40);
        content.prepend(row);
      }

      const rows = getLineRows(content).filter(
        (row) => row.dataset.line !== '99'
      );
      setRect(rows[0], 10, 20);
      setRect(rows[1], 25, 35);
      setRect(rows[2], 35, 45);

      editor.focus({
        lineNumber: 'first-visible',
        preventScroll: true,
        offset: 10,
      });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus preserves focus and selection without a visible row top', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.focus({ lineNumber: 2, preventScroll: true });
      await wait(0);
      const selections = editor.getState().selections;
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections).toEqual(selections);
      expect(document.activeElement).toBe(button);

      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 0, 10);
      const rows = getLineRows(content);
      setRect(rows[0], -5, 5);
      setRect(rows[1], 10, 20);
      setRect(rows[2], 15, 25);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections).toEqual(selections);
      expect(document.activeElement).toBe(button);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus skips unified deletion rows', async () => {
    const { cleanup, content, editor, fileDiff } =
      await createDiffEditorFixture('unified');
    try {
      const viewport = document.createElement('div');
      setEditorViewport(fileDiff, viewport);
      setRect(viewport, 0, 60);

      const rows = getLineRows(content);
      for (const row of rows) {
        setRect(row, 100, 120);
      }
      const deletion = rows.find(
        (row) => row.dataset.lineType === 'change-deletion'
      );
      const addition = rows.find(
        (row) => row.dataset.lineType === 'change-addition'
      );
      const trailingContext = rows.find(
        (row) => row.dataset.line === '3' && row.dataset.lineType === 'context'
      );
      expect(deletion).toBeDefined();
      expect(addition).toBeDefined();
      expect(trailingContext).toBeDefined();
      setRect(deletion!, 10, 30);
      setRect(addition!, -5, 15);
      setRect(trailingContext!, 30, 50);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus scans the additions column in split diffs', async () => {
    const { cleanup, container, content, editor, fileDiff } =
      await createDiffEditorFixture('split');
    try {
      const viewport = document.createElement('div');
      setEditorViewport(fileDiff, viewport);
      setRect(viewport, 0, 60);

      const deletionContent = container.shadowRoot?.querySelector<HTMLElement>(
        '[data-code][data-deletions] [data-content]'
      );
      expect(deletionContent).toBeDefined();
      for (const row of getLineRows(deletionContent!)) {
        setRect(row, 10, 30);
      }

      const additionRows = getLineRows(content);
      for (const row of additionRows) {
        setRect(row, 100, 120);
      }
      const target = additionRows.find(
        (row) => row.dataset.line === '3' && row.dataset.lineType === 'context'
      );
      expect(target).toBeDefined();
      setRect(target!, 30, 50);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setMarkers', () => {
  test('clearing markers tears down the renderer and its popover', async () => {
    const { cleanup, editor, content } = await createEditorFixture(
      'l0\nl1\nl2\nl3\nl4\nl5'
    );
    try {
      // Clearing before any markers were set is a no-op that must not throw.
      editor.setMarkers([]);

      const markers: Marker[] = [
        {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 2 },
          severity: 'error',
          message: 'boom',
        },
      ];
      editor.setMarkers(markers);
      hoverMarkerLine(content, 4);
      await wait(350);
      expect(markerPopover(content)).not.toBeNull();

      // Clearing markers disposes the renderer and removes its popover.
      editor.setMarkers([]);
      expect(markerPopover(content)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('Editor history option plumbing', () => {
  test('caps the undo history at historyMaxEntries', async () => {
    const { cleanup, editor } = await createEditorFixture('abcdef', {
      historyMaxEntries: 2,
    });
    try {
      // Three replacements, none of which coalesce, push three undo entries.
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            newText: 'X',
          },
        ],
        true
      );
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 2 },
            },
            newText: 'Y',
          },
        ],
        true
      );
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 3 },
            },
            newText: 'Z',
          },
        ],
        true
      );
      expect(editor.getText()).toBe('XYZdef');

      // The cap keeps only the two most recent entries, so the oldest edit can
      // no longer be undone.
      editor.undo();
      editor.undo();
      expect(editor.canUndo).toBe(false);
      expect(editor.getText()).toBe('Xbcdef');
    } finally {
      cleanup();
    }
  });
});
