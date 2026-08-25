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
import { getLineAnnotationName } from '../src/utils/getLineAnnotationName';
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
  codeScrollLeft = 0;
  editorViewport: HTMLElement | Document | undefined;
  restoredCodeScrollLefts: number[] = [];
  stateRestoreError: Error | undefined;

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

  getCodeScrollLeft(): number {
    return this.codeScrollLeft;
  }

  setCodeScrollLeft(position: number): void {
    if (this.stateRestoreError != null) {
      throw this.stateRestoreError;
    }
    this.codeScrollLeft = position;
    this.restoredCodeScrollLefts.push(position);
  }

  getEditorViewport(): HTMLElement | Document | undefined {
    return this.editorViewport;
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

  emitEditChange(): void {}

  getAnnotationSlotName = getLineAnnotationName;

  completeEditSession(
    _editor: DiffsEditor<undefined>,
    _mode: 'install' | 'discard'
  ): void {}

  attachEditor(editor: DiffsEditor<undefined>): (_recycle: boolean) => void {
    this.#editor = editor;
    this.#syncRenderView();
    return (_recycle: boolean) => {
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
    this.#editor?.__syncRenderView({
      highlighter: createTestHighlighter(),
      fileContainer: this.fileContainer,
      file: this.file,
      lineAnnotations: this.#lineAnnotations,
      renderRange: this.#renderRange,
    });
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
  test('keyed state restores selections and view in a later editor', () => {
    const dom = installDom();
    Editor.clearDocuments();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    first.editorViewport = document.createElement('div');
    const firstEditor = new Editor<undefined>('file', {}, 'complete-state');
    const second = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    second.editorViewport = document.createElement('div');
    const secondEditor = new Editor<undefined>('file', {}, 'complete-state');

    try {
      firstEditor.edit(first);
      firstEditor.setState({
        selections: [
          {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 18, scrollTop: 36 },
      });
      firstEditor.cleanUp('discard');
      const detachedState = firstEditor.getState();
      Object.assign(detachedState.selections![0].start, {
        character: 0,
      });
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 18, scrollTop: 36 },
      });
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      Editor.clearDocuments();
      dom.cleanup();
    }
  });

  test('initialState restores selections and an owned viewport on first attach', () => {
    const dom = installDom();
    const viewport = document.createElement('div');
    const editor = new Editor<undefined>('file', {
      initialState: {
        selections: [
          {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 2 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24, scrollTop: 48 },
      },
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    component.editorViewport = viewport;

    try {
      editor.edit(component);

      expect(editor.getState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 2 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24, scrollTop: 48 },
      });
      expect(component.restoredCodeScrollLefts).toEqual([24]);
      expect(viewport.scrollTop).toBe(48);

      editor.cleanUp('recycle');
      expect(editor.getState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 2 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24, scrollTop: 48 },
      });
      component.codeScrollLeft = 8;
      viewport.scrollTop = 16;
      editor.edit(component);

      expect(editor.getState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 2 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 24, scrollTop: 48 },
      });
      expect(component.restoredCodeScrollLefts).toEqual([24, 24]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('initialState ignores vertical scroll without an owned viewport', () => {
    const dom = installDom();
    const originalScrollTo = window.scrollTo;
    let pageScrollCalls = 0;
    window.scrollTo = () => {
      pageScrollCalls++;
    };
    const editor = new Editor<undefined>('file', {
      initialState: {
        view: { scrollLeft: 24, scrollTop: 48 },
      },
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    const scrollAncestor = document.createElement('div');
    scrollAncestor.style.overflowY = 'scroll';
    scrollAncestor.scrollTop = 12;
    scrollAncestor.appendChild(component.fileContainer);
    document.body.appendChild(scrollAncestor);

    try {
      editor.edit(component);

      expect(component.restoredCodeScrollLefts).toEqual([24]);
      expect(scrollAncestor.scrollTop).toBe(12);
      expect(pageScrollCalls).toBe(0);
    } finally {
      window.scrollTo = originalScrollTo;
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('initialState remains available when hydration fails', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {
      initialState: {
        view: { scrollLeft: 24 },
      },
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    const stateRestoreError = new Error('state restoration failed');
    component.stateRestoreError = stateRestoreError;

    try {
      expect(() => editor.edit(component)).toThrow(stateRestoreError);
      component.stateRestoreError = undefined;
      editor.edit(component);

      expect(component.restoredCodeScrollLefts).toEqual([24]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('getState omits view state without an owned element viewport', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file');
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      component.codeScrollLeft = 24;

      expect(editor.getState().view).toBeUndefined();
      component.editorViewport = document;
      expect(editor.getState().view).toBeUndefined();
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('getState captures view state from an owned element viewport', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file');
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    const viewport = document.createElement('div');
    component.editorViewport = viewport;

    try {
      editor.edit(component);
      component.codeScrollLeft = 24;
      viewport.scrollTop = 48;

      expect(editor.getState().view).toEqual({
        scrollLeft: 24,
        scrollTop: 48,
      });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('setState restores view state through the editable component', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file');
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      editor.setState({ view: { scrollLeft: 24 } });

      expect(component.restoredCodeScrollLefts).toEqual([24]);
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

    const editor = new Editor<undefined>('file');
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
        view: { scrollLeft: 12 },
      });

      expect(component.restoredCodeScrollLefts).toEqual([12]);
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
