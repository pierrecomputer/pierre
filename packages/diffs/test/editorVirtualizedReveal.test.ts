import { describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  DiffsTextDocument,
  FileContents,
  HighlightedToken,
} from '../src/types';
import { installDom } from './domHarness';

const MODEL_LINE_TOP = 20;

function createTestHighlighter(): DiffsHighlighter {
  return {
    getLanguage: () => undefined,
    getLoadedLanguages: () => [],
    getTheme: () => ({ colors: {} }),
    loadLanguage: async () => {},
    setTheme: () => ({ colorMap: [''] }),
  } as unknown as DiffsHighlighter;
}

class VirtualizedEditableComponent implements DiffsEditableComponent<undefined> {
  readonly type = 'file' as const;
  readonly top = 0;
  readonly fileContainer = document.createElement('div');
  options: DiffsEditableComponent<undefined>['options'] = {
    theme: 'github-light',
    themeType: 'light',
  };

  #editor?: DiffsEditor<undefined>;
  readonly #file: FileContents = {
    name: 'virtualized.ts',
    contents: 'first\nsecond\nthird',
    lang: 'text',
  };

  constructor(private readonly modelLineHeight: number) {
    document.body.appendChild(this.fileContainer);
    this.#renderShadowDom();
  }

  getLinePosition(
    lineNumber: number
  ): { top: number; height: number } | undefined {
    return lineNumber === 2
      ? { top: MODEL_LINE_TOP, height: this.modelLineHeight }
      : undefined;
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  setEditorActiveLine(_lineNumber: number | null): void {}

  render(): void {
    this.rerender();
  }

  rerender(): void {
    this.#renderShadowDom();
    this.#syncRenderView();
  }

  cleanUp(): void {
    this.#editor = undefined;
    this.fileContainer.remove();
  }

  attachEditor(editor: DiffsEditor<undefined>): () => void {
    this.#editor = editor;
    this.#syncRenderView();
    return () => {
      this.#editor = undefined;
    };
  }

  applyDocumentChange(
    _textDocument: DiffsTextDocument,
    _newLineAnnotations?: DiffLineAnnotation<undefined>[]
  ): void {}

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
      undefined,
      {
        // Render only line 3 so the selected line 2 remains virtualized.
        startingLine: 2,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      }
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
    content.style.lineHeight = '20px';

    const thirdLine = document.createElement('div');
    thirdLine.dataset.line = '3';
    thirdLine.dataset.lineIndex = '2';
    thirdLine.dataset.lineType = 'context';
    thirdLine.textContent = 'third';

    content.appendChild(thirdLine);
    code.appendChild(content);
    shadowRoot.appendChild(code);
  }
}

function revealOffscreenLine({
  modelLineHeight = 20,
  rerenderCount = 1,
}: {
  modelLineHeight?: number;
  rerenderCount?: number;
} = {}): number[] {
  const dom = installDom();
  const scrollTops: number[] = [];
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement) {
      const top = Number.parseFloat(this.style.top);
      if (Number.isFinite(top)) {
        scrollTops.push(top);
      }
    },
  });

  const editor = new Editor<undefined>();
  const component = new VirtualizedEditableComponent(modelLineHeight);

  try {
    editor.edit(component);
    editor.setSelections([
      {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
        direction: 'none',
      },
    ]);

    // Rerendering retries the reveal while line 2 is still offscreen.
    for (let i = 0; i < rerenderCount; i++) {
      component.rerender();
    }

    return scrollTops;
  } finally {
    editor.cleanUp();
    component.cleanUp();
    dom.cleanup();
  }
}

describe('Editor virtualized reveal', () => {
  test('keeps using model geometry when an offscreen reveal retries', () => {
    expect(revealOffscreenLine()).toEqual([MODEL_LINE_TOP, MODEL_LINE_TOP]);
  });

  test('stops retrying when model geometry has zero height', () => {
    expect(
      revealOffscreenLine({ modelLineHeight: 0, rerenderCount: 2 })
    ).toEqual([MODEL_LINE_TOP]);
  });
});
