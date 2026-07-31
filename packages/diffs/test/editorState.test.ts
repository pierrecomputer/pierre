import { describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import type { IStateStorage } from '../src/editor/stateStorage';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  EditorState,
  FileContents,
  HighlightedToken,
  RenderRange,
} from '../src/types';
import { installDom } from './domHarness';

function createTestHighlighter(): DiffsHighlighter {
  return {
    getLanguage: () => undefined,
    getLoadedLanguages: () => [],
    getTheme: () => ({ type: 'light', colors: {} }),
    loadLanguage: async () => {},
    setTheme: () => ({ theme: { type: 'light' }, colorMap: [''] }),
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
  viewportScroll: { top: number; left: number } | undefined;
  restoredViewportScrolls: { top: number; left: number }[] = [];

  constructor(private file: FileContents) {
    this.#renderShadowDom();
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  setEditorActiveLine(_lineNumber: number | null): void {}

  __getEffectiveCodeOptions(): DiffsEditableComponent<undefined>['options'] {
    return this.options;
  }

  getViewportScroll(): { top: number; left: number } | undefined {
    return this.viewportScroll;
  }

  setViewportScroll(position: { top: number; left: number }): void {
    this.viewportScroll = position;
    this.restoredViewportScrolls.push(position);
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
    _themeType: 'dark' | 'light'
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
  test('getState captures viewport scroll state', () => {
    const dom = installDom();
    const editor = new Editor<undefined>();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      component.viewportScroll = { top: 128, left: 24 };

      expect(editor.getState().view).toEqual({
        scrollTop: 128,
        scrollLeft: 24,
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

      expect(component.restoredViewportScrolls).toEqual([
        { top: 128, left: 24 },
      ]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('missing persisted state resets view scroll offsets', () => {
    const dom = installDom();
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: {
        get: () => undefined,
        set() {},
      },
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      cacheKey: 'state.ts',
    });
    component.viewportScroll = { top: 128, left: 24 };

    try {
      editor.edit(component);

      expect(component.restoredViewportScrolls).toEqual([{ top: 0, left: 0 }]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('automatic persistence stores horizontal state', () => {
    const dom = installDom();
    let storedState: EditorState | undefined;
    const storage: IStateStorage = {
      get() {
        return undefined;
      },
      set(_cacheKey, state) {
        storedState = state;
      },
    };
    const editor = new Editor<undefined>({
      persistState: true,
      persistStateStorage: storage,
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      cacheKey: 'state.ts',
    });

    try {
      editor.edit(component);
      component.viewportScroll = { top: 128, left: 24 };
      editor.cleanUp();

      expect(storedState?.view).toEqual({ scrollLeft: 24, scrollTop: 128 });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  // A remount restore often carries both a viewport and a caret that sits
  // outside that viewport. The saved view must win; scrolling the caret into
  // view would overwrite it. jsdom's scrollIntoView is a no-op, so record any
  // attempt to reveal the caret after restoring the saved logical view.
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
        view: { scrollTop: 40, scrollLeft: 12 },
      });

      expect(component.restoredViewportScrolls).toEqual([
        { top: 40, left: 12 },
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
