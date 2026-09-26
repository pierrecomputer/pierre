import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { DirectionNone } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// The editor attaches to the additions (new-file) side of a diff. That column
// is the `[data-code]` element without `data-deletions`; its editable lines
// live in the child marked `data-content`.
function findAdditionContent(container: HTMLElement): HTMLElement | undefined {
  const shadow = container.shadowRoot;
  if (shadow == null) {
    return undefined;
  }
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    if (code.dataset.deletions !== undefined) {
      continue;
    }
    for (const child of code.children) {
      const el = child as HTMLElement;
      if (el.dataset.content !== undefined) {
        return el;
      }
    }
  }
  return undefined;
}

interface DiffEditorFixture {
  container: HTMLElement;
  editor: Editor<'file-diff', undefined>;
  cleanup(): Promise<void>;
}

async function createDiffEditorFixture(
  oldContents: string,
  newContents: string
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle: 'split',
  });
  const oldFile: FileContents = { name: 'example.txt', contents: oldContents };
  const newFile: FileContents = { name: 'example.txt', contents: newContents };
  const editor = new Editor('file-diff');

  fileDiff.render({
    oldFile,
    newFile,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(fileDiff);

  for (let attempt = 0; attempt < 40; attempt++) {
    const content = findAdditionContent(container);
    if (content != null && content.getAttribute('contenteditable') === 'true') {
      break;
    }
    await wait(0);
  }

  return {
    container,
    editor,
    async cleanup() {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
      await disposeHighlighter();
    },
  };
}

const testFileContainers = new WeakMap<File<undefined>, HTMLElement>();

function createTestFile(fileContents: FileContents): File<undefined> {
  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  file.render({ file: fileContents, fileContainer, forceRender: true });
  testFileContainers.set(file, fileContainer);
  return file;
}

async function attachEditor(
  editor: Editor<'file', undefined>,
  file: File<undefined>
): Promise<void> {
  editor.edit(file);
  await waitFor(() => editor.getFile() !== undefined);
}

function getContentElement(file: File<undefined>): HTMLElement {
  const contentElement =
    testFileContainers
      .get(file)
      ?.shadowRoot?.querySelector<HTMLElement>('[data-content]') ?? undefined;
  if (contentElement == null) {
    throw new Error('missing test editor content element');
  }
  return contentElement;
}

const MULTI_SELECTION_CLIPBOARD_TYPE =
  'application/vnd.pierre.diffs-selections+json';

class TestClipboardData {
  readonly writes: Array<[type: string, text: string]> = [];
  readonly #data = new Map<string, string>();

  constructor(text?: string) {
    if (text !== undefined) {
      this.#data.set('text', text);
    }
  }

  setData(type: string, text: string): void {
    this.writes.push([type, text]);
    this.#data.set(type, text);
  }

  getData(type: string): string {
    return this.#data.get(type) ?? '';
  }
}

function dispatchCut(target: HTMLElement): Array<[type: string, text: string]> {
  const clipboardData = new TestClipboardData();
  const event = new window.Event('cut', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: clipboardData,
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return clipboardData.writes;
}

function dispatchCopy(
  target: HTMLElement
): Array<[type: string, text: string]> {
  return dispatchCopyData(target).writes;
}

function dispatchCopyData(target: HTMLElement): TestClipboardData {
  const clipboardData = new TestClipboardData();
  const event = new window.Event('copy', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: clipboardData,
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return clipboardData;
}

function dispatchPaste(
  target: HTMLElement,
  data: string | TestClipboardData
): void {
  const event = new window.Event('paste', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: typeof data === 'string' ? new TestClipboardData(data) : data,
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function dispatchBeforeInput(target: HTMLElement, inputType: string): void {
  const view = target.ownerDocument.defaultView;
  if (view == null) {
    throw new Error('target element is not attached to a window');
  }
  const event = new view.InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType,
    data: null,
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function dispatchPasteShortcutKeydown(
  target: HTMLElement,
  repeat = false,
  init: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: init.key ?? 'v',
    code: init.code ?? 'KeyV',
    metaKey: true,
    repeat,
    ...init,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('Editor clipboard events', () => {
  test('cuts the current line when the primary selection is collapsed', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(getContentElement(component));

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('cuts every collapsed selection line in a multi-cursor cut', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
        {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(getContentElement(component));

      expect(writes).toEqual([
        ['text', 'alpha\ncharlie\n'],
        [
          MULTI_SELECTION_CLIPBOARD_TYPE,
          JSON.stringify(['alpha\n', 'charlie\n']),
        ],
      ]);
      expect(editor.getText()).toBe('bravo\ndelta');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: DirectionNone,
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('cuts mixed ranges and collapsed selection lines together', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 'forward',
        },
        {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(getContentElement(component));

      expect(writes).toEqual([
        ['text', 'rav\ncharlie\n'],
        [MULTI_SELECTION_CLIPBOARD_TYPE, JSON.stringify(['rav', 'charlie\n'])],
      ]);
      expect(editor.getText()).toBe('alpha\nbo\ndelta');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
          direction: DirectionNone,
        },
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('cuts a line once when multiple carets share it', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
          direction: 'none',
        },
        {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 4 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(getContentElement(component));

      expect(writes).toEqual([
        ['text', 'bravo\n'],
        [
          MULTI_SELECTION_CLIPBOARD_TYPE,
          JSON.stringify(['bravo\n', 'bravo\n']),
        ],
      ]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('cuts a line once when a range overlaps a caret on the same line', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 4 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(getContentElement(component));

      expect(writes).toEqual([
        ['text', 'bravo\n'],
        [MULTI_SELECTION_CLIPBOARD_TYPE, JSON.stringify(['br', 'bravo\n'])],
      ]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('copies the whole line including its break when collapsed', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(getContentElement(component));

      // Copy matches cut: a collapsed caret yields the whole logical line.
      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('copies the final line without a trailing break', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(getContentElement(component));

      expect(writes).toEqual([['text', 'charlie']]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('pastes copied selection texts into matching selections', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'one two\nthree four\n---\nAA\nBB',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
          direction: 'forward',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
          direction: 'forward',
        },
      ]);

      const clipboardData = dispatchCopyData(getContentElement(component));
      expect(clipboardData.writes).toEqual([
        ['text', 'one\nthree'],
        [MULTI_SELECTION_CLIPBOARD_TYPE, JSON.stringify(['one', 'three'])],
      ]);

      editor.setSelections([
        {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 2 },
          direction: 'forward',
        },
      ]);
      dispatchPaste(getContentElement(component), clipboardData);
      await wait();

      expect(editor.getText()).toBe('one two\nthree four\n---\none\nthree');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('uses plain text when metadata and selection counts differ', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'AA\nBB\nCC',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      const clipboardData = new TestClipboardData('plain');
      clipboardData.setData(
        MULTI_SELECTION_CLIPBOARD_TYPE,
        JSON.stringify(['one\n', 'two\n'])
      );
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 2 },
          direction: 'forward',
        },
      ]);
      dispatchPaste(getContentElement(component), clipboardData);

      expect(editor.getText()).toBe('plain\nplain\nplain');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('allows the first browser paste shortcut in a diff and suppresses repeat paste', async () => {
    const fixture = await createDiffEditorFixture('alpha\nold', 'alpha\nnew');
    const { editor, container } = fixture;

    try {
      const content = findAdditionContent(container);
      expect(content).toBeDefined();
      if (content == null) {
        return;
      }

      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const firstKeydown = dispatchPasteShortcutKeydown(content, false, {
        key: 'V',
        shiftKey: true,
      });
      expect(firstKeydown.defaultPrevented).toBe(false);
      dispatchPaste(content, ' bravo');
      expect(editor.getText()).toBe('alpha bravo\nnew');

      const repeatKeydown = dispatchPasteShortcutKeydown(content, true, {
        key: 'V',
        shiftKey: true,
      });
      expect(repeatKeydown.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('alpha bravo\nnew');
    } finally {
      await fixture.cleanup();
    }
  });

  test('reads from a custom clipboard provider on repeat paste shortcut', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const editor = new Editor('file', {
      clipboard: {
        readText: () => {
          reads++;
          return ' bravo';
        },
      },
    });
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const repeatKeydown = dispatchPasteShortcutKeydown(
        getContentElement(component),
        true
      );
      await wait();

      expect(repeatKeydown.defaultPrevented).toBe(true);
      expect(reads).toBe(1);
      expect(editor.getText()).toBe('alpha bravo');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('reads from a custom clipboard provider on first paste shortcut', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const editor = new Editor('file', {
      clipboard: {
        readText: () => {
          reads++;
          return ' bravo';
        },
      },
    });
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const keydown = dispatchPasteShortcutKeydown(
        getContentElement(component)
      );
      await wait();

      expect(keydown.defaultPrevented).toBe(true);
      expect(reads).toBe(1);
      expect(editor.getText()).toBe('alpha bravo');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('reads matching selections from a custom clipboard provider', async () => {
    const { cleanup } = installDom();
    const reads: Array<string | undefined> = [];

    const editor = new Editor('file', {
      clipboard: {
        readText: (type) => {
          reads.push(type);
          return type === MULTI_SELECTION_CLIPBOARD_TYPE
            ? JSON.stringify(['one', 'two'])
            : 'one\ntwo';
        },
      },
    });
    const component = createTestFile({
      name: 'example.txt',
      contents: 'AA\nBB',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 2 },
          direction: 'forward',
        },
      ]);

      const keydown = dispatchPasteShortcutKeydown(
        getContentElement(component)
      );
      await wait();

      expect(keydown.defaultPrevented).toBe(true);
      expect(reads).toEqual([undefined, MULTI_SELECTION_CLIPBOARD_TYPE]);
      expect(editor.getText()).toBe('one\ntwo');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('uses custom clipboard plain text when selection counts differ', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file', {
      clipboard: {
        readText: (type) =>
          type === MULTI_SELECTION_CLIPBOARD_TYPE
            ? JSON.stringify(['one\n', 'two\n'])
            : 'plain',
      },
    });
    const component = createTestFile({
      name: 'example.txt',
      contents: 'AA\nBB\nCC',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 2 },
          direction: 'forward',
        },
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 2 },
          direction: 'forward',
        },
      ]);

      dispatchPasteShortcutKeydown(getContentElement(component));
      await wait();

      expect(editor.getText()).toBe('plain\nplain\nplain');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('rewrites Windows clipboard line breaks to the document EOL on paste', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 7 },
          direction: 'none',
        },
      ]);

      dispatchPaste(getContentElement(component), 'X\r\nY');

      // The clipboard \r\n is rewritten to the document's \n, so no stray
      // carriage return survives in the file.
      expect(editor.getText()).toBe('alpha\nbravo\ncharlieX\nY');
      expect(editor.getText()).not.toContain('\r');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('rewrites lone carriage returns to the document EOL on paste', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\nbravo',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      dispatchPaste(getContentElement(component), 'X\rY');

      expect(editor.getText()).toBe('alpha\nbravoX\nY');
      expect(editor.getText()).not.toContain('\r');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses CRLF', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\r\nbravo',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      // The clipboard carries Unix \n but the document is CRLF, so the paste
      // is rewritten to \r\n rather than left as a mismatched \n.
      dispatchPaste(getContentElement(component), 'X\nY');

      expect(editor.getText()).toBe('alpha\r\nbravoX\r\nY');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses lone CR', async () => {
    const { cleanup } = installDom();

    const editor = new Editor('file');
    const component = createTestFile({
      name: 'example.txt',
      contents: 'a\rb',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
          direction: 'none',
        },
      ]);

      dispatchPaste(getContentElement(component), 'x\ny');

      expect(editor.getText()).toBe('a\rbx\ry');
      expect(editor.getText()).not.toContain('\n');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('custom clipboard provider matches the document EOL when the file uses CRLF', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const editor = new Editor('file', {
      clipboard: {
        readText: () => {
          reads++;
          return 'X\nY';
        },
      },
    });
    const component = createTestFile({
      name: 'example.txt',
      contents: 'alpha\r\nbravo',
      lang: 'text',
    });

    try {
      await attachEditor(editor, component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      const keydown = dispatchPasteShortcutKeydown(
        getContentElement(component)
      );
      await wait();

      expect(keydown.defaultPrevented).toBe(true);
      expect(reads).toBe(1);
      expect(editor.getText()).toBe('alpha\r\nbravoX\r\nY');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });
});

describe('Editor line break input', () => {
  for (const inputType of ['insertLineBreak', 'insertParagraph'] as const) {
    test(`${inputType} inserts the document EOL when the file uses CRLF`, async () => {
      const { cleanup } = installDom();

      const editor = new Editor('file');
      const component = createTestFile({
        name: 'example.txt',
        contents: 'alpha\r\nbravo',
        lang: 'text',
      });

      try {
        await attachEditor(editor, component);
        editor.setSelections([
          {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 5 },
            direction: 'none',
          },
        ]);

        dispatchBeforeInput(getContentElement(component), inputType);

        expect(editor.getText()).toBe('alpha\r\nbravo\r\n');
      } finally {
        editor.cleanUp();
        cleanup();
      }
    });
  }
});
