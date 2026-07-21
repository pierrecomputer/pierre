import { describe, expect, mock, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import { queueRender } from '../src/managers/UniversalRenderingManager';
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

const FILE_CONTENTS = 'alpha\nbravo\ncharlie';

function createFile(): FileContents {
  return { name: 'sample.ts', contents: FILE_CONTENTS, lang: 'text' };
}

// Insert `text` at the very start of the document, recording undo history.
function insertAtStart(editor: Editor<undefined>, text: string): void {
  editor.applyEdits(
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

describe('Editor onAttach lifecycle', () => {
  test('ignores pending notifications and late syncs after full cleanup', async () => {
    const dom = installDom();
    const onAttach = mock(
      (
        _editor: Editor<undefined>,
        _component: DiffsEditableComponent<undefined>
      ) => {}
    );
    const editor = new Editor<undefined>({ onAttach });
    const component = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      editor.cleanUp();
      component.cleanUp();

      await wait(0);
      expect(onAttach).not.toHaveBeenCalled();

      editor.__syncRenderView(
        createTestHighlighter(),
        component.fileContainer,
        createFile(),
        undefined,
        undefined
      );
      await wait(0);

      expect(onAttach).not.toHaveBeenCalled();
      expect(editor.getFile()).toBeUndefined();
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('reschedules a canceled recycle notification without duplicates', async () => {
    const dom = installDom();
    let onAttachCompleted = 0;
    const onAttach = mock(
      (
        attachedEditor: Editor<undefined>,
        _component: DiffsEditableComponent<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted++;
      }
    );
    const editor = new Editor<undefined>({ onAttach });
    const first = new TestEditableComponent(createFile());
    let second: TestEditableComponent | undefined;
    let third: TestEditableComponent | undefined;
    try {
      editor.edit(first);
      editor.cleanUp(true);
      first.cleanUp();

      await wait(0);
      expect(onAttach).not.toHaveBeenCalled();

      second = new TestEditableComponent(createFile());
      editor.edit(second);
      second.rerender();
      second.rerender();
      await wait(0);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(1);
      expect(onAttach.mock.calls[0]?.[1]).toBe(second);

      editor.cleanUp(true);
      second.cleanUp();
      third = new TestEditableComponent(createFile());
      editor.edit(third);
      await wait(0);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(1);
    } finally {
      editor.cleanUp();
      first.cleanUp();
      second?.cleanUp();
      third?.cleanUp();
      dom.cleanup();
    }
  });

  test('ignores a stale callback already copied into the render pass', async () => {
    const dom = installDom();
    let onAttachCompleted = 0;
    const onAttach = mock(
      (
        attachedEditor: Editor<undefined>,
        _component: DiffsEditableComponent<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted++;
      }
    );
    const editor = new Editor<undefined>({ onAttach });
    const first = new TestEditableComponent(createFile());
    let second: TestEditableComponent | undefined;
    let replacementStarted = false;
    try {
      queueRender(() => {
        editor.cleanUp();
        first.cleanUp();
        second = new TestEditableComponent(createFile());
        editor.edit(second);
        replacementStarted = true;
      });
      editor.edit(first);

      await wait(0);
      expect(replacementStarted).toBe(true);
      expect(onAttach).not.toHaveBeenCalled();
      if (second === undefined) {
        throw new Error('replacement attachment did not start');
      }

      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(1);
      expect(onAttach.mock.calls[0]?.[1]).toBe(second);
    } finally {
      editor.cleanUp();
      first.cleanUp();
      second?.cleanUp();
      dom.cleanup();
    }
  });

  test('notifies once for each session separated by full cleanup', async () => {
    const dom = installDom();
    const onAttach = mock(
      (
        _editor: Editor<undefined>,
        _component: DiffsEditableComponent<undefined>
      ) => {}
    );
    const editor = new Editor<undefined>({ onAttach });
    const first = new TestEditableComponent(createFile());
    let second: TestEditableComponent | undefined;
    try {
      editor.edit(first);
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);

      editor.cleanUp();
      first.cleanUp();
      second = new TestEditableComponent(createFile());
      editor.edit(second);
      await wait(0);

      expect(onAttach).toHaveBeenCalledTimes(2);
      expect(onAttach.mock.calls[1]?.[1]).toBe(second);
    } finally {
      editor.cleanUp();
      first.cleanUp();
      second?.cleanUp();
      dom.cleanup();
    }
  });
});

describe('Editor recycle cleanUp', () => {
  test('recycle keeps document and undo history across re-attach', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>();
      const first = new TestEditableComponent(createFile());
      editor.edit(first);
      insertAtStart(editor, 'X');
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Simulate a virtualized unmount: the host recycles, the editor is
      // detached non-destructively.
      editor.cleanUp(true);
      first.cleanUp();

      // Remount renders from the item's unchanged contents; the retained
      // document (holding the unsaved edit) must win over host contents.
      const second = new TestEditableComponent(createFile());
      editor.edit(second);
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Undo history lives in the retained document and survives with it.
      editor.undo();
      expect(editor.getText()).toBe(FILE_CONTENTS);

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('recycled re-attach recreates a tokenizer so edits still paint', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>();
      const first = new TestEditableComponent(createFile());
      editor.edit(first);

      editor.cleanUp(true);
      first.cleanUp();

      // Re-attach with an unchanged name/lang/cacheKey skips the document
      // rebuild. The tokenizer must be recreated anyway, otherwise #rerender
      // bails and this edit would update the model without painting.
      const second = new TestEditableComponent(createFile());
      editor.edit(second);
      insertAtStart(editor, 'Y');

      expect(editor.getText()).toBe(`Y${FILE_CONTENTS}`);
      const firstLine = second.contentElement.children[0] as HTMLElement;
      expect(firstLine.textContent).toBe('Yalpha');

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('full cleanUp still rebuilds from host contents', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>();
      const first = new TestEditableComponent(createFile());
      editor.edit(first);
      insertAtStart(editor, 'X');
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      editor.cleanUp();
      first.cleanUp();

      // A destructive cleanUp drops the document, so the next edit() builds
      // from whatever the host currently renders and undo history is gone.
      const second = new TestEditableComponent(createFile());
      editor.edit(second);
      expect(second.contentElement.textContent).toBe('alphabravocharlie');

      editor.undo();
      expect(second.contentElement.textContent).toBe('alphabravocharlie');

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('recycle re-attach to a different file rebuilds without re-notifying', async () => {
    const dom = installDom();
    try {
      const onAttach = mock(
        (
          _editor: Editor<undefined>,
          _component: DiffsEditableComponent<undefined>
        ) => {}
      );
      const editor = new Editor<undefined>({ onAttach });
      const first = new TestEditableComponent(createFile());
      editor.edit(first);
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      insertAtStart(editor, 'X');

      editor.cleanUp(true);
      first.cleanUp();

      // Different file identity (name) — the retained document must not leak
      // into an unrelated file.
      const other = new TestEditableComponent({
        name: 'other.ts',
        contents: 'zulu',
        lang: 'text',
      });
      editor.edit(other);
      await wait(0);
      expect(other.contentElement.textContent).toBe('zulu');
      expect(onAttach).toHaveBeenCalledTimes(1);

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });
});
