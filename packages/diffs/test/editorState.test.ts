import { describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  FileContents,
  HighlightedToken,
  RenderRange,
} from '../src/types';
import { installDom } from './domHarness';

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
  #lineAnnotations?: DiffLineAnnotation<undefined>[];
  #renderRange?: RenderRange;

  constructor(
    readonly scrollContainer: HTMLElement,
    private file: FileContents
  ) {
    this.#renderShadowDom();
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  getScrollContainer(): HTMLElement {
    return this.scrollContainer;
  }

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
      this.file = file;
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
    _textDocument: unknown,
    newLineAnnotations?: DiffLineAnnotation<undefined>[]
  ): void {
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
      this.file,
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

    const content = document.createElement('div');
    content.dataset.content = '';

    for (const [index, line] of this.file.contents.split('\n').entries()) {
      const contentLine = document.createElement('div');
      contentLine.dataset.line = String(index + 1);
      contentLine.dataset.lineType = 'context';
      contentLine.textContent = line;
      content.appendChild(contentLine);
    }

    code.appendChild(content);
    shadowRoot.appendChild(code);
  }
}

describe('Editor state', () => {
  test('setState restores the saved scroll position', () => {
    const dom = installDom();
    const scrollContainer = document.createElement('div');
    document.body.appendChild(scrollContainer);

    const scrollCalls: ScrollToOptions[] = [];
    scrollContainer.scrollTo = (
      options?: ScrollToOptions | number,
      y?: number
    ) => {
      const left =
        typeof options === 'number'
          ? options
          : (options?.left ?? scrollContainer.scrollLeft);
      const top =
        typeof options === 'number'
          ? (y ?? scrollContainer.scrollTop)
          : (options?.top ?? scrollContainer.scrollTop);
      scrollContainer.scrollLeft = left;
      scrollContainer.scrollTop = top;
      scrollCalls.push({ left, top });
    };

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent(scrollContainer, {
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      scrollContainer.scrollLeft = 24;
      scrollContainer.scrollTop = 128;
      const state = editor.getState();

      scrollContainer.scrollLeft = 0;
      scrollContainer.scrollTop = 0;
      editor.setState(state);

      expect(scrollContainer.scrollLeft).toBe(24);
      expect(scrollContainer.scrollTop).toBe(128);
      expect(scrollCalls).toEqual([{ left: 24, top: 128 }]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  // A remount restore often carries both a viewport and a caret that sits
  // outside that viewport. The saved view must win; scrolling the caret into
  // view would overwrite scrollTop/scrollLeft. jsdom's scrollIntoView is a
  // no-op, so stub it to mutate the scroll container the way a real browser
  // would when bringing an offscreen caret into view.
  test('setState keeps the saved view when the caret is outside it', () => {
    const dom = installDom();
    const scrollContainer = document.createElement('div');
    document.body.appendChild(scrollContainer);

    scrollContainer.scrollTo = (
      options?: ScrollToOptions | number,
      y?: number
    ) => {
      const left =
        typeof options === 'number'
          ? options
          : (options?.left ?? scrollContainer.scrollLeft);
      const top =
        typeof options === 'number'
          ? (y ?? scrollContainer.scrollTop)
          : (options?.top ?? scrollContainer.scrollTop);
      scrollContainer.scrollLeft = left;
      scrollContainer.scrollTop = top;
    };

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrollContainer.scrollTop = 999;
      scrollContainer.scrollLeft = 999;
    };

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent(scrollContainer, {
      name: 'state.ts',
      contents: 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\n',
    });

    try {
      editor.edit(component);
      editor.setState({
        selections: [
          {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 0 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 12, scrollTop: 40 },
      });

      expect(scrollContainer.scrollLeft).toBe(12);
      expect(scrollContainer.scrollTop).toBe(40);
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });
});
