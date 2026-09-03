import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { File, type FileRenderProps } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { EditStateManager } from '../src/editor/EditStateManager';
import { queueRender } from '../src/managers/UniversalRenderingManager';
import type {
  DiffsHighlighter,
  FileContents,
  LineAnnotation,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
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

interface TestFileHarnessOptions {
  queueRerender?: boolean;
  syncOnAttach?: boolean;
  onContentFocus?(content: HTMLElement): void;
}

type TestFile = File<undefined> & {
  readonly contentElement: HTMLElement;
  readonly testLineAnnotations: LineAnnotation<undefined>[] | undefined;
  readonly testFileContainer: HTMLElement;
  render(props: Partial<FileRenderProps<undefined>>): boolean;
  renderExternalFile(
    file: FileContents,
    lineAnnotations?: LineAnnotation<undefined>[]
  ): void;
};

type ThrowingTestFile = TestFile & {
  shouldThrow: boolean;
};

function createTestFile(
  initialFile: FileContents,
  {
    queueRerender = false,
    syncOnAttach = true,
    onContentFocus,
  }: TestFileHarnessOptions = {}
): TestFile {
  const component = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  }) as TestFile;
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  let currentFile = initialFile;
  let currentLineAnnotations: LineAnnotation<undefined>[] | undefined;
  let currentRenderRange: FileRenderProps<undefined>['renderRange'];
  let attachedEditor: Editor<'file', undefined> | undefined;
  let completePendingAttach: (() => void) | undefined;

  const syncRenderView = (externalDocument = false) => {
    attachedEditor?.__syncRenderView({
      highlighter: createTestHighlighter(),
      fileContainer,
      file: currentFile,
      lineAnnotations: currentLineAnnotations,
      renderRange: currentRenderRange,
      externalDocument,
      resetHistory: false,
    });
  };

  const render = component.render.bind(component);
  component.render = ((props: Partial<FileRenderProps<undefined>>) => {
    currentFile = props.file ?? currentFile;
    if ('lineAnnotations' in props) {
      currentLineAnnotations = props.lineAnnotations;
    }
    if ('renderRange' in props) {
      currentRenderRange = props.renderRange;
    }
    const rendered = render({
      ...props,
      file: currentFile,
      fileContainer,
      forceRender: true,
    });
    const content =
      fileContainer.shadowRoot?.querySelector<HTMLElement>('[data-content]');
    if (content != null && onContentFocus != null) {
      content.focus = () => onContentFocus(content);
    }
    return rendered;
  }) as TestFile['render'];

  const applyDocumentChange = component.applyDocumentChange.bind(component);
  component.applyDocumentChange = ((textDocument, lineAnnotations) => {
    currentFile = { ...currentFile, contents: textDocument.getText() };
    if (lineAnnotations !== undefined) {
      currentLineAnnotations = lineAnnotations;
    }
    applyDocumentChange(textDocument, lineAnnotations);
  }) as typeof component.applyDocumentChange;

  Object.defineProperties(component, {
    contentElement: {
      get(): HTMLElement {
        const content =
          fileContainer.shadowRoot?.querySelector<HTMLElement>(
            '[data-content]'
          );
        if (content == null) {
          throw new Error('missing test editor content element');
        }
        return content;
      },
    },
    testLineAnnotations: {
      get(): LineAnnotation<undefined>[] | undefined {
        return currentLineAnnotations;
      },
    },
    testFileContainer: {
      get: () => fileContainer,
    },
  });

  component.renderExternalFile = (
    file: FileContents,
    lineAnnotations = currentLineAnnotations
  ) => {
    component.render({ file, lineAnnotations });
    completePendingAttach?.();
    syncRenderView(true);
  };

  const rerender = component.rerender.bind(component);
  component.rerender = () => {
    if (queueRerender) {
      queueRender(() => {
        rerender();
        syncRenderView();
      });
      return;
    }
    rerender();
    syncRenderView();
  };

  const attach = component.__attachEditor.bind(component);
  component.__attachEditor = (editor) => {
    attachedEditor = editor;
    let detach: (() => void) | undefined;
    let pending = !syncOnAttach;
    const attachNow = () => {
      detach = attach(editor);
      completePendingAttach = undefined;
      syncRenderView();
    };
    if (!pending) {
      attachNow();
    } else {
      completePendingAttach = () => {
        if (!pending) return;
        pending = false;
        attachNow();
      };
    }
    const resume = component.rerender.bind(component);
    component.rerender = () => {
      if (pending) {
        pending = false;
        attachNow();
      } else {
        resume();
      }
    };
    return () => {
      pending = false;
      completePendingAttach = undefined;
      attachedEditor = undefined;
      detach?.();
    };
  };

  component.render({ file: initialFile });
  return component;
}

function createTestDiff(file: FileContents): FileDiff<undefined> {
  const component = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const fileDiff = parseDiffFromFile(null, file);
  component.render({
    fileDiff,
    fileContainer,
    forceRender: true,
  });
  const attach = component.__attachEditor.bind(component);
  component.__attachEditor = (editor) => {
    const detach = attach(editor);
    editor.__syncRenderView({
      highlighter: createTestHighlighter(),
      fileContainer,
      fileDiff,
      lineAnnotations: undefined,
      renderRange: undefined,
    });
    return detach;
  };
  return component;
}

function createIncompleteTestDiff(file: FileContents): FileDiff<undefined> {
  const component = createTestDiff(file);
  component.__captureDocumentSessionState = () => undefined;
  return component;
}

function createThrowingTestFile(file: FileContents): ThrowingTestFile {
  const component = createTestFile(file) as ThrowingTestFile;
  component.shouldThrow = true;
  const rerender = component.rerender.bind(component);
  component.rerender = () => {
    if (component.shouldThrow) {
      throw new Error('attachment failed');
    }
    rerender();
  };
  return component;
}

function createSyncingThrowingTestFile(file: FileContents): TestFile {
  const component = createTestFile(file);
  const attach = component.__attachEditor.bind(component);
  component.__attachEditor = (editor) => {
    attach(editor);
    throw new Error('attachment failed after sync');
  };
  return component;
}

function createEditingSyncingThrowingTestFile(file: FileContents): TestFile {
  const component = createTestFile(file);
  const attach = component.__attachEditor.bind(component);
  component.__attachEditor = (editor) => {
    attach(editor);
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'failed:',
      },
    ]);
    throw new Error('attachment failed after edit');
  };
  return component;
}

function createExternalSyncThrowingTestFile(
  file: FileContents,
  replacement: FileContents
): ThrowingTestFile {
  const component = createTestFile(file) as ThrowingTestFile;
  component.shouldThrow = true;
  const rerender = component.rerender.bind(component);
  component.rerender = () => {
    if (component.shouldThrow) {
      component.renderExternalFile(replacement);
      throw new Error('attachment failed after external sync');
    }
    rerender();
  };
  return component;
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
function insertAtStart(
  editor: Editor<'file', undefined> | Editor<'file-diff', undefined>,
  text: string
): void {
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
    const onAttach = mock((attachedEditor: Editor<'file', undefined>) => {
      attachedEditor.focus({ preventScroll: true });
    });
    const editor = new Editor('file', { onAttach });
    const component = createTestFile(createFile(), {
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
      (_editor: Editor<'file', undefined>, _component: File<undefined>) => {}
    );
    const editor = new Editor('file', { onAttach });
    const component = createTestFile(createFile());
    try {
      editor.edit(component);
      editor.cleanUp();
      component.cleanUp();

      await wait(0);
      expect(onAttach).not.toHaveBeenCalled();

      const file = createFile();
      editor.__syncRenderView({
        highlighter: createTestHighlighter(),
        fileContainer: component.testFileContainer,
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
        attachedEditor: Editor<'file', undefined>,
        _component: File<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted++;
      }
    );
    const editor = new Editor('file', { onAttach });
    const component = createTestFile(createFile());
    try {
      editor.edit(component);
      editor.cleanUp('recycle');
      component.cleanUp(true);
      component.virtualizedSetup();

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
      component.virtualizedSetup();
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
        attachedEditor: Editor<'file', undefined>,
        _component: File<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted++;
      }
    );
    const editor = new Editor('file', { onAttach });
    const first = createTestFile(createFile());
    let second: TestFile | undefined;
    let replacementStarted = false;
    try {
      queueRender(() => {
        editor.cleanUp();
        first.cleanUp();
        second = createTestFile(createFile());
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
      (_editor: Editor<'file', undefined>, _component: File<undefined>) => {}
    );
    const editor = new Editor('file', { onAttach });
    const first = createTestFile(createFile());
    let second: TestFile | undefined;
    try {
      editor.edit(first);
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);

      editor.cleanUp();
      first.cleanUp();
      second = createTestFile(createFile());
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
    const firstEditor = new Editor('file', {}, 'shared');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'shared');
    const second = createTestFile(
      createFile({ contents: 'new external baseline' })
    );
    const thirdEditor = new Editor('file', {}, 'shared');
    const third = createTestFile(createFile());
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

  test('editors without a key start with fresh state', () => {
    const dom = installDom();
    const firstEditor = new Editor('file');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file');
    const second = createTestFile(createFile());
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
    const firstEditor = new Editor('file', {}, 'first');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'second');
    const second = createTestFile(createFile());
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
      const firstEditor = new Editor('file', {}, mismatch);
      const first = createTestFile(createFile());
      const secondEditor = new Editor('file', {}, mismatch);
      const second = createTestFile(changedFile);
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
      const firstEditor = new Editor('file', {}, reason);
      const first = createTestFile(createFile());
      const secondEditor = new Editor('file', {}, reason);
      const second = createTestFile(createFile());
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
    const firstEditor = new Editor('file', {}, 'complete');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'complete');
    const second = createTestFile(createFile());
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
    const firstEditor = new Editor('file-diff', {}, 'recycled-diff-complete');
    const first = createTestDiff(createFile());
    const secondEditor = new Editor('file-diff', {}, 'recycled-diff-complete');
    const second = createTestDiff(createFile());
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
    const firstEditor = new Editor('file-diff', {}, 'diff-selections');
    const first = createTestDiff(createFile());
    const secondEditor = new Editor('file-diff', {}, 'diff-selections');
    const second = createTestDiff(createFile());
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
    const firstEditor = new Editor('file', {}, 'complete');
    const first = createTestFile(createFile());
    const completingEditor = new Editor('file', {}, 'complete');
    const mismatched = createTestFile(createFile({ name: 'other.ts' }), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor('file', {}, 'complete');
    const fresh = createTestFile(createFile());
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
    const pendingEditor = new Editor('file', {}, 'pending-disposal');
    const pending = createTestFile(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor('file', {}, 'pending-disposal');
    const fresh = createTestFile(createFile({ contents: 'fresh contents' }));
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
    const pendingEditor = new Editor('file', {}, 'pending-clear');
    const pending = createTestFile(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor('file', {}, 'pending-clear');
    const fresh = createTestFile(createFile({ contents: 'fresh contents' }));
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
    const firstEditor = new Editor('file', {}, 'first');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'second');
    const second = createTestFile(createFile());
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

      const freshFirst = new Editor('file', {}, 'first');
      const freshFirstComponent = createTestFile(createFile());
      const freshSecond = new Editor('file', {}, 'second');
      const freshSecondComponent = createTestFile(createFile());
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
    const sourceEditor = new Editor('file-diff');
    const source = createTestDiff(createFile());
    let editor: Editor<'file-diff', undefined> | undefined;
    let incomplete: FileDiff<undefined> | undefined;
    try {
      sourceEditor.edit(source);
      const initialState = sourceEditor.getEditState();
      expect(initialState).toBeDefined();

      editor = new Editor('file-diff', {
        initialState: initialState!,
      });
      incomplete = createIncompleteTestDiff(createFile());
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
    const firstEditor = new Editor('file', {}, 'shared');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'shared');
    const second = createTestFile(createFile());
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
    const editor = new Editor('file', {}, 'recycled');
    const component = createThrowingTestFile(createFile());
    component.shouldThrow = false;
    const competingEditor = new Editor('file', {}, 'recycled');
    const competing = createTestFile(createFile());
    try {
      editor.edit(component);
      insertAtStart(editor, 'X');
      editor.cleanUp('recycle');
      component.cleanUp(true);
      component.virtualizedSetup();
      const retainedUndoStack = EditStateManager.get<'file', undefined>(
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

  test('failed recycled external sync keeps the transferred document', () => {
    const dom = installDom();
    const editor = new Editor('file', {}, 'recycled');
    const component = createExternalSyncThrowingTestFile(
      createFile(),
      createFile({ contents: 'external replacement' })
    );
    component.shouldThrow = false;
    try {
      editor.edit(component);
      insertAtStart(editor, 'retained:');
      editor.cleanUp('recycle');
      component.cleanUp(true);
      component.virtualizedSetup();

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
    const editor = new Editor('file', {}, 'failed');
    const failing = createSyncingThrowingTestFile(createFile());
    const retry = createTestFile(createFile());
    const competingEditor = new Editor('file', {}, 'failed');
    const competing = createTestFile(createFile());
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
    const firstEditor = new Editor('file', {}, 'failed');
    const first = createTestFile(createFile());
    const failingEditor = new Editor('file', {}, 'failed');
    const failing = createEditingSyncingThrowingTestFile(
      createFile({ name: 'other.ts' })
    );
    const resumedEditor = new Editor('file', {}, 'failed');
    const resumed = createTestFile(createFile());
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
    const firstEditor = new Editor('file', {}, 'annotations');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'annotations');
    const second = createTestFile(createFile());
    try {
      first.render({
        lineAnnotations: [{ lineNumber: 2, metadata: undefined }],
      });
      firstEditor.edit(first);
      insertAtStart(firstEditor, 'X\n');
      expect(first.testLineAnnotations?.[0]?.lineNumber).toBe(3);
      const retainedAnnotations = first.testLineAnnotations;
      firstEditor.cleanUp('discard');
      first.cleanUp();

      second.render({ lineAnnotations: retainedAnnotations });
      secondEditor.edit(second);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(second.testLineAnnotations?.[0]?.lineNumber).toBe(2);
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
    const annotation: LineAnnotation<undefined> = {
      lineNumber: 2,
      metadata: undefined,
    };
    const firstEditor = new Editor('file', {}, 'annotations');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'annotations');
    const second = createTestFile(createFile());
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
      expect(first.testLineAnnotations).toEqual([]);
      firstEditor.cleanUp('discard');
      first.cleanUp();

      second.render({ lineAnnotations: [] });
      secondEditor.edit(second);
      secondEditor.undo();
      expect(secondEditor.getText()).toBe(FILE_CONTENTS);
      expect(second.testLineAnnotations).toEqual([
        { lineNumber: 2, metadata: undefined },
      ]);
      expect(second.testLineAnnotations?.[0]).toBe(annotation);
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
    const firstEditor = new Editor('file', {}, 'external');
    const first = createTestFile(createFile());
    const secondEditor = new Editor('file', {}, 'external');
    const second = createTestFile(createFile(), {
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
        [{ lineNumber: 2, metadata: undefined }]
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    const activeEditor = new Editor('file', {}, 'active');
    const active = createTestFile(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const activeEditor = new Editor('file', {}, 'active-shrink');
    const active = createTestFile(createFile());
    const resumedEditor = new Editor('file', {}, 'active-shrink');
    const resumed = createTestFile(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      const text = editor.getText();
      editor.cleanUp('discard');
      component.cleanUp();
      return text;
    };
    const activeEditor = new Editor('file', {}, 'completed-mru');
    const active = createTestFile(createFile());
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
    const activeEditor = new Editor('file', {}, 'active');
    const active = createTestFile(createFile());
    const competingEditor = new Editor('file', {}, 'active');
    const competing = createTestFile(createFile());
    try {
      activeEditor.edit(active);
      insertAtStart(activeEditor, 'active:');
      for (let index = 0; index < 100; index++) {
        const editor = new Editor('file', {}, `pressure-${index}`);
        const component = createTestFile(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const pendingEditor = new Editor('file', {}, 'pending');
    const pending = createTestFile(createFile(), {
      syncOnAttach: false,
    });
    const freshEditor = new Editor('file', {}, 'pending');
    const fresh = createTestFile(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
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
      if (type === 'file') {
        const editor = new Editor('file', {}, key);
        const component = createTestFile(createFile());
        editor.edit(component);
        insertAtStart(editor, prefix);
        editor.cleanUp('discard');
        component.cleanUp();
      } else {
        const editor = new Editor('file-diff', {}, key);
        const component = createTestDiff(createFile());
        editor.edit(component);
        insertAtStart(editor, prefix);
        editor.cleanUp('discard');
        component.cleanUp();
      }
    };
    const read = (type: 'file' | 'file-diff', key: string): string => {
      if (type === 'file') {
        const editor = new Editor('file', {}, key);
        const component = createTestFile(createFile());
        editor.edit(component);
        const text = editor.getText();
        editor.cleanUp('discard');
        component.cleanUp();
        return text;
      }
      const editor = new Editor('file-diff', {}, key);
      const component = createTestDiff(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
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
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
      editor.edit(component);
      insertAtStart(editor, prefix);
      editor.cleanUp('discard');
      component.cleanUp();
    };
    const read = (key: string): string => {
      const editor = new Editor('file', {}, key);
      const component = createTestFile(createFile());
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
  test('recycle keeps document and undo history across re-attach', async () => {
    const dom = installDom();
    try {
      const editor = new Editor('file');
      const first = createTestFile(createFile());
      editor.edit(first);
      insertAtStart(editor, 'X');
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Simulate a virtualized unmount: the host recycles, the editor is
      // unrendered non-destructively.
      editor.cleanUp('recycle');
      first.cleanUp(true);
      first.virtualizedSetup();

      // Remount renders from the item's unchanged contents; the retained
      // document (holding the unsaved edit) must win over host contents.
      editor.edit(first);
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      // Undo history lives in the retained document and survives with it.
      editor.undo();
      expect(editor.getText()).toBe(FILE_CONTENTS);

      editor.cleanUp();
      await wait(0);
    } finally {
      dom.cleanup();
    }
  });

  test('an empty virtualized window preserves selections without restoring focus', async () => {
    const dom = installDom();
    const onAttach = mock((attachedEditor: Editor<'file', undefined>) => {
      attachedEditor.focus({ lineNumber: 2, preventScroll: true });
    });
    const editor = new Editor('file', { onAttach });
    const component = createTestFile(createFile());
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
    const onAttach = mock((attachedEditor: Editor<'file', undefined>) => {
      // The positional focus defers its real focus() call to a rAF. A blur
      // plus a host rerender landing in that gap must cancel the stale
      // frame instead of pulling focus into the replaced content.
      attachedEditor.focus({ lineNumber: 2, preventScroll: true });
      component.contentElement.dispatchEvent(new Event('blur'));
      component.rerender();
      component.contentElement.focus = restoredFocus;
    });
    const editor = new Editor('file', { onAttach });
    const component = createTestFile(createFile());
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

  test('recycled re-attach recreates a tokenizer so edits still paint', async () => {
    const dom = installDom();
    try {
      const editor = new Editor('file');
      const first = createTestFile(createFile());
      editor.edit(first);

      editor.cleanUp('recycle');
      first.cleanUp(true);
      first.virtualizedSetup();

      // Re-attach with an unchanged name/lang/cacheKey skips the document
      // rebuild. The tokenizer must be recreated anyway, otherwise #rerender
      // bails and this edit would update the model without painting.
      editor.edit(first);
      insertAtStart(editor, 'Y');

      expect(editor.getText()).toBe(`Y${FILE_CONTENTS}`);
      const firstLine = first.contentElement.children[0] as HTMLElement;
      expect(firstLine.textContent).toBe('Yalpha');

      editor.cleanUp();
      await wait(0);
    } finally {
      dom.cleanup();
    }
  });

  test('full cleanUp still rebuilds from host contents', () => {
    const dom = installDom();
    try {
      const editor = new Editor('file');
      const first = createTestFile(createFile());
      editor.edit(first);
      insertAtStart(editor, 'X');
      expect(editor.getText()).toBe(`X${FILE_CONTENTS}`);

      editor.cleanUp();
      first.cleanUp();

      // A destructive cleanUp drops the document, so the next edit() builds
      // from whatever the host currently renders and undo history is gone.
      const second = createTestFile(createFile());
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
        (_editor: Editor<'file', undefined>, _component: File<undefined>) => {}
      );
      const editor = new Editor('file', { onAttach });
      const first = createTestFile(createFile());
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
      first.virtualizedSetup();

      // The associated component can receive a different external file while
      // unrendered; the retained document must not leak into that replacement.
      first.renderExternalFile({
        name: 'other.ts',
        contents: 'zulu',
        lang: 'text',
      });
      await wait(0);
      editor.edit(first);
      await waitFor(() => editor.getText() === 'zulu');
      expect(editor.getText()).toBe('zulu');
      expect(editor.getViewState().selections).toBeUndefined();
      expect(onAttach).toHaveBeenCalledTimes(1);

      editor.cleanUp();
    } finally {
      dom.cleanup();
    }
  });
});
