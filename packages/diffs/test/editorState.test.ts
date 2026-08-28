import { describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import { EditStateManager } from '../src/editor/EditStateManager';
import { TextDocument } from '../src/editor/textDocument';
import type { EditState } from '../src/editor/types';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsHighlighter,
  EditorViewState,
  FileContents,
  HighlightedToken,
  RenderRange,
} from '../src/types';
import { getFiletypeFromFileName } from '../src/utils/getFiletypeFromFileName';
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

function createInitialState(
  file: FileContents,
  editor: EditorViewState = {}
): EditState<undefined> {
  return {
    documentKind: 'file',
    document: new TextDocument(
      file.name,
      file.contents,
      file.lang ?? getFiletypeFromFileName(file.name)
    ),
    fileInfo: { name: file.name, lang: file.lang },
    editor,
  };
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
  attachErrorAfterSync: Error | undefined;
  deferAttachSync = false;
  completedEditState: EditState<undefined> | undefined;

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

  __captureDocumentSessionState(): undefined {
    return undefined;
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

  __completeEditSession(
    editor: DiffsEditor<undefined>,
    _mode: 'install' | 'discard'
  ): void {
    this.completedEditState = editor.getEditState();
  }

  __attachEditor(editor: DiffsEditor<undefined>): () => void {
    this.#editor = editor;
    if (!this.deferAttachSync) {
      this.#syncRenderView();
    }
    if (this.attachErrorAfterSync != null) {
      throw this.attachErrorAfterSync;
    }
    return () => {
      this.#editor = undefined;
    };
  }

  __resumeEditor(editor: DiffsEditor<undefined>): void {
    if (this.#editor !== editor) {
      throw new Error('TestEditableComponent: editor association changed');
    }
    this.rerender();
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
    EditStateManager.clearAll();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    first.editorViewport = document.createElement('div');
    const firstEditor = new Editor<undefined>(
      'file',
      { ownsVerticalViewport: true },
      'complete-state'
    );
    const second = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    second.editorViewport = document.createElement('div');
    const secondEditor = new Editor<undefined>(
      'file',
      { ownsVerticalViewport: true },
      'complete-state'
    );

    try {
      firstEditor.edit(first);
      firstEditor.setViewState({
        selections: [
          {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 18, scrollTop: 36 },
      });
      const detachedState = firstEditor.getViewState();
      firstEditor.cleanUp('discard');
      Object.assign(detachedState.selections![0].start, {
        character: 0,
      });
      first.cleanUp();

      secondEditor.edit(second);
      expect(secondEditor.getViewState()).toEqual({
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
      EditStateManager.clearAll();
      dom.cleanup();
    }
  });

  test('initialState restores selections and an owned viewport on first attach', () => {
    const dom = installDom();
    const viewport = document.createElement('div');
    const file = { name: 'state.ts', contents: 'alpha\nbravo' };
    const editor = new Editor<undefined>('file', {
      ownsVerticalViewport: true,
      initialState: {
        documentKind: 'file',
        editor: {
          selections: [
            {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 2 },
              direction: 0,
            },
          ],
          view: { scrollLeft: 24, scrollTop: 48 },
        },
      },
    });
    const component = new TestEditableComponent(file);
    component.editorViewport = viewport;

    try {
      editor.edit(component);

      expect(editor.getViewState()).toEqual({
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
      expect(editor.getEditState()).toMatchObject({
        documentKind: 'file',
        fileInfo: { name: 'state.ts' },
      });
      expect(editor.getEditState()?.document.getText()).toBe('alpha\nbravo');

      editor.cleanUp('recycle');
      expect(editor.getViewState()).toEqual({
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

      expect(editor.getViewState()).toEqual({
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

  test('initialState completes missing file state from the attached component', () => {
    const dom = installDom();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    const initialState = {
      documentKind: 'file' as const,
      editor: { view: { scrollLeft: 24 } },
    };
    const editor = new Editor<undefined>('file', { initialState });

    try {
      editor.edit(component);

      const state = editor.getEditState();
      expect(state === initialState).toBe(true);
      expect(state).toMatchObject({
        documentKind: 'file',
        fileInfo: { name: 'state.ts', lang: 'text' },
      });
      expect(state?.document.getText()).toBe('alpha\nbravo');
      expect(state?.document.canUndo).toBe(false);
      expect(state?.editor).toEqual({ view: { scrollLeft: 24 } });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('raw complete state transfers draft, history, and editor state', () => {
    const dom = installDom();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    first.editorViewport = document.createElement('div');
    const firstEditor = new Editor<undefined>('file', {
      ownsVerticalViewport: true,
    });
    const second = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
      lang: 'text',
    });
    second.editorViewport = document.createElement('div');
    let secondEditor: Editor<undefined> | undefined;

    try {
      firstEditor.edit(first);
      firstEditor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          newText: 'ALPHA',
        },
      ]);
      firstEditor.setViewState({
        selections: [
          {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 18, scrollTop: 36 },
      });

      const state = firstEditor.getEditState()!;
      firstEditor.cleanUp('discard');
      secondEditor = new Editor('file', {
        initialState: state,
        ownsVerticalViewport: true,
      });
      Object.assign(state.editor.selections![0].start, { character: 0 });
      state.editor.view!.scrollLeft = 0;
      secondEditor.edit(second);

      expect(secondEditor.getEditState()!.document).toBe(state.document);
      expect(secondEditor.getText()).toBe('ALPHA\nbravo');
      expect(secondEditor.canUndo).toBe(true);
      expect(secondEditor.getViewState()).toEqual({
        selections: [
          {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 3 },
            direction: 0,
          },
        ],
        view: { scrollLeft: 0, scrollTop: 36 },
      });
      secondEditor.undo();
      expect(secondEditor.getText()).toBe('alpha\nbravo');
    } finally {
      firstEditor.cleanUp();
      secondEditor?.cleanUp();
      first.cleanUp();
      second.cleanUp();
      dom.cleanup();
    }
  });

  test('getEditState returns the managed document and history', () => {
    const dom = installDom();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    component.editorViewport = document.createElement('div');
    const editor = new Editor<undefined>('file');

    try {
      editor.edit(component);
      editor.setViewState({
        selections: [
          {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
            direction: 0,
          },
        ],
      });
      const state = editor.getEditState()!;
      const history = state.document.history;

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
      ]);
      editor.setViewState({
        selections: [
          {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 6 },
            direction: 0,
          },
        ],
      });

      expect(state.document.getText()).toBe('alpha!');
      expect(state.document.version).toBe(1);
      expect(state.document.history.undoStack).toBe(history.undoStack);
      expect(state.document.history.redoStack).toBe(history.redoStack);
      expect(history.undoStack).toHaveLength(1);
      const updatedState = editor.getEditState()!;
      expect(updatedState).toBe(state);
      expect(updatedState.document).toBe(state.document);
      expect(updatedState.document.history.undoStack).toBe(history.undoStack);
      expect(state.editor.selections?.[0].start.character).toBe(6);
      expect(updatedState.editor.selections?.[0].start.character).toBe(6);
      const entry = history.undoStack[0];
      editor.undo();
      expect(state.document.getText()).toBe('alpha');
      expect(history.undoStack).toHaveLength(0);
      expect(history.redoStack).toEqual([entry]);
      editor.redo();
      expect(state.document.getText()).toBe('alpha!');
      expect(history.undoStack).toEqual([entry]);
      expect(history.redoStack).toHaveLength(0);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('keyed state is checkpointed directly on the managed session', () => {
    const dom = installDom();
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const editor = new Editor<undefined>('file', {}, 'managed-checkpoint');

    try {
      editor.edit(component);
      const state = editor.getEditState()!;
      expect(EditStateManager.get('file', 'managed-checkpoint')).toBe(state);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
      ]);

      expect(EditStateManager.get('file', 'managed-checkpoint')).toBe(state);
      expect(state.document.getText()).toBe('alpha!');
      expect(state.editor).toEqual(editor.getViewState());
    } finally {
      editor.cleanUp();
      component.cleanUp();
      EditStateManager.clearAll();
      dom.cleanup();
    }
  });

  test('getEditState exposes initialState before synchronization', () => {
    const dom = installDom();
    const file = {
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    };
    const initialState = createInitialState(file, {
      view: { scrollLeft: 24 },
    });
    const component = new TestEditableComponent(file);
    component.deferAttachSync = true;
    const editor = new Editor<undefined>('file', {
      initialState,
    });

    try {
      editor.edit(component);
      expect(editor.getEditState()).toBe(initialState);

      component.rerender();
      expect(editor.getEditState()).toBe(initialState);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('completion checkpoints initialState before synchronization', () => {
    const dom = installDom();
    const file = {
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    };
    const editorState: EditorViewState = {
      view: { scrollLeft: 24, scrollTop: 48 },
    };
    const initialState = createInitialState(file, editorState);
    const component = new TestEditableComponent(file);
    component.deferAttachSync = true;
    const editor = new Editor<undefined>('file', { initialState });

    try {
      editor.edit(component);
      editor.cleanUp('complete');

      expect(initialState.editor).toEqual({
        selections: undefined,
        view: { scrollLeft: 0 },
      });
      expect(component.completedEditState).toBe(initialState);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('completion can transfer state before the editor releases its session', () => {
    const dom = installDom();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const firstEditor = new Editor<undefined>('file');
    const second = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const fresh = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    let secondEditor: Editor<undefined> | undefined;

    try {
      firstEditor.edit(first);
      firstEditor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
      ]);
      firstEditor.cleanUp('complete');
      firstEditor.cleanUp('complete');

      const completedState = first.completedEditState;
      expect(completedState?.document.getText()).toBe('alpha!');
      expect(firstEditor.getEditState()).toBeUndefined();

      firstEditor.edit(fresh);
      expect(firstEditor.getText()).toBe('alpha');
      expect(firstEditor.canUndo).toBe(false);
      firstEditor.cleanUp();

      secondEditor = new Editor('file', {
        initialState: completedState,
      });
      secondEditor.edit(second);
      expect(secondEditor.getText()).toBe('alpha!');
      expect(secondEditor.canUndo).toBe(true);
    } finally {
      firstEditor.cleanUp();
      secondEditor?.cleanUp();
      first.cleanUp();
      second.cleanUp();
      fresh.cleanUp();
      dom.cleanup();
    }
  });

  test('initialState replaces retained keyed state', () => {
    const dom = installDom();
    EditStateManager.clearAll();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const firstEditor = new Editor<undefined>('file', {}, 'authoritative');
    const second = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const secondEditor = new Editor<undefined>(
      'file',
      {
        initialState: createInitialState({
          name: 'state.ts',
          contents: 'replacement',
          lang: 'text',
        }),
      },
      'authoritative'
    );

    try {
      firstEditor.edit(first);
      firstEditor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
      ]);
      firstEditor.cleanUp('complete');
      secondEditor.edit(second);

      expect(secondEditor.getText()).toBe('replacement');
      expect(secondEditor.canUndo).toBe(false);
    } finally {
      firstEditor.cleanUp();
      secondEditor.cleanUp();
      first.cleanUp();
      second.cleanUp();
      EditStateManager.clearAll();
      dom.cleanup();
    }
  });

  test('pre-sync completion keeps the keyed document but clears view state', () => {
    const dom = installDom();
    EditStateManager.clearAll();
    const first = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const firstEditor = new Editor<undefined>('file', {}, 'pending-hydration');
    const pending = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    pending.deferAttachSync = true;
    const pendingEditor = new Editor<undefined>(
      'file',
      {},
      'pending-hydration'
    );
    const restored = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });
    const restoredEditor = new Editor<undefined>(
      'file',
      {},
      'pending-hydration'
    );

    try {
      firstEditor.edit(first);
      firstEditor.applyEdits([
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          newText: '!',
        },
      ]);
      firstEditor.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: 'none',
        },
      ]);
      firstEditor.cleanUp('complete');

      pendingEditor.edit(pending);
      expect(EditStateManager.get('file', 'pending-hydration')?.editor).toEqual(
        {
          selections: [
            {
              start: { line: 0, character: 3 },
              end: { line: 0, character: 3 },
              direction: 0,
            },
          ],
          view: { scrollLeft: 0 },
        }
      );
      pendingEditor.cleanUp('complete');
      expect(EditStateManager.get('file', 'pending-hydration')?.editor).toEqual(
        {
          selections: undefined,
          view: { scrollLeft: 0 },
        }
      );

      restoredEditor.edit(restored);
      expect(restoredEditor.getText()).toBe('alpha!');
      expect(restoredEditor.canUndo).toBe(true);
      expect(restoredEditor.getViewState().selections).toBeUndefined();
    } finally {
      firstEditor.cleanUp();
      pendingEditor.cleanUp();
      restoredEditor.cleanUp();
      first.cleanUp();
      pending.cleanUp();
      restored.cleanUp();
      EditStateManager.clearAll();
      dom.cleanup();
    }
  });

  test('transfers caller-created document state without cloning it', () => {
    const dom = installDom();
    const document = new TextDocument<undefined>(
      'state.ts',
      'developer-owned',
      'text',
      7
    );
    const initialState: EditState<undefined> = {
      documentKind: 'file',
      document,
      fileInfo: { name: 'state.ts', lang: 'text' },
      editor: { view: { scrollLeft: 24 } },
    };
    const editor = new Editor<undefined>('file', { initialState });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha',
      lang: 'text',
    });

    try {
      expect(editor.getEditState()).toBeUndefined();
      document.applyResolvedEdits([
        {
          start: 0,
          end: document.getText().length,
          text: 'changed-after-construction',
        },
      ]);
      editor.edit(component);
      expect(editor.getText()).toBe('changed-after-construction');
      expect(editor.canUndo).toBe(true);
      expect(editor.getEditState()!.document).toBe(document);
      expect(editor.getEditState()!.fileInfo).toBe(initialState.fileInfo);
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
      initialState: createInitialState(
        { name: 'state.ts', contents: 'alpha\nbravo' },
        { view: { scrollLeft: 24, scrollTop: 48 } }
      ),
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
      initialState: createInitialState(
        { name: 'state.ts', contents: 'alpha\nbravo' },
        { view: { scrollLeft: 24 } }
      ),
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

  test('keyed state is released for adoption when restoration fails', () => {
    const dom = installDom();
    EditStateManager.clearAll();
    const file = { name: 'state.ts', contents: 'alpha\nbravo' };
    const initialState = createInitialState(file, {
      view: { scrollLeft: 24 },
    });
    const failingEditor = new Editor<undefined>(
      'file',
      { initialState },
      'failed-restoration'
    );
    const failing = new TestEditableComponent(file);
    failing.stateRestoreError = new Error('state restoration failed');
    const adoptingEditor = new Editor<undefined>(
      'file',
      {},
      'failed-restoration'
    );
    const adopting = new TestEditableComponent(file);

    try {
      expect(() => failingEditor.edit(failing)).toThrow(
        'state restoration failed'
      );

      adoptingEditor.edit(adopting);
      expect(adoptingEditor.getEditState()?.document).toBe(
        initialState.document
      );
      expect(adoptingEditor.getViewState().view).toEqual({
        scrollLeft: 24,
      });
    } finally {
      failingEditor.cleanUp();
      adoptingEditor.cleanUp();
      failing.cleanUp();
      adopting.cleanUp();
      EditStateManager.clearAll();
      dom.cleanup();
    }
  });

  test('initialState remains available when attachment fails after hydration', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {
      initialState: createInitialState(
        { name: 'state.ts', contents: 'alpha\nbravo' },
        { view: { scrollLeft: 24 } }
      ),
    });
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    const attachError = new Error('attachment failed');
    component.attachErrorAfterSync = attachError;

    try {
      expect(() => editor.edit(component)).toThrow(attachError);
      component.attachErrorAfterSync = undefined;
      editor.edit(component);

      expect(component.restoredCodeScrollLefts).toEqual([24, 24]);
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('getState retains horizontal state without an owned element viewport', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file');
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });

    try {
      editor.edit(component);
      component.codeScrollLeft = 24;

      expect(editor.getViewState().view).toEqual({ scrollLeft: 24 });
      component.editorViewport = document;
      expect(editor.getViewState().view).toEqual({ scrollLeft: 24 });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('getState captures view state from an owned element viewport', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file', {
      ownsVerticalViewport: true,
    });
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

      expect(editor.getViewState().view).toEqual({
        scrollLeft: 24,
        scrollTop: 48,
      });
    } finally {
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });

  test('vertical viewport ownership is captured at construction', () => {
    const dom = installDom();
    const editor = new Editor<undefined>('file');
    const component = new TestEditableComponent({
      name: 'state.ts',
      contents: 'alpha\nbravo',
    });
    const viewport = document.createElement('div');
    component.editorViewport = viewport;

    try {
      editor.setOptions({ ownsVerticalViewport: true });
      editor.edit(component);
      component.codeScrollLeft = 24;
      viewport.scrollTop = 48;

      expect(editor.getViewState().view).toEqual({ scrollLeft: 24 });
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
      editor.setViewState({ view: { scrollLeft: 24 } });

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
      editor.setViewState({
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
      expect(editor.getViewState().selections).toEqual([
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

  test('selection-only restoration does not scroll a shared viewport', () => {
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
      editor.setViewState({
        selections: [
          {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 0 },
            direction: 0,
          },
        ],
      });

      expect(scrollIntoViewCalls).toBe(0);
      expect(editor.getViewState().view).toEqual({ scrollLeft: 0 });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      editor.cleanUp();
      component.cleanUp();
      dom.cleanup();
    }
  });
});
