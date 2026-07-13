import { describe, expect, test } from 'bun:test';

import { Edit } from '../src/edit/edit';
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

const FILE_CONTENTS = 'alpha\nbravo\ncharlie';

function createFile(): FileContents {
  return { name: 'sample.ts', contents: FILE_CONTENTS, lang: 'text' };
}

// Insert `text` at the very start of the document, recording undo history.
function insertAtStart(edit: Edit<undefined>, text: string): void {
  edit.applyEdits(
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: text,
      },
    ],
    true
  );
}

describe('Edit recycle cleanUp', () => {
  test('recycle keeps document and undo history across re-attach', () => {
    const dom = installDom();
    try {
      const edit = new Edit<undefined>();
      const first = new TestEditableComponent(createFile());
      edit.edit(first);
      insertAtStart(edit, 'X');
      expect(edit.getText()).toBe(`X${FILE_CONTENTS}`);

      // Simulate a virtualized unmount: the host recycles, edit mode is
      // detached non-destructively.
      edit.cleanUp(true);
      first.cleanUp();

      // Remount renders from the item's unchanged contents; the retained
      // document (holding the unsaved edit) must win over host contents.
      const second = new TestEditableComponent(createFile());
      edit.edit(second);
      expect(edit.getText()).toBe(`X${FILE_CONTENTS}`);

      // Undo history lives in the retained document and survives with it.
      edit.undo();
      expect(edit.getText()).toBe(FILE_CONTENTS);

      edit.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('recycled re-attach recreates a tokenizer so edits still paint', () => {
    const dom = installDom();
    try {
      const edit = new Edit<undefined>();
      const first = new TestEditableComponent(createFile());
      edit.edit(first);

      edit.cleanUp(true);
      first.cleanUp();

      // Re-attach with an unchanged name/lang/cacheKey skips the document
      // rebuild. The tokenizer must be recreated anyway, otherwise #rerender
      // bails and this edit would update the model without painting.
      const second = new TestEditableComponent(createFile());
      edit.edit(second);
      insertAtStart(edit, 'Y');

      expect(edit.getText()).toBe(`Y${FILE_CONTENTS}`);
      const firstLine = second.contentElement.children[0] as HTMLElement;
      expect(firstLine.textContent).toBe('Yalpha');

      edit.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('full cleanUp still rebuilds from host contents', () => {
    const dom = installDom();
    try {
      const edit = new Edit<undefined>();
      const first = new TestEditableComponent(createFile());
      edit.edit(first);
      insertAtStart(edit, 'X');
      expect(edit.getText()).toBe(`X${FILE_CONTENTS}`);

      edit.cleanUp();
      first.cleanUp();

      // A destructive cleanUp drops the document, so the next edit() builds
      // from whatever the host currently renders and undo history is gone.
      const second = new TestEditableComponent(createFile());
      edit.edit(second);
      expect(second.contentElement.textContent).toBe('alphabravocharlie');

      edit.undo();
      expect(second.contentElement.textContent).toBe('alphabravocharlie');

      edit.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('recycle re-attach to a different file rebuilds the document', () => {
    const dom = installDom();
    try {
      const edit = new Edit<undefined>();
      const first = new TestEditableComponent(createFile());
      edit.edit(first);
      insertAtStart(edit, 'X');

      edit.cleanUp(true);
      first.cleanUp();

      // Different file identity (name) — the retained document must not leak
      // into an unrelated file.
      const other = new TestEditableComponent({
        name: 'other.ts',
        contents: 'zulu',
        lang: 'text',
      });
      edit.edit(other);
      expect(other.contentElement.textContent).toBe('zulu');

      edit.cleanUp();
    } finally {
      dom.cleanup();
    }
  });
});
