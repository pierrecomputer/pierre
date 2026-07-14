import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { DirectionNone } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  DiffsTextDocument,
  FileContents,
  HighlightedToken,
  RenderRange,
} from '../src/types';
import { installDom, wait } from './domHarness';

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
  editor: Editor<undefined>;
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
  const editor = new Editor<undefined>();

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

function createTestHighlighter(): DiffsHighlighter {
  return {
    getLanguage: () => undefined,
    getLoadedLanguages: () => [],
    getTheme: () => ({ colors: {} }),
    loadLanguage: async () => {},
    setTheme: () => ({ colorMap: [''] }),
  } as unknown as DiffsHighlighter;
}

class TestEditableComponent implements DiffsEditableComponent<undefined> {
  readonly type = 'file' as const;
  readonly top = 0;
  readonly fileContainer = document.createElement('div');
  options: DiffsEditableComponent<undefined>['options'] = {
    theme: 'github-light',
    themeType: 'light',
  };

  #editor?: DiffsEditor<undefined>;
  #file: FileContents;
  #lineAnnotations?: DiffLineAnnotation<undefined>[];
  #renderRange?: RenderRange;

  constructor(file: FileContents) {
    this.#file = file;
    this.#renderShadowDom();
  }

  get contentElement(): HTMLElement {
    const contentElement =
      this.fileContainer.shadowRoot?.querySelector<HTMLElement>(
        '[data-content]'
      );
    if (contentElement === null || contentElement === undefined) {
      throw new Error('missing test editor content element');
    }
    return contentElement;
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  setEditorActiveLine(_lineNumber: number | null): void {}

  render({
    file,
    lineAnnotations,
    renderRange,
  }: {
    file?: FileContents;
    lineAnnotations?: DiffLineAnnotation<undefined>[];
    renderRange?: RenderRange;
  }): void {
    if (file !== undefined) {
      this.#file = file;
    }
    this.#lineAnnotations = lineAnnotations;
    this.#renderRange = renderRange;
    this.#renderShadowDom();
    this.#syncRenderView();
  }

  rerender(): void {
    this.#renderShadowDom();
    this.#syncRenderView();
  }

  cleanUp(): void {
    this.#editor = undefined;
  }

  attachEditor(editor: DiffsEditor<undefined>): () => void {
    this.#editor = editor;
    this.#syncRenderView();
    return () => {
      this.#editor = undefined;
    };
  }

  applyDocumentChange(
    textDocument: DiffsTextDocument,
    newLineAnnotations?: DiffLineAnnotation<undefined>[]
  ): void {
    this.#file = {
      ...this.#file,
      contents: textDocument.getText(),
    };
    this.#lineAnnotations = newLineAnnotations;
  }

  updateRenderCache(
    _lines: Map<number, Array<HighlightedToken>>,
    _themeType: 'dark' | 'light',
    _shouldRefreshView: boolean
  ): void {}

  #syncRenderView(): void {
    this.#editor?.__syncRenderView(
      createTestHighlighter(),
      this.fileContainer,
      this.#file,
      this.#lineAnnotations,
      this.#renderRange
    );
  }

  #renderShadowDom(): void {
    const shadowRoot =
      this.fileContainer.shadowRoot ??
      this.fileContainer.attachShadow({ mode: 'open' });
    shadowRoot.replaceChildren();

    const code = document.createElement('div');
    code.dataset.code = '';

    const gutter = document.createElement('div');
    gutter.dataset.gutter = '';

    const content = document.createElement('div');
    content.dataset.content = '';

    const lines = this.#file.contents.split('\n');
    for (const [index, line] of lines.entries()) {
      const lineNumber = String(index + 1);

      const gutterLine = document.createElement('div');
      gutterLine.dataset.lineType = 'context';
      gutterLine.dataset.columnNumber = lineNumber;
      gutterLine.dataset.lineIndex = String(index);
      gutterLine.textContent = lineNumber;
      gutter.appendChild(gutterLine);

      const contentLine = document.createElement('div');
      contentLine.dataset.line = lineNumber;
      contentLine.dataset.lineType = 'context';
      contentLine.dataset.lineIndex = String(index);
      contentLine.textContent = line;
      content.appendChild(contentLine);
    }

    code.append(gutter, content);
    shadowRoot.appendChild(code);
  }
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
  test('cuts the current line when the primary selection is collapsed', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getState().selections).toEqual([
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

  test('cuts every collapsed selection line in a multi-cursor cut', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([
        ['text', 'alpha\ncharlie\n'],
        [
          MULTI_SELECTION_CLIPBOARD_TYPE,
          JSON.stringify(['alpha\n', 'charlie\n']),
        ],
      ]);
      expect(editor.getText()).toBe('bravo\ndelta');
      expect(editor.getState().selections).toEqual([
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

  test('cuts mixed ranges and collapsed selection lines together', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([
        ['text', 'rav\ncharlie\n'],
        [MULTI_SELECTION_CLIPBOARD_TYPE, JSON.stringify(['rav', 'charlie\n'])],
      ]);
      expect(editor.getText()).toBe('alpha\nbo\ndelta');
      expect(editor.getState().selections).toEqual([
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

  test('cuts a line once when multiple carets share it', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([
        ['text', 'bravo\n'],
        [
          MULTI_SELECTION_CLIPBOARD_TYPE,
          JSON.stringify(['bravo\n', 'bravo\n']),
        ],
      ]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getState().selections).toEqual([
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

  test('cuts a line once when a range overlaps a caret on the same line', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([
        ['text', 'bravo\n'],
        [MULTI_SELECTION_CLIPBOARD_TYPE, JSON.stringify(['br', 'bravo\n'])],
      ]);
      expect(editor.getText()).toBe('alpha\ncharlie');
      expect(editor.getState().selections).toEqual([
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

  test('copies the whole line including its break when collapsed', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(component.contentElement);

      // Copy matches cut: a collapsed caret yields the whole logical line.
      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('copies the final line without a trailing break', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(component.contentElement);

      expect(writes).toEqual([['text', 'charlie']]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('pastes copied selection texts into matching selections', async () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'one two\nthree four\n---\nAA\nBB',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const clipboardData = dispatchCopyData(component.contentElement);
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
      dispatchPaste(component.contentElement, clipboardData);
      await wait();

      expect(editor.getText()).toBe('one two\nthree four\n---\none\nthree');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('uses plain text when metadata and selection counts differ', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'AA\nBB\nCC',
      lang: 'text',
    });

    try {
      editor.edit(component);
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
      dispatchPaste(component.contentElement, clipboardData);

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

    const editor = new Editor<undefined>({
      clipboard: {
        readText: () => {
          reads++;
          return ' bravo';
        },
      },
    });
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const repeatKeydown = dispatchPasteShortcutKeydown(
        component.contentElement,
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

    const editor = new Editor<undefined>({
      clipboard: {
        readText: () => {
          reads++;
          return ' bravo';
        },
      },
    });
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const keydown = dispatchPasteShortcutKeydown(component.contentElement);
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

    const editor = new Editor<undefined>({
      clipboard: {
        readText: (type) => {
          reads.push(type);
          return type === MULTI_SELECTION_CLIPBOARD_TYPE
            ? JSON.stringify(['one', 'two'])
            : 'one\ntwo';
        },
      },
    });
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'AA\nBB',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      const keydown = dispatchPasteShortcutKeydown(component.contentElement);
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

    const editor = new Editor<undefined>({
      clipboard: {
        readText: (type) =>
          type === MULTI_SELECTION_CLIPBOARD_TYPE
            ? JSON.stringify(['one\n', 'two\n'])
            : 'plain',
      },
    });
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'AA\nBB\nCC',
      lang: 'text',
    });

    try {
      editor.edit(component);
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

      dispatchPasteShortcutKeydown(component.contentElement);
      await wait();

      expect(editor.getText()).toBe('plain\nplain\nplain');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('rewrites Windows clipboard line breaks to the document EOL on paste', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 7 },
          direction: 'none',
        },
      ]);

      dispatchPaste(component.contentElement, 'X\r\nY');

      // The clipboard \r\n is rewritten to the document's \n, so no stray
      // carriage return survives in the file.
      expect(editor.getText()).toBe('alpha\nbravo\ncharlieX\nY');
      expect(editor.getText()).not.toContain('\r');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('rewrites lone carriage returns to the document EOL on paste', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      dispatchPaste(component.contentElement, 'X\rY');

      expect(editor.getText()).toBe('alpha\nbravoX\nY');
      expect(editor.getText()).not.toContain('\r');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses CRLF', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\r\nbravo',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      // The clipboard carries Unix \n but the document is CRLF, so the paste
      // is rewritten to \r\n rather than left as a mismatched \n.
      dispatchPaste(component.contentElement, 'X\nY');

      expect(editor.getText()).toBe('alpha\r\nbravoX\r\nY');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses lone CR', () => {
    const { cleanup } = installDom();

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'a\rb',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
          direction: 'none',
        },
      ]);

      // Classic-Mac files break lines on a lone \r, so the paste is rewritten
      // to \r rather than left as a mismatched \n.
      dispatchPaste(component.contentElement, 'x\ny');

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

    const editor = new Editor<undefined>({
      clipboard: {
        readText: () => {
          reads++;
          return 'X\nY';
        },
      },
    });
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\r\nbravo',
      lang: 'text',
    });

    try {
      editor.edit(component);
      editor.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      const keydown = dispatchPasteShortcutKeydown(component.contentElement);
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
    test(`${inputType} inserts the document EOL when the file uses CRLF`, () => {
      const { cleanup } = installDom();

      const editor = new Editor<undefined>();
      const component = new TestEditableComponent({
        name: 'example.txt',
        contents: 'alpha\r\nbravo',
        lang: 'text',
      });

      try {
        editor.edit(component);
        editor.setSelections([
          {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 5 },
            direction: 'none',
          },
        ]);

        dispatchBeforeInput(component.contentElement, inputType);

        expect(editor.getText()).toBe('alpha\r\nbravo\r\n');
      } finally {
        editor.cleanUp();
        cleanup();
      }
    });
  }
});
