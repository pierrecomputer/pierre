import { describe, expect, test } from 'bun:test';

import type { Virtualizer } from '../src/components/Virtualizer';
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
  codeScrollPosition = 0;
  virtualizerScrollTop = 0;
  restoredCodeScrollPositions: number[] = [];
  restoredVirtualizerScrollPositions: unknown[] = [];
  readonly virtualizer = {
    type: 'simple',
    getScrollTop: () => this.virtualizerScrollTop,
    scrollTo: (target: unknown) => {
      this.restoredVirtualizerScrollPositions.push(target);
    },
  } as unknown as Virtualizer;

  constructor(private file: FileContents) {
    this.#renderShadowDom();
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  setEditorActiveLine(_lineNumber: number | null): void {}

  getCodeScrollLeft(): number {
    return this.codeScrollPosition;
  }

  setCodeScrollLeft(position: number): void {
    this.codeScrollPosition = position;
    this.restoredCodeScrollPositions.push(position);
  }

  __getVirtualizer(): Virtualizer {
    return this.virtualizer;
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
  test('getState captures view state from the editable component', () => {
    const dom = installDom();
    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      component.codeScrollPosition = 24;
      component.virtualizerScrollTop = 128;

      expect(editor.getState().view).toEqual({
        scrollLeft: 24,
        scrollTop: 128,
      });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('setState restores view state through the editable component', () => {
    const dom = installDom();
    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      editor.setState({ view: { scrollLeft: 24, scrollTop: 128 } });

      expect(component.restoredCodeScrollPositions).toEqual([24]);
      expect(component.restoredVirtualizerScrollPositions).toEqual([
        { top: 128, behavior: 'instant' },
      ]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  // A remount restore often carries both a viewport and a caret that sits
  // outside that viewport. The saved view must win; scrolling the caret into
  // view would overwrite it. jsdom's scrollIntoView is a no-op, so record any
  // attempt to reveal the caret after restoring the component-owned view.
  test('setState keeps the saved view when the caret is outside it', () => {
    const dom = installDom();
    let scrollIntoViewCalls = 0;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrollIntoViewCalls++;
    };

    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
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

      expect(component.restoredCodeScrollPositions).toEqual([12]);
      expect(component.restoredVirtualizerScrollPositions).toEqual([
        { top: 40, behavior: 'instant' },
      ]);
      expect(scrollIntoViewCalls).toBe(0);
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
