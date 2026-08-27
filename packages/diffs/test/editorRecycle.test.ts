import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import { EditStateManager } from '../src/editor/EditStateManager';
import { queueRender } from '../src/managers/UniversalRenderingManager';
import type {
  CapturedDiffSessionState,
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  DiffsTextDocument,
  FileContents,
  HighlightedToken,
  RenderRange,
} from '../src/types';
import { getLineAnnotationName } from '../src/utils/getLineAnnotationName';
import { installDom, wait, waitFor } from './domHarness';

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
  readonly type: 'file' | 'file-diff';
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
  #queueRerender: boolean;
  #syncOnAttach: boolean;
  #onContentFocus?: (content: HTMLElement) => void;

  constructor(
    file: FileContents,
    {
      queueRerender = false,
      syncOnAttach = true,
      onContentFocus,
      type = 'file',
    }: {
      queueRerender?: boolean;
      syncOnAttach?: boolean;
      onContentFocus?: (content: HTMLElement) => void;
      type?: 'file' | 'file-diff';
    } = {}
  ) {
    this.type = type;
    this.#file = file;
    this.#queueRerender = queueRerender;
    this.#syncOnAttach = syncOnAttach;
    this.#onContentFocus = onContentFocus;
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

  get lineAnnotations(): DiffLineAnnotation<undefined>[] | undefined {
    return this.#lineAnnotations;
  }

  setOptions(options: Partial<DiffsEditableComponent<undefined>['options']>) {
    this.options = { ...this.options, ...options };
  }

  setSelectedLines(_range: { start: number; end: number } | null): void {}

  setEditorActiveLine(_lineNumber: number | null): void {}

  __getEffectiveCodeOptions(): DiffsEditableComponent<undefined>['options'] {
    return this.options;
  }

  __captureDocumentSessionState(): CapturedDiffSessionState | undefined {
    return this.type === 'file-diff'
      ? {
          diffSession: {
            oldFile: null,
            type: 'new',
            hunks: [],
          },
          hasChanges: true,
        }
      : undefined;
  }

  getCodeScrollLeft(): number {
    return 0;
  }

  setCodeScrollLeft(): void {}

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
    if (this.#queueRerender) {
      queueRender(() => {
        this.#renderShadowDom();
        void Promise.resolve().then(() => this.#syncRenderView());
      });
      return;
    }
    this.#renderShadowDom();
    this.#syncRenderView();
  }

  renderExternalFile(
    file: FileContents,
    lineAnnotations = this.#lineAnnotations
  ): void {
    this.#file = file;
    this.#lineAnnotations = lineAnnotations;
    this.#renderShadowDom();
    this.#syncRenderView(true);
  }

  cleanUp(recycle = false): void {
    if (!recycle) {
      this.#editor = undefined;
    }
  }

  emitEditChange(): void {}

  getAnnotationSlotName = getLineAnnotationName;

  completeEditSession(
    _editor: DiffsEditor<undefined>,
    _mode: 'install' | 'discard'
  ): void {}

  attachEditor(editor: DiffsEditor<undefined>): () => void {
    if (this.#editor != null) {
      throw new Error('TestEditableComponent: an editor is already attached');
    }
    const retainedDocument = editor.__getDocumentContents();
    if (retainedDocument != null) {
      this.#file = { ...this.#file, ...retainedDocument };
      this.#renderShadowDom();
    }
    this.#editor = editor;
    if (this.#syncOnAttach) {
      this.#syncRenderView();
    }
    return (recycle = false) => {
      if (!recycle) {
        this.#editor = undefined;
      }
    };
  }

  __resumeEditor(editor: DiffsEditor<undefined>): void {
    if (this.#editor !== editor) {
      throw new Error('TestEditableComponent: editor association changed');
    }
    this.rerender();
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
    _themeType: 'dark' | 'light'
  ): void {}

  #syncRenderView(externalDocument = false): void {
    this.#editor?.__syncRenderView({
      highlighter: createTestHighlighter(),
      fileContainer: this.fileContainer,
      file: this.#file,
      lineAnnotations: this.#lineAnnotations,
      renderRange: this.#renderRange,
      externalDocument,
      resetHistory: false,
    });
  }

  #renderShadowDom(): void {
    const shadowRoot =
      this.fileContainer.shadowRoot ??
      this.fileContainer.attachShadow({ mode: 'open' });
    shadowRoot.replaceChildren();
    if (this.#renderRange?.totalLines === 0) {
      return;
    }

    const code = document.createElement('div');
    code.dataset.code = '';

    const gutter = document.createElement('div');
    gutter.dataset.gutter = '';

    const content = document.createElement('div');
    content.dataset.content = '';
    if (this.#onContentFocus !== undefined) {
      content.focus = () => this.#onContentFocus?.(content);
    }

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

class IncompleteDiffEditableComponent extends TestEditableComponent {
  override __captureDocumentSessionState(): undefined {
    return undefined;
  }
}

class ThrowingEditableComponent extends TestEditableComponent {
  shouldThrow = true;

  override rerender(): void {
    if (this.shouldThrow) {
      throw new Error('attachment failed');
    }
    super.rerender();
  }
}

class SyncingThrowingEditableComponent extends TestEditableComponent {
  override attachEditor(editor: DiffsEditor<undefined>): () => void {
    super.attachEditor(editor);
    throw new Error('attachment failed after sync');
  }
}

class EditingSyncingThrowingEditableComponent extends TestEditableComponent {
  override attachEditor(editor: DiffsEditor<undefined>): () => void {
    super.attachEditor(editor);
    (editor as Editor<undefined>).applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'failed:',
      },
    ]);
    throw new Error('attachment failed after edit');
  }
}

class ExternalSyncThrowingEditableComponent extends TestEditableComponent {
  #replacement: FileContents;
  shouldThrow = true;

  constructor(file: FileContents, replacement: FileContents) {
    super(file);
    this.#replacement = replacement;
  }

  override rerender(): void {
    if (this.shouldThrow) {
      this.renderExternalFile(this.#replacement);
      throw new Error('attachment failed after external sync');
    }
    super.rerender();
  }
}

const FILE_CONTENTS = 'alpha\nbravo\ncharlie';

function createFile(overrides: Partial<FileContents> = {}): FileContents {
  return {
    name: 'sample.ts',
    contents: FILE_CONTENTS,
    lang: 'text',
    ...overrides,
  };
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
  test('waits for a queued host rerender to synchronize before notifying', async () => {
    const dom = installDom();
    const focusTargets: HTMLElement[] = [];
    const onAttach = mock((attachedEditor: Editor<undefined>) => {
      attachedEditor.focus({ preventScroll: true });
    });
    const editor = new Editor<undefined>('file', { onAttach });
    const component = new TestEditableComponent(createFile(), {
      queueRerender: true,
      onContentFocus: (content) => focusTargets.push(content),
    });
    try {
      // A queued host rerender (theme change, async highlight, hydration)
      // replaces the shadow DOM while the attach sync is still pending;
      // onAttach must wait for the replacement to synchronize.
      component.rerender();
      editor.edit(component);
      await waitFor(() => onAttach.mock.calls.length === 1);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(focusTargets).toHaveLength(1);
      expect(focusTargets[0] === component.contentElement).toBe(true);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('ignores pending notifications and late syncs after full cleanup', async () => {
    const dom = installDom();
    const onAttach = mock(
      (
        _editor: Editor<undefined>,
        _component: DiffsEditableComponent<undefined>
      ) => {}
    );
    const editor = new Editor<undefined>('file', { onAttach });
    const component = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      editor.cleanUp();
      component.cleanUp();

      await wait(0);
      expect(onAttach).not.toHaveBeenCalled();

      const file = createFile();
      editor.__syncRenderView({
        highlighter: createTestHighlighter(),
        fileContainer: component.fileContainer,
        file,
        lineAnnotations: undefined,
        renderRange: undefined,
      });
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
    const editor = new Editor<undefined>('file', { onAttach });
    const component = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      editor.cleanUp('recycle');
      component.cleanUp(true);

      await wait(0);
      expect(onAttach).not.toHaveBeenCalled();

      editor.edit(component);
      component.rerender();
      component.rerender();
      await wait(0);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(1);
      expect(onAttach.mock.calls[0]?.[1]).toBe(component);

      editor.cleanUp('recycle');
      component.cleanUp(true);
      editor.edit(component);
      await wait(0);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(1);
    } finally {
      editor.cleanUp();
      component.cleanUp();
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
    const editor = new Editor<undefined>('file', { onAttach });
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
    const editor = new Editor<undefined>('file', { onAttach });
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

describe('Editor edit-state manager', () => {
  beforeEach(() => {
    EditStateManager.clearAll();
    EditStateManager.setCapacity(100);
  });
  afterEach(() => {
    EditStateManager.clearAll();
    EditStateManager.setCapacity(100);
  });

  test('the same key resumes contents and undo history over incoming contents', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'shared');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'shared');
    const second = new TestEditableComponent(
      createFile({ contents: 'new external baseline' })
    );
    const thirdEditor = new Editor<undefined>('file', {}, 'shared');
    const third = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      firstEditor.cleanUp('discard');
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
      expect(second.contentElement.textContent).toContain('Xalpha');
      expect(secondEditor.canUndo).toBe(true);

      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(secondEditor.canRedo).toBe(true);
      secondEditor.cleanUp('discard');
      second.cleanUp();

      thirdEditor.edit(third);
      expect(thirdEditor.canRedo).toBe(true);
      thirdEditor.redo();
      expect(thirdEditor.getText()).toBe(`X${FILE_CONTENTS}`);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      thirdEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      third.cleanUp();
      dom.cleanup();
    }
  });

  test('no key builds fresh without reading cacheKey', () => {
    const dom = installDom();
    const file = createFile();
    Object.defineProperty(file, 'cacheKey', {
      get() {
        throw new Error('cacheKey should not be read by Editor');
      },
    });
    const firstEditor = new Editor<undefined>('file');
    const first = new TestEditableComponent(file);
    const secondEditor = new Editor<undefined>('file');
    const second = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      firstEditor.cleanUp('discard');
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(secondEditor.canUndo).toBe(false);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('a different key starts a fresh document', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'first');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'second');
    const second = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      firstEditor.cleanUp('discard');
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(secondEditor.canUndo).toBe(false);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  for (const [mismatch, changedFile] of [
    ['name', createFile({ name: 'other.ts' })],
    ['language', createFile({ lang: 'typescript' })],
  ] as const) {
    test(`${mismatch} mismatch does not replace a retained document`, () => {
      const dom = installDom();
      const firstEditor = new Editor<undefined>('file', {}, mismatch);
      const first = new TestEditableComponent(createFile());
      const secondEditor = new Editor<undefined>('file', {}, mismatch);
      const second = new TestEditableComponent(changedFile);
      try {
        firstEditor.edit(first);
        insertAtStart(firstEditor, 'X');
        firstEditor.cleanUp('discard');
        first.cleanUp();

        secondEditor.edit(second);
        expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
        expect(secondEditor.canUndo).toBe(true);
      } finally {
        firstEditor.cleanUp();
        secondEditor.cleanUp();
        first.cleanUp();
        second.cleanUp();
        dom.cleanup();
      }
    });
  }

  for (const reason of ['discard', 'recycle'] as const) {
    test(`${reason} keeps a retained document`, () => {
      const dom = installDom();
      const firstEditor = new Editor<undefined>('file', {}, reason);
      const first = new TestEditableComponent(createFile());
      const secondEditor = new Editor<undefined>('file', {}, reason);
      const second = new TestEditableComponent(createFile());
      try {
        firstEditor.edit(first);
        insertAtStart(firstEditor, 'X');
        firstEditor.cleanUp(reason);
        first.cleanUp();
        if (reason === 'recycle') {
          firstEditor.cleanUp('discard');
        }

        secondEditor.edit(second);
        expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
        expect(secondEditor.canUndo).toBe(true);
      } finally {
        firstEditor.cleanUp();
        secondEditor.cleanUp();
        first.cleanUp();
        second.cleanUp();
        dom.cleanup();
      }
    });
  }

  test('complete retains the current document and undo history', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'complete');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'complete');
    const second = new TestEditableComponent(createFile());
    try {
      const complete = firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      complete();

      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
      expect(secondEditor.canUndo).toBe(true);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('file-diff completion after recycle retains its document and history', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>(
      'file-diff',
      {},
      'recycled-diff-complete'
    );
    const first = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    const secondEditor = new Editor<undefined>(
      'file-diff',
      {},
      'recycled-diff-complete'
    );
    const second = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    try {
      const complete = firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      firstEditor.cleanUp('recycle');
      complete();

      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
      expect(secondEditor.canUndo).toBe(true);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('a clean file-diff retains selections with its compatible baseline', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>(
      'file-diff',
      {},
      'diff-selections'
    );
    const first = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    const secondEditor = new Editor<undefined>(
      'file-diff',
      {},
      'diff-selections'
    );
    const second = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    try {
      firstEditor.edit(first);
      firstEditor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);
      firstEditor.cleanUp('discard');
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getViewState().selections).toEqual([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 0,
        },
      ]);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('complete before initial sync retains the keyed document', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'complete');
    const first = new TestEditableComponent(createFile());
    const completingEditor = new Editor<undefined>('file', {}, 'complete');
    const mismatched = new TestEditableComponent(
      createFile({ name: 'other.ts' }),
      { syncOnAttach: false }
    );
    const freshEditor = new Editor<undefined>('file', {}, 'complete');
    const fresh = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      firstEditor.cleanUp('discard');
      first.cleanUp();

      const complete = completingEditor.edit(mismatched);
      complete();
      freshEditor.edit(fresh);
      expect(freshEditor.getText()).toBe(`X${FILE_CONTENTS}`);
      expect(freshEditor.canUndo).toBe(true);
    } finally {
      firstEditor.cleanUp();
      completingEditor.cleanUp();
      freshEditor.cleanUp();
      first.cleanUp();
      mismatched.cleanUp();
      fresh.cleanUp();
      dom.cleanup();
    }
  });

  test('clearing a fresh pending attachment is ignored while active', () => {
    const dom = installDom();
    const pendingEditor = new Editor<undefined>('file', {}, 'pending-disposal');
    const pending = new TestEditableComponent(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor<undefined>('file', {}, 'pending-disposal');
    const fresh = new TestEditableComponent(
      createFile({ contents: 'fresh contents' })
    );
    try {
      pendingEditor.edit(pending);
      expect(EditStateManager.clear('file', 'pending-disposal')).toBe(false);

      pending.rerender();
      expect(pendingEditor.getText()).toBe(FILE_CONTENTS);
      pendingEditor.cleanUp('discard');
      pending.cleanUp();

      freshEditor.edit(fresh);
      expect(freshEditor.getText()).toBe(FILE_CONTENTS);
      expect(freshEditor.canUndo).toBe(false);
    } finally {
      pendingEditor.cleanUp();
      freshEditor.cleanUp();
      pending.cleanUp();
      fresh.cleanUp();
      dom.cleanup();
    }
  });

  test('clearAll leaves fresh pending attachments active', () => {
    const dom = installDom();
    const pendingEditor = new Editor<undefined>('file', {}, 'pending-clear');
    const pending = new TestEditableComponent(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor<undefined>('file', {}, 'pending-clear');
    const fresh = new TestEditableComponent(
      createFile({ contents: 'fresh contents' })
    );
    try {
      pendingEditor.edit(pending);
      EditStateManager.clearAll();

      pending.rerender();
      expect(pendingEditor.getText()).toBe(FILE_CONTENTS);
      pendingEditor.cleanUp('discard');
      pending.cleanUp();

      freshEditor.edit(fresh);
      expect(freshEditor.getText()).toBe(FILE_CONTENTS);
      expect(freshEditor.canUndo).toBe(false);
    } finally {
      pendingEditor.cleanUp();
      freshEditor.cleanUp();
      pending.cleanUp();
      fresh.cleanUp();
      dom.cleanup();
    }
  });

  test('disposeFile and clearDocuments evict retained documents', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'first');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'second');
    const second = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'A');
      firstEditor.cleanUp('discard');
      first.cleanUp();
      secondEditor.edit(second);
      insertAtStart(secondEditor, 'B');
      secondEditor.cleanUp('discard');
      second.cleanUp();

      expect(EditStateManager.clear('file', 'first')).toBe(true);
      expect(EditStateManager.clear('file', 'first')).toBe(false);
      EditStateManager.clearAll();

      const freshFirst = new Editor<undefined>('file', {}, 'first');
      const freshFirstComponent = new TestEditableComponent(createFile());
      const freshSecond = new Editor<undefined>('file', {}, 'second');
      const freshSecondComponent = new TestEditableComponent(createFile());
      freshFirst.edit(freshFirstComponent);
      freshSecond.edit(freshSecondComponent);
      expect(freshFirst.getText()).toBe(FILE_CONTENTS);
      expect(freshSecond.getText()).toBe(FILE_CONTENTS);
      freshFirst.cleanUp();
      freshSecond.cleanUp();
      freshFirstComponent.cleanUp();
      freshSecondComponent.cleanUp();
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('getEditState omits retained state without a complete current diff session', () => {
    const dom = installDom();
    const sourceEditor = new Editor<undefined>('file-diff');
    const source = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    let editor: Editor<undefined> | undefined;
    let incomplete: IncompleteDiffEditableComponent | undefined;
    try {
      sourceEditor.edit(source);
      const initialState = sourceEditor.getEditState();
      expect(initialState).toBeDefined();

      editor = new Editor<undefined>('file-diff', {
        initialState: initialState!,
      });
      incomplete = new IncompleteDiffEditableComponent(createFile(), {
        type: 'file-diff',
      });
      editor.edit(incomplete);

      expect(editor.getEditState()).toBeUndefined();
      editor.cleanUp('recycle');
      expect(editor.getEditState()).toBeUndefined();
    } finally {
      sourceEditor.cleanUp();
      editor?.cleanUp();
      source.cleanUp();
      incomplete?.cleanUp();
      dom.cleanup();
    }
  });

  test('rejects concurrent editors using the same key', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'shared');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'shared');
    const second = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X');
      expect(() => secondEditor.edit(second)).toThrow(
        'editStateKey "shared" is already attached to another editor'
      );

      firstEditor.cleanUp('discard');
      first.cleanUp();
      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe(`X${FILE_CONTENTS}`);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('failed recycled reattachment keeps ownership of keyed state', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {}, 'recycled');
    const component = new ThrowingEditableComponent(createFile());
    component.shouldThrow = false;
    const competingEditor = new Editor<undefined>('file', {}, 'recycled');
    const competing = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      insertAtStart(editor, 'X');
      editor.cleanUp('recycle');
      component.cleanUp(true);
      const retainedUndoStack = EditStateManager.get<undefined>(
        'file',
        'recycled'
      )!.document.history.undoStack;

      component.shouldThrow = true;
      expect(() => editor.edit(component)).toThrow('attachment failed');
      expect(() => competingEditor.edit(competing)).toThrow(
        'editStateKey "recycled" is already attached to another editor'
      );

      component.shouldThrow = false;
      editor.edit(component);
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);
      expect(editor.getEditState()!.document.history.undoStack).toBe(
        retainedUndoStack
      );
    } finally {
      editor.cleanUp();
      competingEditor.cleanUp();
      component.cleanUp();
      competing.cleanUp();
      dom.cleanup();
    }
  });

  test('an editor cannot attach to a different surface kind', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {}, 'recycled-kind');
    const pendingFile = new TestEditableComponent(createFile(), {
      syncOnAttach: false,
    });
    const diff = new TestEditableComponent(createFile(), {
      type: 'file-diff',
    });
    try {
      editor.edit(pendingFile);
      editor.cleanUp('recycle');
      pendingFile.cleanUp(true);

      expect(() => editor.edit(diff)).toThrow(
        'a file editor cannot edit a file-diff component'
      );

      editor.edit(pendingFile);
      expect(editor.getText()).toBe(FILE_CONTENTS);
    } finally {
      editor.cleanUp();
      pendingFile.cleanUp();
      diff.cleanUp();
      dom.cleanup();
    }
  });

  test('failed recycled external sync keeps the transferred document', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {}, 'recycled');
    const component = new ExternalSyncThrowingEditableComponent(
      createFile(),
      createFile({ contents: 'external replacement' })
    );
    component.shouldThrow = false;
    try {
      editor.edit(component);
      insertAtStart(editor, 'retained:');
      editor.cleanUp('recycle');
      component.cleanUp(true);

      component.shouldThrow = true;
      expect(() => editor.edit(component)).toThrow(
        'attachment failed after external sync'
      );

      component.shouldThrow = false;
      editor.edit(component);
      expect(editor.getText()).toBe('external replacement');
      editor.undo();
      expect(editor.getText()).toBe(`retained:${FILE_CONTENTS}`);
      editor.undo();
      expect(editor.getText()).toBe(FILE_CONTENTS);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('failed initial attachment rolls back document state and ownership', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {}, 'failed');
    const failing = new SyncingThrowingEditableComponent(createFile());
    const retry = new TestEditableComponent(createFile());
    const competingEditor = new Editor<undefined>('file', {}, 'failed');
    const competing = new TestEditableComponent(createFile());
    try {
      expect(() => editor.edit(failing)).toThrow(
        'attachment failed after sync'
      );

      competingEditor.edit(competing);
      expect(() => editor.edit(retry)).toThrow(
        'editStateKey "failed" is already attached to another editor'
      );

      competingEditor.cleanUp('discard');
      competing.cleanUp();
      editor.edit(retry);
      expect(editor.getText()).toBe(FILE_CONTENTS);
    } finally {
      editor.cleanUp();
      competingEditor.cleanUp();
      failing.cleanUp();
      retry.cleanUp();
      competing.cleanUp();
      dom.cleanup();
    }
  });

  test('failed keyed attachment returns the transferred registration', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'failed');
    const first = new TestEditableComponent(createFile());
    const failingEditor = new Editor<undefined>('file', {}, 'failed');
    const failing = new EditingSyncingThrowingEditableComponent(
      createFile({ name: 'other.ts' })
    );
    const resumedEditor = new Editor<undefined>('file', {}, 'failed');
    const resumed = new TestEditableComponent(createFile());
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'retained:');
      firstEditor.cleanUp('discard');
      first.cleanUp();

      expect(() => failingEditor.edit(failing)).toThrow(
        'attachment failed after edit'
      );

      resumedEditor.edit(resumed);
      expect(resumedEditor.getText()).toBe(`failed:retained:${FILE_CONTENTS}`);
      expect(resumedEditor.canUndo).toBe(true);
    } finally {
      firstEditor.cleanUp();
      failingEditor.cleanUp();
      resumedEditor.cleanUp();
      first.cleanUp();
      failing.cleanUp();
      resumed.cleanUp();
      dom.cleanup();
    }
  });

  test('undo remaps current annotations after a typed history handoff', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'annotations');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'annotations');
    const second = new TestEditableComponent(createFile());
    try {
      first.render({
        lineAnnotations: [
          { side: 'additions', lineNumber: 2, metadata: undefined },
        ],
      });
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X\n');
      expect(first.lineAnnotations?.[0]?.lineNumber).toBe(3);
      const retainedAnnotations = first.lineAnnotations;
      firstEditor.cleanUp('discard');
      first.cleanUp();

      second.render({ lineAnnotations: retainedAnnotations });
      secondEditor.edit(second);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(second.lineAnnotations?.[0]?.lineNumber).toBe(2);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('undo restores an annotation deleted before history handoff', () => {
    const dom = installDom();
    const annotation: DiffLineAnnotation<undefined> = {
      side: 'additions',
      lineNumber: 2,
      metadata: undefined,
    };
    const firstEditor = new Editor<undefined>('file', {}, 'annotations');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'annotations');
    const second = new TestEditableComponent(createFile());
    try {
      first.render({ lineAnnotations: [annotation] });
      firstEditor.edit(first);
      firstEditor.applyEdits([
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: '',
        },
      ]);
      expect(first.lineAnnotations).toEqual([]);
      firstEditor.cleanUp('discard');
      first.cleanUp();

      second.render({ lineAnnotations: [] });
      secondEditor.edit(second);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(second.lineAnnotations).toEqual([
        { side: 'additions', lineNumber: 2, metadata: undefined },
      ]);
      expect(second.lineAnnotations?.[0]).toBe(annotation);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('external replacement during keyed adoption joins retained history', () => {
    const dom = installDom();
    const firstEditor = new Editor<undefined>('file', {}, 'external');
    const first = new TestEditableComponent(createFile());
    const secondEditor = new Editor<undefined>('file', {}, 'external');
    const second = new TestEditableComponent(createFile(), {
      syncOnAttach: false,
    });
    try {
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'retained:');
      const retainedText = firstEditor.getText();
      firstEditor.cleanUp('discard');
      first.cleanUp();

      secondEditor.edit(second);
      second.renderExternalFile(
        createFile({ contents: `${retainedText}\nexternal` }),
        [{ side: 'additions', lineNumber: 2, metadata: undefined }]
      );
      expect(secondEditor.getText()).toBe(`${retainedText}\nexternal`);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(retainedText);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('a released active document enters the LRU as most recent', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    const activeEditor = new Editor<undefined>('file', {}, 'active');
    const active = new TestEditableComponent(createFile());
    try {
      activeEditor.edit(active);
      insertAtStart(activeEditor, 'A');
      for (let index = 0; index < 99; index++) {
        retain(`dormant-${index}`, `${index}:`);
      }

      insertAtStart(activeEditor, 'B');
      retain('overflow', 'overflow:');
      activeEditor.cleanUp('discard');
      active.cleanUp();

      expect(read('active')).toBe(`BA${FILE_CONTENTS}`);
      expect(read('dormant-0')).toBe(FILE_CONTENTS);
    } finally {
      activeEditor.cleanUp();
      active.cleanUp();
      dom.cleanup();
    }
  });

  test('capacity shrink does not evict an active document', () => {
    const dom = installDom();
    const retain = (key: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const activeEditor = new Editor<undefined>('file', {}, 'active-shrink');
    const active = new TestEditableComponent(createFile());
    const resumedEditor = new Editor<undefined>('file', {}, 'active-shrink');
    const resumed = new TestEditableComponent(createFile());
    try {
      EditStateManager.setCapacity(3);
      activeEditor.edit(active);
      insertAtStart(activeEditor, 'active:');
      retain('dormant-first');
      retain('dormant-second');
      retain('dormant-third');

      EditStateManager.setCapacity(1);
      activeEditor.cleanUp('discard');
      active.cleanUp();

      resumedEditor.edit(resumed);
      expect(resumedEditor.getText()).toBe(`active:${FILE_CONTENTS}`);
      expect(resumedEditor.canUndo).toBe(true);
    } finally {
      activeEditor.cleanUp();
      resumedEditor.cleanUp();
      active.cleanUp();
      resumed.cleanUp();
      dom.cleanup();
    }
  });

  test('complete reinserts an active document as most recent', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    const activeEditor = new Editor<undefined>('file', {}, 'completed-mru');
    const active = new TestEditableComponent(createFile());
    try {
      EditStateManager.setCapacity(2);
      const complete = activeEditor.edit(active);
      insertAtStart(activeEditor, 'completed:');
      retain('oldest', 'oldest:');
      retain('newer', 'newer:');

      complete();

      expect(read('completed-mru')).toBe(`completed:${FILE_CONTENTS}`);
      expect(read('newer')).toBe(`newer:${FILE_CONTENTS}`);
      expect(read('oldest')).toBe(FILE_CONTENTS);
    } finally {
      activeEditor.cleanUp();
      active.cleanUp();
      dom.cleanup();
    }
  });

  test('dormant LRU pressure does not evict an active document', () => {
    const dom = installDom();
    const activeEditor = new Editor<undefined>('file', {}, 'active');
    const active = new TestEditableComponent(createFile());
    const competingEditor = new Editor<undefined>('file', {}, 'active');
    const competing = new TestEditableComponent(createFile());
    try {
      activeEditor.edit(active);
      insertAtStart(activeEditor, 'active:');
      for (let index = 0; index < 100; index++) {
        const editor = new Editor<undefined>('file', {}, `pressure-${index}`);
        const component = new TestEditableComponent(createFile());
        editor.edit(component);
        editor.cleanUp('discard');
        component.cleanUp();
      }

      expect(() => competingEditor.edit(competing)).toThrow(
        'editStateKey "active" is already attached to another editor'
      );
      activeEditor.cleanUp('discard');
      active.cleanUp();

      competingEditor.edit(competing);
      expect(competingEditor.getText()).toBe(`active:${FILE_CONTENTS}`);
    } finally {
      activeEditor.cleanUp();
      competingEditor.cleanUp();
      active.cleanUp();
      competing.cleanUp();
      dom.cleanup();
    }
  });

  test('pending adoption survives dormant LRU pressure', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const pendingEditor = new Editor<undefined>('file', {}, 'pending');
    const pending = new TestEditableComponent(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor<undefined>('file', {}, 'pending');
    const fresh = new TestEditableComponent(createFile());
    try {
      retain('pending', 'retained:');
      pendingEditor.edit(pending);
      for (let index = 0; index < 100; index++) {
        retain(`pressure-${index}`, `${index}:`);
      }

      pending.rerender();
      expect(pendingEditor.getText()).toBe(`retained:${FILE_CONTENTS}`);
      pendingEditor.cleanUp('discard');
      pending.cleanUp();

      freshEditor.edit(fresh);
      expect(freshEditor.getText()).toBe(`retained:${FILE_CONTENTS}`);
      expect(freshEditor.canUndo).toBe(true);
    } finally {
      pendingEditor.cleanUp();
      freshEditor.cleanUp();
      pending.cleanUp();
      fresh.cleanUp();
      dom.cleanup();
    }
  });

  test('evicts the least-recently-used document past capacity', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    try {
      for (let index = 0; index < 100; index++) {
        retain(`key-${index}`, `${index}:`);
      }

      expect(read('key-0')).toBe(`0:${FILE_CONTENTS}`);
      retain('key-100', '100:');

      expect(read('key-0')).toBe(`0:${FILE_CONTENTS}`);
      expect(read('key-1')).toBe(FILE_CONTENTS);
    } finally {
      dom.cleanup();
    }
  });

  test('applies manager capacity independently to files and diffs', () => {
    const dom = installDom();
    const retain = (
      type: 'file' | 'file-diff',
      key: string,
      prefix: string
    ): void => {
      const editor = new Editor<undefined>(type, {}, key);
      const component = new TestEditableComponent(createFile(), { type });
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (type: 'file' | 'file-diff', key: string): string => {
      const editor = new Editor<undefined>(type, {}, key);
      const component = new TestEditableComponent(createFile(), { type });
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    try {
      EditStateManager.setCapacity(1);
      retain('file', 'file-key', 'file:');
      retain('file-diff', 'diff-key', 'diff:');

      expect(read('file', 'file-key')).toBe(`file:${FILE_CONTENTS}`);
      expect(read('file-diff', 'diff-key')).toBe(`diff:${FILE_CONTENTS}`);
    } finally {
      dom.cleanup();
    }
  });

  test('shrinking manager capacity immediately evicts least-recent documents', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    try {
      EditStateManager.setCapacity(3);
      retain('first', 'first:');
      retain('second', 'second:');
      retain('third', 'third:');
      expect(read('first')).toBe(`first:${FILE_CONTENTS}`);

      EditStateManager.setCapacity(2);

      expect(read('first')).toBe(`first:${FILE_CONTENTS}`);
      expect(read('third')).toBe(`third:${FILE_CONTENTS}`);
      expect(read('second')).toBe(FILE_CONTENTS);
    } finally {
      dom.cleanup();
    }
  });

  test('growing manager capacity preserves documents and accepts more', () => {
    const dom = installDom();
    const retain = (key: string, prefix: string): void => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor<undefined>('file', {}, key);
      const component = new TestEditableComponent(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    try {
      EditStateManager.setCapacity(1);
      retain('first', 'first:');
      EditStateManager.setCapacity(3);
      retain('second', 'second:');
      retain('third', 'third:');

      expect(read('first')).toBe(`first:${FILE_CONTENTS}`);
      expect(read('second')).toBe(`second:${FILE_CONTENTS}`);
      expect(read('third')).toBe(`third:${FILE_CONTENTS}`);
    } finally {
      dom.cleanup();
    }
  });

  test('manager capacity must be a positive integer', () => {
    for (const capacity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => EditStateManager.setCapacity(capacity)).toThrow(
        'EditStateManager: capacity must be a positive integer'
      );
    }
  });
});

describe('Editor recycle cleanUp', () => {
  test('recycle keeps document and undo history across re-attach', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>('file');
      const first = new TestEditableComponent(createFile());
      editor.edit(first);
      insertAtStart(editor, 'X');
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Simulate a virtualized unmount: the host recycles, the editor is
      // unrendered non-destructively.
      editor.cleanUp('recycle');
      first.cleanUp(true);

      // Remount renders from the item's unchanged contents; the retained
      // document (holding the unsaved edit) must win over host contents.
      editor.edit(first);
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Undo history lives in the retained document and survives with it.
      editor.undo();
      expect(editor.getText()).toBe(FILE_CONTENTS);

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('an empty virtualized window preserves selections without restoring focus', async () => {
    const dom = installDom();
    const onAttach = mock((attachedEditor: Editor<undefined>) => {
      attachedEditor.focus({ lineNumber: 2, preventScroll: true });
    });
    const editor = new Editor<undefined>('file', { onAttach });
    const component = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      await wait(20);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(1);

      component.contentElement.dispatchEvent(new Event('blur'));
      component.render({
        renderRange: {
          startingLine: 0,
          totalLines: 0,
          bufferBefore: 0,
          bufferAfter: 60,
        },
      });

      component.render({
        renderRange: {
          startingLine: 0,
          totalLines: 3,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      const restoredFocus = mock((_options?: FocusOptions) => {});
      component.contentElement.focus = restoredFocus;
      await wait(20);

      expect(restoredFocus).not.toHaveBeenCalled();
      Object.defineProperty(component.contentElement, 'offsetWidth', {
        configurable: true,
        value: 100,
      });
      dom.triggerResizeObserver(component.contentElement);
      await wait(20);

      expect(restoredFocus).not.toHaveBeenCalled();
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(editor.getViewState().selections?.[0]?.start.line).toBe(1);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('a blur during the deferred attach-focus frame cancels the stale focus', async () => {
    const dom = installDom();
    const restoredFocus = mock((_options?: FocusOptions) => {});
    const onAttach = mock((attachedEditor: Editor<undefined>) => {
      // The positional focus defers its real focus() call to a rAF. A blur
      // plus a host rerender landing in that gap must cancel the stale
      // frame instead of pulling focus into the replaced content.
      attachedEditor.focus({ lineNumber: 2, preventScroll: true });
      component.contentElement.dispatchEvent(new Event('blur'));
      component.rerender();
      component.contentElement.focus = restoredFocus;
    });
    const editor = new Editor<undefined>('file', { onAttach });
    const component = new TestEditableComponent(createFile());
    try {
      editor.edit(component);
      await wait(20);

      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(restoredFocus).not.toHaveBeenCalled();
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('recycled re-attach recreates a tokenizer so edits still paint', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>('file');
      const first = new TestEditableComponent(createFile());
      editor.edit(first);

      editor.cleanUp('recycle');
      first.cleanUp(true);

      // Re-attach with an unchanged name/lang/cacheKey skips the document
      // rebuild. The tokenizer must be recreated anyway, otherwise #rerender
      // bails and this edit would update the model without painting.
      editor.edit(first);
      insertAtStart(editor, 'Y');

      expect(editor.getText()).toBe(`Y${FILE_CONTENTS}`);
      const firstLine = first.contentElement.children[0] as HTMLElement;
      expect(firstLine.textContent).toBe('Yalpha');

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  test('full cleanUp still rebuilds from host contents', () => {
    const dom = installDom();
    try {
      const editor = new Editor<undefined>('file');
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
      const editor = new Editor<undefined>('file', { onAttach });
      const first = new TestEditableComponent(createFile());
      editor.edit(first);
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      insertAtStart(editor, 'X');
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      editor.cleanUp('recycle');
      first.cleanUp(true);

      // The associated component can receive a different external file while
      // unrendered; the retained document must not leak into that replacement.
      first.renderExternalFile({
        name: 'other.ts',
        contents: 'zulu',
        lang: 'text',
      });
      editor.edit(first);
      await wait(0);
      expect(first.contentElement.textContent).toBe('zulu');
      expect(editor.getViewState().selections).toBeUndefined();
      expect(onAttach).toHaveBeenCalledTimes(1);

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });
});
