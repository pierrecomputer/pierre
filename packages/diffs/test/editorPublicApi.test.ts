import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import {
  Editor,
  type EditorFocusOptions,
  type EditorOptions,
} from '../src/editor/editor';
import { EditStateManager } from '../src/editor/EditStateManager';
import type { Marker } from '../src/editor/marker';
import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffsEditableComponent,
  EditorViewState,
  FileContents,
  FileDiffMetadata,
  LineAnnotation,
} from '../src/types';
import { getFiletypeFromFileName } from '../src/utils/getFiletypeFromFileName';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
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
  getCurrentDiff(): FileDiffMetadata | undefined {
    return this.getLatestDiff();
  }

  getCurrentType(): FileDiffMetadata['type'] | undefined {
    return this.getLatestDiff()?.type;
  }
}

class TestFile extends File<undefined> {
  getCurrentFile(): FileContents | undefined {
    return this.getLatestFile();
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

describe('component editor attachment', () => {
  test('File rejects another editor until the current editor detaches', async () => {
    const fixture = await createEditorFixture('alpha\nbravo');
    const replacement = new Editor<undefined>('file');
    try {
      expect(() => replacement.edit(fixture.file)).toThrow(
        'File.__attachEditor: an editor is already attached'
      );
      expect(fixture.editor.getFile()).toBeDefined();
      expect(replacement.getFile()).toBeUndefined();

      fixture.complete();
      replacement.edit(fixture.file);
      await waitFor(() => replacement.getFile() !== undefined);
      expect(replacement.getFile()?.contents).toBe('alpha\nbravo');
    } finally {
      fixture.cleanup();
    }
  });

  test('FileDiff rejects another editor until the current editor detaches', async () => {
    const fixture = await createDiffEditorFixture('split');
    const replacement = new Editor<undefined>('file-diff');
    try {
      expect(() => replacement.edit(fixture.fileDiff)).toThrow(
        'FileDiff.__attachEditor: an editor is already attached'
      );
      expect(fixture.editor.getFile()).toBeDefined();
      expect(replacement.getFile()).toBeUndefined();

      fixture.complete();
      replacement.edit(fixture.fileDiff);
      await waitFor(() => replacement.getFile() !== undefined);
      expect(replacement.getFile()?.contents).toBe('alpha\nnew\ncharlie');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('Editor document registry surfaces', () => {
  for (const documentKind of ['file', 'file-diff'] as const) {
    for (const stateKind of ['selection', 'view'] as const) {
      test(`${documentKind} restores a clean ${stateKind}-only session`, async () => {
        EditStateManager.clearAll();
        const editStateKey = `${documentKind}-${stateKind}-only`;
        const createFixture = () =>
          documentKind === 'file'
            ? createKeyedEditorFixture('alpha\nbravo', editStateKey)
            : createDiffEditorFixture(
                'split',
                undefined,
                editStateKey,
                'alpha\nnew\ncharlie'
              );
        const first = await createFixture();
        const state =
          stateKind === 'selection'
            ? {
                selections: [
                  {
                    start: { line: 1, character: 2 },
                    end: { line: 1, character: 2 },
                    direction: 0 as const,
                  },
                ],
              }
            : { view: { scrollLeft: 24 } };
        first.editor.setViewState(state);
        first.cleanup();

        const second = await createFixture();
        try {
          expect(second.editor.canUndo).toBe(false);
          expect(second.editor.getViewState()).toEqual({
            selections:
              stateKind === 'selection' ? state.selections : undefined,
            view:
              stateKind === 'selection'
                ? { scrollLeft: 0 }
                : { scrollLeft: 24 },
          });
        } finally {
          second.cleanup();
          EditStateManager.clearAll();
        }
      });
    }
  }

  test('complete FileDiff state restores an unkeyed session independently', async () => {
    const first = await createDiffEditorFixture('split');
    insertText(first.editor, 1, 3, ' retained');
    const state = first.editor.getEditState();
    first.cleanup();
    let second: DiffEditorFixture | undefined;

    try {
      second = await createDiffEditorFixture('split', { initialState: state });
      expect(second.editor.getText()).toBe('alpha\nnew retained\ncharlie');
      expect(second.editor.canUndo).toBe(true);

      second.editor.undo();
      expect(second.editor.getText()).toBe('alpha\nnew\ncharlie');
    } finally {
      second?.cleanup();
    }
  });

  test('File restores a keyed draft when its editor is attached before hydrate', async () => {
    EditStateManager.clearAll();
    const editStateKey = 'file-hydration';
    const first = await createKeyedEditorFixture(
      'alpha\nbravo\ncharlie',
      editStateKey
    );
    const prerenderedHTML = first.container.shadowRoot?.innerHTML;
    insertText(first.editor, 1, 5, ' retained');
    const retainedFile = first.editor.getFile();
    first.cleanup();

    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const file = new TestFile({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const editor = new Editor<undefined>('file', {}, editStateKey);
    try {
      editor.edit(file);
      file.hydrate({
        file: { name: 'edits.ts', contents: 'pristine replacement' },
        fileContainer: container,
        prerenderedHTML,
      });

      expect(file.getCurrentFile()).toEqual(retainedFile);
      expect(editor.getFile()).toEqual(retainedFile);
      await waitFor(() =>
        Boolean(container.shadowRoot?.textContent?.includes('bravo retained'))
      );
      expect(container.shadowRoot?.textContent).toContain('bravo retained');
    } finally {
      file.cleanUp();
      EditStateManager.clear('file', editStateKey);
      dom.cleanup();
    }
  });

  test('FileDiff restores exact keyed session hunks when attached before hydrate', async () => {
    EditStateManager.clearAll();
    const editStateKey = 'file-diff-hydration';
    const oldFile = { name: 'edits.ts', contents: 'alpha\nold\ncharlie' };
    const newFile = { name: 'edits.ts', contents: 'alpha\nnew\ncharlie' };
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      editStateKey,
      newFile.contents,
      { oldFile, newFile }
    );
    const prerenderedHTML = first.container.shadowRoot?.innerHTML;
    insertText(first.editor, 1, 3, ' retained');
    await waitFor(
      () =>
        first.fileDiff.getCurrentDiff()?.additionLines.join('') ===
        first.editor.getText()
    );
    const retainedFile = first.editor.getFile();
    const retainedHunks = structuredClone(
      first.fileDiff.getCurrentDiff()?.hunks
    );
    first.cleanup();

    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const fileDiff = new TestFileDiff({
      disableFileHeader: true,
      diffStyle: 'split',
      theme: DEFAULT_THEMES,
    });
    const editor = new Editor<undefined>('file-diff', {}, editStateKey);
    const externalDiff = parseDiffFromFile(oldFile, newFile);
    try {
      editor.edit(fileDiff);
      fileDiff.hydrate({
        fileDiff: externalDiff,
        fileContainer: container,
        prerenderedHTML,
      });

      expect(editor.getFile()).toEqual(retainedFile);
      expect(fileDiff.getCurrentDiff()?.hunks).toEqual(retainedHunks);
      expect(fileDiff.getCurrentDiff()).not.toBe(externalDiff);
      await waitFor(() =>
        Boolean(container.shadowRoot?.textContent?.includes('new retained'))
      );
      expect(container.shadowRoot?.textContent).toContain('new retained');
    } finally {
      fileDiff.cleanUp();
      EditStateManager.clear('file-diff', editStateKey);
      dom.cleanup();
    }
  });

  test('a retained document repaints a File surface', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('a File adopts retained name and explicit language with its text', async () => {
    EditStateManager.clearAll();
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
    const retainedHistory = EditStateManager.get<undefined>(
      'file',
      documentKey
    )!.document.history;

    let second: EditorFixture | undefined;
    try {
      second = await createKeyedEditorFixture(
        'incoming baseline',
        documentKey,
        undefined,
        { name: 'incoming.txt', lang: 'text' }
      );
      expect(second.editor.getEditState()!.document.history.undoStack).toBe(
        retainedHistory.undoStack
      );
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
      second?.cleanup();
      EditStateManager.clearAll();
    }
  });

  test('a File retains annotation history without diff sides', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('File and FileDiff retain independent documents for the same key', async () => {
    EditStateManager.clearAll();
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

    expect(EditStateManager.clear('file', documentKey)).toBe(true);
    expect(EditStateManager.clear('file-diff', documentKey)).toBe(true);

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
      EditStateManager.clearAll();
    }
  });

  test('does not clear history from an active editor', async () => {
    EditStateManager.clearAll();
    const documentKey = 'clear-active-history';
    const fixture = await createKeyedEditorFixture('alpha', documentKey);

    try {
      insertText(fixture.editor, 0, 5, '!');
      const editedText = fixture.editor.getText();
      const document = fixture.editor.getEditState()!.document;
      expect(fixture.editor.canUndo).toBe(true);

      expect(
        EditStateManager.clear('file', documentKey, { history: true })
      ).toBe(false);
      expect(fixture.editor.getText()).toBe(editedText);
      expect(fixture.editor.getEditState()!.document).toBe(document);
      expect(fixture.editor.canUndo).toBe(true);
      expect(fixture.editor.canRedo).toBe(false);

      insertText(fixture.editor, 0, 0, '>');
      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe(editedText);
      expect(fixture.editor.canUndo).toBe(true);
    } finally {
      fixture.cleanup();
      EditStateManager.clearAll();
    }
  });

  test('a never-edited FileDiff does not create retained state', async () => {
    EditStateManager.clearAll();
    const documentKey = 'clean-diff';
    const first = await createDiffEditorFixture(
      'split',
      undefined,
      documentKey
    );
    first.cleanup();

    expect(EditStateManager.clear('file-diff', documentKey)).toBe(false);

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
      EditStateManager.clearAll();
    }
  });

  test('a retained document repaints a FileDiff surface', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('a FileDiff adopts retained addition identity with a compatible old side', async () => {
    EditStateManager.clearAll();
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
    const retainedHistory = EditStateManager.get<undefined>(
      'file-diff',
      documentKey
    )!.document.history;

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
      expect(second.editor.getEditState()!.document.history.undoStack).toBe(
        retainedHistory.undoStack
      );
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
      second?.cleanup();
      EditStateManager.clearAll();
    }
  });

  test('a FileDiff rejects retained edits against a different old file', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('a clean external replacement drops previously retained diff state', async () => {
    EditStateManager.clearAll();
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

    expect(EditStateManager.clear('file-diff', documentKey)).toBe(false);

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
      EditStateManager.clearAll();
    }
  });

  test('a compatible external replacement retains its undo history', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('a pending compatible replacement retains the outgoing edits', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('discarding a resumed diff restores its external type', async () => {
    EditStateManager.clearAll();
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
      expect(second.fileDiff.getCurrentType()).toBe('rename-changed');
    } finally {
      second.cleanup();
      EditStateManager.clearAll();
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
      EditStateManager.clearAll();
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
        EditStateManager.clearAll();
      }
    });
  }

  for (const decision of ['accept', 'reject'] as const) {
    test(`a keyed File ${decision} completion retains history until disposal`, async () => {
      EditStateManager.clearAll();
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

      expect(EditStateManager.clear('file', documentKey)).toBe(true);
      const fresh = await createKeyedEditorFixture(baseline, documentKey);
      try {
        expect(fresh.editor.getText()).toBe(baseline);
        expect(fresh.editor.canUndo).toBe(false);
        expect(fresh.editor.canRedo).toBe(false);
      } finally {
        fresh.cleanup();
        EditStateManager.clearAll();
      }
    });

    test(`a keyed FileDiff ${decision} completion retains history until disposal`, async () => {
      EditStateManager.clearAll();
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

      expect(EditStateManager.clear('file-diff', documentKey)).toBe(true);
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
        EditStateManager.clearAll();
      }
    });
  }

  test('completion before initial sync retains a claimed document', async () => {
    EditStateManager.clearAll();
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
      EditStateManager.clearAll();
    }
  });

  test('clearing a pending adoption is ignored while active', async () => {
    EditStateManager.clearAll();
    const documentKey = 'pending-disposal';
    const first = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    insertText(first.editor, 1, 5, ' retained');
    const retainedText = first.editor.getText();
    first.cleanup();

    const pending = createPendingEditorFixture('alpha\nbravo', documentKey);
    expect(EditStateManager.clear('file', documentKey)).toBe(false);
    await waitFor(() => pending.editor.getText() === retainedText);
    expect(pending.editor.getText()).toBe(retainedText);
    pending.cleanup();

    const fresh = await createKeyedEditorFixture('alpha\nbravo', documentKey);
    try {
      expect(fresh.editor.getText()).toBe(retainedText);
      expect(fresh.editor.canUndo).toBe(true);
    } finally {
      fresh.cleanup();
      EditStateManager.clearAll();
    }
  });
});

describe('Editor state round trip', () => {
  test('restores a JSON-persisted file and editor state with fresh history', async () => {
    const first = await createEditorFixture('alpha\nbravo');
    let serializedDraft: string;
    try {
      insertText(first.editor, 1, 5, ' charlie');
      first.editor.setViewState({
        selections: [
          {
            start: { line: 1, character: 13 },
            end: { line: 1, character: 13 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24 },
      });
      expect(first.editor.canUndo).toBe(true);

      serializedDraft = JSON.stringify({
        file: first.editor.getFile(),
        editorState: first.editor.getViewState(),
      });
    } finally {
      first.cleanup();
    }

    const persisted = JSON.parse(serializedDraft) as {
      file: FileContents;
      editorState: EditorViewState;
    };
    const initialDocument = new TextDocument<undefined>(
      persisted.file.name,
      persisted.file.contents,
      persisted.file.lang ?? getFiletypeFromFileName(persisted.file.name)
    );
    let restoredState = false;
    const restored = await createEditorFixture(
      persisted.file.contents,
      {
        initialState: {
          documentKind: 'file',
          document: initialDocument,
          fileInfo: {
            name: persisted.file.name,
            lang: persisted.file.lang,
          },
          editor: persisted.editorState,
        },
        onAttach() {
          restoredState = true;
        },
      },
      undefined,
      undefined,
      persisted.file
    );
    try {
      await waitFor(() => restoredState);
      expect(restored.editor.getEditState()?.document).toBe(initialDocument);
      expect(restored.editor.getFile()).toEqual(persisted.file);
      expect(restored.editor.getViewState()).toEqual(persisted.editorState);
      expect(restored.editor.canUndo).toBe(false);
      expect(restored.editor.canRedo).toBe(false);
    } finally {
      restored.cleanup();
    }
  });

  test('completes partial FileDiff initialState from the attached diff', async () => {
    const editorState: EditorViewState = {
      selections: [
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 0,
        },
      ],
      view: { scrollLeft: 24 },
    };
    const restored = await createDiffEditorFixture('split', {
      initialState: {
        documentKind: 'file-diff',
        editor: editorState,
      },
    });

    try {
      expect(restored.editor.getViewState()).toEqual(editorState);
      expect(restored.editor.getEditState()).toMatchObject({
        documentKind: 'file-diff',
        fileInfo: { name: 'edits.ts' },
      });
      expect(restored.editor.getEditState()?.diffSession).toBeDefined();
      expect(restored.editor.getText()).toBe('alpha\nnew\ncharlie');
      expect(restored.editor.canUndo).toBe(false);
    } finally {
      restored.cleanup();
    }
  });

  test('adopts a partial initialState document and builds its missing fields', async () => {
    const first = await createEditorFixture('alpha\nbravo');
    insertText(first.editor, 1, 5, ' charlie');
    const document = first.editor.getEditState()!.document;
    first.cleanup();

    const restored = await createEditorFixture('fallback', {
      initialState: {
        documentKind: 'file',
        document,
      },
    });

    try {
      expect(restored.editor.getEditState()?.document).toBe(document);
      expect(restored.editor.getText()).toBe('alpha\nbravo charlie');
      expect(restored.editor.getFile()).toEqual({
        name: 'edits.ts',
        lang: undefined,
        contents: 'alpha\nbravo charlie',
      });
      expect(restored.editor.getViewState()).toEqual({
        selections: undefined,
        view: { scrollLeft: 0 },
      });
      expect(restored.editor.canUndo).toBe(true);
    } finally {
      restored.cleanup();
    }
  });

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
      const state = editor.getViewState();

      // Move the caret elsewhere, then restore the captured state.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      editor.setViewState(state);

      expect(editor.getViewState().selections).toEqual(state.selections);
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
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
      ]);

      editor.focus({ lineNumber: 99, character: 99, preventScroll: true });
      expect(editor.getViewState().selections).toEqual([
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
      expect(editor.getViewState().selections).toEqual([
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
      expect(editor.getViewState().selections).toBeUndefined();
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
      expect(editor.getViewState().selections).toEqual([
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
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
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
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
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
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(2);
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
      const selections = editor.getViewState().selections;
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getViewState().selections).toEqual(selections);
      expect(document.activeElement).toBe(button);

      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 0, 10);
      const rows = getLineRows(content);
      setRect(rows[0], -5, 5);
      setRect(rows[1], 10, 20);
      setRect(rows[2], 15, 25);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getViewState().selections).toEqual(selections);
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
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(2);
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
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(2);
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
