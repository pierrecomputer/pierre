import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Edit } from '../src/edit/edit';
import { DirectionNone } from '../src/edit/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  DiffsEdit,
  DiffsEditableComponent,
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

// The edit attaches to the additions (new-file) side of a diff. That column
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

interface DiffEditFixture {
  container: HTMLElement;
  edit: Edit<undefined>;
  cleanup(): Promise<void>;
}

async function createDiffEditFixture(
  oldContents: string,
  newContents: string
): Promise<DiffEditFixture> {
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
  const edit = new Edit<undefined>();

  fileDiff.render({
    oldFile,
    newFile,
    fileContainer: container,
    forceRender: true,
  });
  edit.edit(fileDiff);

  for (let attempt = 0; attempt < 40; attempt++) {
    const content = findAdditionContent(container);
    if (content != null && content.getAttribute('contenteditable') === 'true') {
      break;
    }
    await wait(0);
  }

  return {
    container,
    edit,
    async cleanup() {
      await wait(10);
      edit.cleanUp();
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

  #edit?: DiffsEdit<undefined>;
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
      throw new Error('missing test edit content element');
    }
    return contentElement;
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

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
    this.#edit = undefined;
  }

  attachEdit(edit: DiffsEdit<undefined>): () => void {
    this.#edit = edit;
    this.#syncRenderView();
    return () => {
      this.#edit = undefined;
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
    this.#edit?.__syncRenderView(
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

function dispatchCut(target: HTMLElement): Array<[type: string, text: string]> {
  const writes: Array<[type: string, text: string]> = [];
  const event = new window.Event('cut', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData(type: string, text: string) {
        writes.push([type, text]);
      },
    },
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return writes;
}

function dispatchCopy(
  target: HTMLElement
): Array<[type: string, text: string]> {
  const writes: Array<[type: string, text: string]> = [];
  const event = new window.Event('copy', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData(type: string, text: string) {
        writes.push([type, text]);
      },
    },
  });

  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return writes;
}

function dispatchPaste(target: HTMLElement, text: string): void {
  const event = new window.Event('paste', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData(_type: string) {
        return text;
      },
    },
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

describe('Edit clipboard events', () => {
  test('cuts the current line when the primary selection is collapsed', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCut(component.contentElement);

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(edit.getText()).toBe('alpha\ncharlie');
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('cuts every collapsed selection line in a multi-cursor cut', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
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

      expect(writes).toEqual([['text', 'alpha\ncharlie\n']]);
      expect(edit.getText()).toBe('bravo\ndelta');
      expect(edit.getState().selections).toEqual([
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
      edit.cleanUp();
      cleanup();
    }
  });

  test('cuts mixed ranges and collapsed selection lines together', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie\ndelta',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
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

      expect(writes).toEqual([['text', 'rav\ncharlie\n']]);
      expect(edit.getText()).toBe('alpha\nbo\ndelta');
      expect(edit.getState().selections).toEqual([
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
      edit.cleanUp();
      cleanup();
    }
  });

  test('cuts a line once when multiple carets share it', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
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

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(edit.getText()).toBe('alpha\ncharlie');
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('cuts a line once when a range overlaps a caret on the same line', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
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

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(edit.getText()).toBe('alpha\ncharlie');
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('copies the whole line including its break when collapsed', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(component.contentElement);

      // Copy matches cut: a collapsed caret yields the whole logical line.
      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(edit.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('copies the final line without a trailing break', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 },
          direction: 'none',
        },
      ]);

      const writes = dispatchCopy(component.contentElement);

      expect(writes).toEqual([['text', 'charlie']]);
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('allows the first browser paste shortcut in a diff and suppresses repeat paste', async () => {
    const fixture = await createDiffEditFixture('alpha\nold', 'alpha\nnew');
    const { edit, container } = fixture;

    try {
      const content = findAdditionContent(container);
      expect(content).toBeDefined();
      if (content == null) {
        return;
      }

      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha bravo\nnew');

      const repeatKeydown = dispatchPasteShortcutKeydown(content, true, {
        key: 'V',
        shiftKey: true,
      });
      expect(repeatKeydown.defaultPrevented).toBe(true);
      expect(edit.getText()).toBe('alpha bravo\nnew');
    } finally {
      await fixture.cleanup();
    }
  });

  test('reads from a custom clipboard provider on repeat paste shortcut', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const edit = new Edit<undefined>({
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
      edit.edit(component);
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha bravo');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('reads from a custom clipboard provider on first paste shortcut', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const edit = new Edit<undefined>({
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
      edit.edit(component);
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha bravo');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('rewrites Windows clipboard line breaks to the document EOL on paste', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo\ncharlie',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 7 },
          direction: 'none',
        },
      ]);

      dispatchPaste(component.contentElement, 'X\r\nY');

      // The clipboard \r\n is rewritten to the document's \n, so no stray
      // carriage return survives in the file.
      expect(edit.getText()).toBe('alpha\nbravo\ncharlieX\nY');
      expect(edit.getText()).not.toContain('\r');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('rewrites lone carriage returns to the document EOL on paste', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\nbravo',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      dispatchPaste(component.contentElement, 'X\rY');

      expect(edit.getText()).toBe('alpha\nbravoX\nY');
      expect(edit.getText()).not.toContain('\r');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses CRLF', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'alpha\r\nbravo',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 1, character: 5 },
          end: { line: 1, character: 5 },
          direction: 'none',
        },
      ]);

      // The clipboard carries Unix \n but the document is CRLF, so the paste
      // is rewritten to \r\n rather than left as a mismatched \n.
      dispatchPaste(component.contentElement, 'X\nY');

      expect(edit.getText()).toBe('alpha\r\nbravoX\r\nY');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('matches the document EOL when the file uses lone CR', () => {
    const { cleanup } = installDom();

    const edit = new Edit<undefined>();
    const component = new TestEditableComponent({
      name: 'example.txt',
      contents: 'a\rb',
      lang: 'text',
    });

    try {
      edit.edit(component);
      edit.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 1 },
          direction: 'none',
        },
      ]);

      // Classic-Mac files break lines on a lone \r, so the paste is rewritten
      // to \r rather than left as a mismatched \n.
      dispatchPaste(component.contentElement, 'x\ny');

      expect(edit.getText()).toBe('a\rbx\ry');
      expect(edit.getText()).not.toContain('\n');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });

  test('custom clipboard provider matches the document EOL when the file uses CRLF', async () => {
    const { cleanup } = installDom();
    let reads = 0;

    const edit = new Edit<undefined>({
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
      edit.edit(component);
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha\r\nbravoX\r\nY');
    } finally {
      edit.cleanUp();
      cleanup();
    }
  });
});

describe('Edit line break input', () => {
  for (const inputType of ['insertLineBreak', 'insertParagraph'] as const) {
    test(`${inputType} inserts the document EOL when the file uses CRLF`, () => {
      const { cleanup } = installDom();

      const edit = new Edit<undefined>();
      const component = new TestEditableComponent({
        name: 'example.txt',
        contents: 'alpha\r\nbravo',
        lang: 'text',
      });

      try {
        edit.edit(component);
        edit.setSelections([
          {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 5 },
            direction: 'none',
          },
        ]);

        dispatchBeforeInput(component.contentElement, inputType);

        expect(edit.getText()).toBe('alpha\r\nbravo\r\n');
      } finally {
        edit.cleanUp();
        cleanup();
      }
    });
  }
});
