import { describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import { DirectionNone } from '../src/editor/selection';
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
import { installDom } from './domHarness';

function createTestHighlighter(): DiffsHighlighter {
  return {
    getLoadedLanguages: () => [],
    getTheme: () => ({ colors: {} }),
    setTheme: () => ({ colorMap: [''] }),
  } as unknown as DiffsHighlighter;
}

function createMatchMedia(): typeof window.matchMedia {
  return ((query: string) =>
    ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }) as MediaQueryList) as typeof window.matchMedia;
}

function installEditorDom() {
  const dom = installDom();
  window.matchMedia = createMatchMedia();
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLElement.prototype.scrollIntoView = () => {};
  return dom;
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
    _shouldRerender?: boolean
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

describe('Editor clipboard events', () => {
  test('cuts the current line when the primary selection is collapsed', () => {
    const { cleanup } = installEditorDom();

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
      expect(editor.getState().file.contents).toBe('alpha\ncharlie');
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
    const { cleanup } = installEditorDom();

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

      expect(writes).toEqual([['text', 'alpha\ncharlie\n']]);
      expect(editor.getState().file.contents).toBe('bravo\ndelta');
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
    const { cleanup } = installEditorDom();

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

      expect(writes).toEqual([['text', 'rav\ncharlie\n']]);
      expect(editor.getState().file.contents).toBe('alpha\nbo\ndelta');
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
    const { cleanup } = installEditorDom();

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

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getState().file.contents).toBe('alpha\ncharlie');
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
    const { cleanup } = installEditorDom();

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

      expect(writes).toEqual([['text', 'bravo\n']]);
      expect(editor.getState().file.contents).toBe('alpha\ncharlie');
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
    const { cleanup } = installEditorDom();

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
      expect(editor.getState().file.contents).toBe('alpha\nbravo\ncharlie');
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });

  test('copies the final line without a trailing break', () => {
    const { cleanup } = installEditorDom();

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
});
