import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions, type IStateStorage } from '../src/editor';
import {
  applyTextChangeToSelections,
  DirectionForward,
  DirectionNone,
  getSelectedLineBlocks,
  resolveIndentEdits,
  shiftSelectionLines,
} from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { EditorSelection, FileContents, TextEdit } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = container.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }

  throw new Error('editor content did not become editable');
}

interface EditorTestWindow extends Window {
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
  PointerEvent: {
    new (type: string, eventInitDict?: PointerEventInit): PointerEvent;
  };
}

interface EditorFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  file: File<undefined>;
  fileContainer: HTMLElement;
  fileContents: FileContents;
  window: EditorTestWindow;
}

async function createEditorFixture(
  contents: string,
  editorOptions?: EditorOptions<undefined>,
  fileOptions?: Partial<FileOptions<undefined>>,
  fileContents?: Partial<FileContents>
): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    ...fileOptions,
  });
  const editor = new Editor<undefined>(editorOptions);
  const initialFile: FileContents = {
    name: 'edits.ts',
    contents,
    ...(editorOptions?.persistState === true ? { cacheKey: 'edits-file' } : {}),
    ...fileContents,
  };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);

  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    editor,
    file,
    fileContainer,
    fileContents: initialFile,
    window: dom.window as unknown as EditorTestWindow,
  };
}

// Drives the editor's undo/redo keyboard shortcut. The harness navigator
// reports macOS, so the primary modifier is the meta key; `shift` selects redo.
function pressUndoRedo(
  window: EditorTestWindow,
  content: HTMLElement,
  shift: boolean
): void {
  content.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      shiftKey: shift,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  );
}

function pressMoveLine(
  window: EditorTestWindow,
  content: HTMLElement,
  direction: 'up' | 'down'
): void {
  content.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: direction === 'up' ? 'ArrowUp' : 'ArrowDown',
      altKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  );
}

function pressKey(
  window: EditorTestWindow,
  content: HTMLElement,
  init: KeyboardEventInit
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  content.dispatchEvent(event);
  return event;
}

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

async function renderFileAndWait(
  fixture: EditorFixture,
  fileContents: FileContents
): Promise<void> {
  fixture.file.render({
    file: fileContents,
    fileContainer: fixture.fileContainer,
    forceRender: true,
  });
  await waitFor(() => {
    const file = fixture.editor.getFile();
    return (
      file?.name === fileContents.name &&
      file.cacheKey === fileContents.cacheKey
    );
  });
}

describe('Editor persisted file state', () => {
  test('requires an explicit cache key when enabled', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    const fileContents: FileContents = {
      name: 'unkeyed.ts',
      contents: 'alpha\n',
    };
    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const editor = new Editor<undefined>({ persistState: true });

    try {
      file.render({ file: fileContents, fileContainer, forceRender: true });

      expect(() => editor.edit(file)).toThrow(
        'Editor persistState requires a non-empty file.cacheKey for "unkeyed.ts".'
      );
      expect(fileContents.cacheKey).toBeUndefined();
    } finally {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    }
  });

  test('rejects enabling persistence before an attached file finishes syncing', () => {
    const dom = installDom();
    const fileContainer = document.createElement('div');
    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const editor = new Editor<undefined>();

    try {
      file.render({
        file: { name: 'edits.ts', contents: 'alpha\n' },
        fileContainer,
        forceRender: true,
      });
      editor.edit(file);

      expect(() => editor.setOptions({ persistState: true })).toThrow(
        'Editor persistState requires a non-empty file.cacheKey for "edits.ts".'
      );
    } finally {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    }
  });

  test('is disabled by default', async () => {
    const storageCalls: string[] = [];
    const storage: IStateStorage = {
      get(cacheKey) {
        storageCalls.push(`get:${cacheKey}`);
        return undefined;
      },
      set(cacheKey) {
        storageCalls.push(`set:${cacheKey}`);
      },
    };
    const fixture = await createEditorFixture('alpha\nbravo\n', {
      persistStateStorage: storage,
    });

    try {
      insertAtStart(fixture.editor, 'X');
      await renderFileAndWait(fixture, {
        name: 'other.ts',
        contents: 'one\n',
        cacheKey: 'other',
      });
      await renderFileAndWait(fixture, {
        name: 'edits.ts',
        contents: 'alpha\nbravo\n',
        cacheKey: 'edits-file',
      });

      expect(fixture.editor.getText()).toBe('alpha\nbravo\n');
      expect(fixture.editor.canUndo).toBe(false);
      expect(storageCalls).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  test('restores the cached document, undo history, and editor state', async () => {
    const fixture = await createEditorFixture('alpha\nbravo\n', {
      persistState: true,
    });

    try {
      insertAtStart(fixture.editor, 'X');
      fixture.editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 'forward',
        },
      ]);

      await renderFileAndWait(fixture, {
        name: 'other.ts',
        contents: 'one\n',
        cacheKey: 'other',
      });
      // A fresh object with the same explicit key resumes the editing session.
      await renderFileAndWait(fixture, {
        name: 'edits.ts',
        contents: 'alpha\nbravo\n',
        cacheKey: 'edits-file',
      });

      expect(fixture.editor.getText()).toBe('Xalpha\nbravo\n');
      expect(fixture.editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 1,
        },
      ]);
      expect(
        fixture.fileContainer.shadowRoot?.querySelector(
          '[data-content] [data-line="1"]'
        )?.textContent
      ).toBe('Xalpha');
      expect(fixture.editor.canUndo).toBe(true);

      fixture.editor.undo();
      expect(fixture.editor.getText()).toBe('alpha\nbravo\n');
    } finally {
      fixture.cleanup();
    }
  });

  test('uses a custom state storage with the explicit file key', async () => {
    const states = new Map<string, ReturnType<Editor<undefined>['getState']>>();
    const calls: string[] = [];
    const storage: IStateStorage = {
      get(cacheKey) {
        calls.push(`get:${cacheKey}`);
        return states.get(cacheKey);
      },
      set(cacheKey, state) {
        calls.push(`set:${cacheKey}`);
        states.set(cacheKey, state);
      },
    };
    const fixture = await createEditorFixture('alpha\nbravo\n', {
      persistState: true,
      persistStateStorage: storage,
    });

    try {
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);
      await renderFileAndWait(fixture, {
        name: 'other.ts',
        contents: 'one\n',
        cacheKey: 'other-revision',
      });
      await renderFileAndWait(fixture, {
        name: 'edits.ts',
        contents: 'alpha\nbravo\n',
        cacheKey: 'edits-file',
      });

      expect(calls).toContain('set:edits-file');
      expect(calls).toContain('get:other-revision');
      expect(calls).toContain('set:other-revision');
      expect(calls.at(-1)).toBe('get:edits-file');
      expect(fixture.editor.getState().selections?.[0]).toMatchObject({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 2 },
        direction: 0,
      });
    } finally {
      fixture.cleanup();
    }
  });
});

describe('Editor.applyEdits selection sync', () => {
  test('keeps inserted file lines coherent when switching files', async () => {
    const { cleanup, editor, file, fileContainer, fileContents } =
      await createEditorFixture('alpha\nbravo\n', undefined, {
        disableErrorHandling: true,
      });

    try {
      editor.applyEdits([
        {
          range: {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 5 },
          },
          newText: '\ncharlie',
        },
      ]);

      expect(editor.getText()).toBe('alpha\nbravo\ncharlie\n');

      const otherFile: FileContents = {
        name: 'other.ts',
        contents: 'one\n',
        cacheKey: 'other.ts',
      };
      expect(() =>
        file.render({ file: otherFile, fileContainer, forceRender: true })
      ).not.toThrow();

      expect(fileContents.contents).toBe('alpha\nbravo\ncharlie\n');
      expect(() =>
        file.render({ file: fileContents, fileContainer, forceRender: true })
      ).not.toThrow();
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie\n');
    } finally {
      cleanup();
    }
  });

  test('shifts the caret down when an edit inserts lines above it', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(editor.getText()).toBe('NEW\nalpha\nbravo\ncharlie');
      // The caret was inside "charlie"; inserting a line above must move it down
      // one line so it still points at the same character of "charlie".
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('moves the caret past text inserted at the caret', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: 'XYZ',
        },
      ]);

      expect(editor.getText()).toBe('alXYZpha\nbravo');
      // The caret must follow the inserted text so the next keystroke lands
      // after it, not in front of it.
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('remaps the caret through an insertion snapped before a surrogate pair', async () => {
    const { cleanup, editor } = await createEditorFixture('📚 plans');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'a',
        },
      ]);

      expect(editor.getText()).toBe('a📚 plans');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('shifts both edges of a selected range and preserves direction', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          direction: 'forward',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 1 },
          end: { line: 3, character: 4 },
          direction: 1,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('leaves the caret unchanged for an edit after it', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(editor.getText()).toBe('alpha\nbravo\nNEW\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('restores the remapped caret on redo with default history tracking', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      pressUndoRedo(window, content, false);
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 0,
        },
      ]);

      pressUndoRedo(window, content, true);
      expect(editor.getText()).toBe('NEW\nalpha\nbravo\ncharlie');
      // Redo must restore the caret to the post-edit (remapped) position, not
      // leave it where undo placed it.
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('remaps live selections when history metadata is disabled', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'NEW\n',
          },
        ],
        false
      );

      editor.undo();
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
      expect(editor.getState().selections).toEqual([caret(2, 3)]);

      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);
      editor.redo();
      expect(editor.getText()).toBe('NEW\nalpha\nbravo\ncharlie');
      expect(editor.getState().selections).toEqual([caret(1, 2)]);
    } finally {
      cleanup();
    }
  });

  test('does not steal focus when the editor is not focused', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // The editor tracks focus via focus/blur on the content element. Focus
      // first so the editor is genuinely focused, then blur to mimic the user
      // moving to another input on the page. The focus is required: the editor
      // starts unfocused, so without it the blur would be a no-op and the test
      // would pass even if the blur handler stopped clearing focus.
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));

      const focusSpy = spyOn(editor, 'focus');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      // Selection state is still remapped so it stays correct...
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
      // ...but the editor must not pull focus back to itself.
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test('repositions focus when the editor is already focused', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // Mark the editor as focused the same way a real focus would.
      content.dispatchEvent(new Event('focus'));

      const focusSpy = spyOn(editor, 'focus');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test('repositions focus when a focus is still pending from the same tick', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // focus() queues the real contentElement.focus() in a rAF, so the focus
      // event has not fired yet. A same-tick applyEdits (the common
      // set-selection-then-edit flow) must still treat the editor as focused and
      // reposition, rather than skip and leave the native selection stale while
      // the queued focus lands afterward.
      editor.focus();

      const focusSpy = spyOn(editor, 'focus');
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(editor.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test('ignores a selectionchange while the editor is unfocused', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    // Spying on the shared global document/window getSelection, so restore in
    // finally to avoid leaking the stubs into later tests.
    let getSelectionStub: { mockRestore(): void } | undefined;
    let windowSelectionStub: { mockRestore(): void } | undefined;

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // Drain focus frames queued during setup so #shouldIgnoreSelectionChange
      // is cleared and is not the reason the handler bails below.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }

      // jsdom does not implement Selection.getComposedRanges (the shadow-DOM
      // aware API the handler reads the caret through), so stub it to return a
      // collapsed range anchored on the first rendered line. Captured after the
      // drain so the node is the settled, attached line element.
      const firstLine = content.querySelector('[data-line="1"]');
      if (firstLine == null) {
        throw new Error('expected a rendered line element');
      }
      const composedRange = {
        startContainer: firstLine,
        startOffset: 0,
        endContainer: firstLine,
        endOffset: 0,
      };
      getSelectionStub = spyOn(document, 'getSelection').mockReturnValue({
        getComposedRanges: () => [composedRange],
      } as unknown as Selection);
      // The focus events below also drive the editor's native-selection re-sync
      // (window.getSelection().setBaseAndExtent), so stub that to a no-op rather
      // than let jsdom's partial Selection throw.
      windowSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
        setBaseAndExtent: () => {},
      } as unknown as Selection);

      // Unfocused: a selectionchange whose range still belongs to the editor
      // must not overwrite the remapped caret before the user returns.
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('selectionchange'));
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 0,
        },
      ]);

      // Focused: the same selectionchange is honored and moves the caret to the
      // native range (line 0), proving the focus guard — not the stub — gated
      // the unfocused case above.
      content.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('selectionchange'));
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      getSelectionStub?.mockRestore();
      windowSelectionStub?.mockRestore();
      cleanup();
    }
  });

  test('re-syncs the native selection on keyboard refocus', async () => {
    const { cleanup, content, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    // Stub the native Selection so the re-sync is observable and so jsdom's
    // partial setBaseAndExtent does not throw during setup focus frames.
    const setBaseAndExtent = mock(() => {});
    const getSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
      setBaseAndExtent,
    } as unknown as Selection);

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      // Drain focus frames so #shouldIgnoreSelectionChange is cleared, then
      // ignore any selection syncs from setup.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      setBaseAndExtent.mockClear();

      // A keyboard/programmatic refocus (no pointer gesture) on an unfocused
      // editor must re-assert the remapped selection onto the native Selection,
      // so a later stale selectionchange cannot move the caret back.
      content.dispatchEvent(new Event('focus'));
      expect(setBaseAndExtent).toHaveBeenCalled();
    } finally {
      getSelectionStub.mockRestore();
      cleanup();
    }
  });

  test('leaves the native selection to the click on pointer refocus', async () => {
    const {
      cleanup,
      content,
      editor,
      window: testWindow,
    } = await createEditorFixture('alpha\nbravo\ncharlie');
    const setBaseAndExtent = mock(() => {});
    const getSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
      setBaseAndExtent,
    } as unknown as Selection);

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      // A mouse pointerdown precedes focus on a click and sets the mouse-down
      // flag the focus handler checks; ignore any prior setup syncs.
      content.dispatchEvent(
        new testWindow.PointerEvent('pointerdown', { button: 0 })
      );
      setBaseAndExtent.mockClear();

      // The editor must defer to the click's own caret, not re-assert the stale
      // remapped selection over it.
      content.dispatchEvent(new Event('focus'));
      expect(setBaseAndExtent).not.toHaveBeenCalled();
    } finally {
      getSelectionStub.mockRestore();
      cleanup();
    }
  });
});

describe('Editor move line commands', () => {
  test('moves the current line up and down', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      pressMoveLine(window, content, 'up');
      expect(editor.getText()).toBe('bravo\nalpha\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 0,
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('moves the final line up without adding a trailing newline', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      pressMoveLine(window, content, 'up');
      expect(editor.getText()).toBe('alpha\ncharlie\nbravo');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 3 },
          end: { line: 1, character: 3 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('moves every selected line in a range', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'zero\none\ntwo\nthree\nfour'
    );

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 3, character: 2 },
          direction: 'forward',
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(editor.getText()).toBe('zero\nfour\none\ntwo\nthree');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 1 },
          end: { line: 4, character: 2 },
          direction: 1,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('clamps an exclusive selection end when moving to EOF', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
          direction: 'forward',
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(editor.getText()).toBe('alpha\ncharlie\nbravo');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 5 },
          direction: 1,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('moves multiple selections as separate line blocks', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('a\nb\nc\nd\ne\nf');

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
          direction: 'forward',
        },
        {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 1 },
          direction: 'forward',
        },
      ]);

      pressMoveLine(window, content, 'up');
      expect(editor.getText()).toBe('b\na\nc\ne\nd\nf');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
          direction: 1,
        },
        {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 1 },
          direction: 1,
        },
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('Editor editing commands', () => {
  test('deletes to the end of the line with macOS control+k', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('hello world\nnext');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      const keydown = pressKey(window, content, {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
      });

      expect(keydown.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('hello\nnext');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('copies selected lines and keeps the requested copy selected', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      pressKey(window, content, {
        key: 'ArrowUp',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha\nbravo\nbravo\ncharlie');
      expect(editor.getState().selections?.[0].start).toEqual({
        line: 1,
        character: 2,
      });

      pressKey(window, content, {
        key: 'ArrowDown',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha\nbravo\nbravo\nbravo\ncharlie');
      expect(editor.getState().selections?.[0].start).toEqual({
        line: 2,
        character: 2,
      });
    } finally {
      cleanup();
    }
  });

  test('simplifies to the primary range before collapsing it', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('alpha\nbravo');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 'forward',
        },
      ]);

      pressKey(window, content, { key: 'Escape' });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 1,
        },
      ]);

      pressKey(window, content, { key: 'Escape' });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 4 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('inserts an indented blank line after every selected final line', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('zero\n  one\ntwo');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 5 },
          direction: 'forward',
        },
      ]);

      pressKey(window, content, { key: 'Enter', metaKey: true });

      expect(editor.getText()).toBe('zero\n\n  one\n  \ntwo');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
        {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 2 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('inserts a blank line below the active end of a backward selection', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('zero\n  one\ntwo');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 1, character: 3 },
          direction: 'backward',
        },
      ]);

      pressKey(window, content, { key: 'Enter', metaKey: true });

      expect(editor.getText()).toBe('zero\n\n  one\ntwo');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('indents whole lines with the bracket shortcuts', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('alpha');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: 'none',
        },
      ]);

      pressKey(window, content, { key: ']', metaKey: true });
      expect(editor.getText()).toBe('  alpha');
      expect(editor.getState().selections?.[0].start.character).toBe(5);

      pressKey(window, content, { key: '[', metaKey: true });
      expect(editor.getText()).toBe('alpha');
      expect(editor.getState().selections?.[0].start.character).toBe(3);
    } finally {
      cleanup();
    }
  });

  test('toggles default and SQL line comments', async () => {
    const typescriptFixture = await createEditorFixture('  const value = 1;');
    try {
      typescriptFixture.editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);
      pressKey(typescriptFixture.window, typescriptFixture.content, {
        key: '/',
        metaKey: true,
      });
      expect(typescriptFixture.editor.getText()).toBe('  // const value = 1;');
      pressKey(typescriptFixture.window, typescriptFixture.content, {
        key: '/',
        metaKey: true,
      });
      expect(typescriptFixture.editor.getText()).toBe('  const value = 1;');
    } finally {
      typescriptFixture.cleanup();
    }

    const sqlFixture = await createEditorFixture(
      'select * from users;',
      undefined,
      undefined,
      { name: 'query.sql' }
    );
    try {
      sqlFixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      pressKey(sqlFixture.window, sqlFixture.content, {
        key: '/',
        metaKey: true,
      });
      expect(sqlFixture.editor.getText()).toBe('-- select * from users;');
    } finally {
      sqlFixture.cleanup();
    }
  });

  test('uses line-wise block comments when a language has no line token', async () => {
    const cases = [
      {
        name: 'styles.css',
        contents: '  color: red;',
        commented: '  /* color: red; */',
      },
      {
        name: 'index.html',
        contents: '  <div></div>',
        commented: '  <!-- <div></div> -->',
      },
    ];

    for (const { name, contents, commented } of cases) {
      const fixture = await createEditorFixture(
        contents,
        undefined,
        undefined,
        { name }
      );
      try {
        fixture.editor.setSelections(
          [4, 8].map((character) => ({
            start: { line: 0, character },
            end: { line: 0, character },
            direction: 'none' as const,
          }))
        );

        pressKey(fixture.window, fixture.content, {
          key: '/',
          metaKey: true,
        });
        expect(fixture.editor.getText()).toBe(commented);

        pressKey(fixture.window, fixture.content, {
          key: '/',
          metaKey: true,
        });
        expect(fixture.editor.getText()).toBe(contents);
      } finally {
        fixture.cleanup();
      }
    }
  });

  test('toggles block comments while preserving the selected content', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('alpha beta');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 10 },
          direction: 'forward',
        },
      ]);

      pressKey(window, content, {
        key: 'A',
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha /* beta */');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 13 },
          direction: 1,
        },
      ]);

      pressKey(window, content, {
        key: 'A',
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha beta');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 10 },
          direction: 1,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('places a collapsed caret inside a new block comment', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('alpha ');

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 6 },
          direction: 'none',
        },
      ]);

      pressKey(window, content, {
        key: 'A',
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha /*  */');
      expect(editor.getState().selections?.[0].start.character).toBe(9);

      pressKey(window, content, {
        key: 'A',
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
      });
      expect(editor.getText()).toBe('alpha ');
      expect(editor.getState().selections?.[0].start.character).toBe(6);
    } finally {
      cleanup();
    }
  });
});

describe('Editor undo/redo API', () => {
  const insertBang = [
    {
      range: {
        start: { line: 0, character: 5 },
        end: { line: 0, character: 5 },
      },
      newText: '!',
    },
  ];

  test('canUndo and canRedo reflect the history state', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha');

    try {
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(false);

      editor.applyEdits(insertBang, true);

      expect(editor.getText()).toBe('alpha!');
      expect(editor.canUndo).toBe(true);
      expect(editor.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('undo reverts the last edit and redo re-applies it', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha');

    try {
      editor.applyEdits(insertBang, true);
      expect(editor.getText()).toBe('alpha!');

      editor.undo();
      expect(editor.getText()).toBe('alpha');
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(true);

      editor.redo();
      expect(editor.getText()).toBe('alpha!');
      expect(editor.canUndo).toBe(true);
      expect(editor.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('undo and redo do nothing when there is no history', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha');

    try {
      editor.undo();
      editor.redo();

      expect(editor.getText()).toBe('alpha');
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('programmatic undo matches the keyboard undo result', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('alpha');

    try {
      const edit = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'X',
        },
      ];

      editor.applyEdits(edit, true);
      pressUndoRedo(window, content, false);
      const keyboardResult = editor.getText();

      pressUndoRedo(window, content, true);
      expect(editor.getText()).toBe('Xalpha');

      editor.undo();
      expect(editor.getText()).toBe(keyboardResult);
    } finally {
      cleanup();
    }
  });

  test('undo notifies the onChange callback', async () => {
    let changeCount = 0;
    const { cleanup, editor } = await createEditorFixture('alpha', {
      onChange() {
        changeCount++;
      },
    });

    try {
      editor.applyEdits(insertBang, true);
      const countAfterEdit = changeCount;

      editor.undo();

      // Undo runs through the same change path as an edit, so consumers are
      // notified and can re-read canUndo/canRedo to update their UI.
      expect(changeCount).toBe(countAfterEdit + 1);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The suites below drive applyEdits at the TextDocument level (no DOM
// fixture): batch ordering, selection-aware undo/redo, change records, and
// the line-based commands composed from the document primitives.
// ---------------------------------------------------------------------------

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function edit(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    newText,
  };
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

// A direction-less range selection; contrast with range() below, which
// builds a forward selection.
function select(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionNone,
  };
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionForward,
  } satisfies EditorSelection;
}

// True when `text` contains a high surrogate without its low half (or vice
// versa) — the corruption signature these tests guard against.
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // well-formed pair
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// Deterministic pseudo-random source (32-bit LCG) so the randomized round-trip
// test replays the exact same edit sequence on every run.
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Mirrors Editor#moveSelectedLines (src/editor/editor.ts ~line 2267):
// getSelectedLineBlocks merges the selections into line blocks, each block is
// rotated with its neighbor line in one edit, and every selection is remapped
// with shiftSelectionLines — the same composition the keyboard command runs,
// minus the DOM. The 'Editor move line commands' suite above covers the
// single-block and separate-block cases through the real Editor; the tests
// here add the merged/interleaved and same-line multi-caret behaviors.
function moveLines(
  d: TextDocument<unknown>,
  selections: EditorSelection[],
  direction: -1 | 1
): EditorSelection[] {
  const blocks = getSelectedLineBlocks(selections);
  if (
    blocks.length === 0 ||
    (direction < 0 && blocks[0].startLine === 0) ||
    (direction > 0 && blocks[blocks.length - 1].endLine >= d.lineCount - 1)
  ) {
    return selections;
  }
  const lineCount = d.lineCount;
  const lineRangeEnd = (line: number) =>
    line < lineCount - 1
      ? { line: line + 1, character: 0 }
      : { line, character: d.getLineLength(line) };
  const getLinesText = (lines: number[], appendFinalLineBreak: boolean) => {
    const text = lines.map((line) => d.getLineText(line)).join(d.eol);
    return appendFinalLineBreak ? text + d.eol : text;
  };
  const edits: TextEdit[] = [];
  if (direction < 0) {
    for (const block of blocks) {
      const previousLine = block.startLine - 1;
      const blockLines: number[] = [];
      for (let line = block.startLine; line <= block.endLine; line++) {
        blockLines.push(line);
      }
      edits.push({
        range: {
          start: { line: previousLine, character: 0 },
          end: lineRangeEnd(block.endLine),
        },
        newText: getLinesText(
          [...blockLines, previousLine],
          block.endLine < lineCount - 1
        ),
      });
    }
  } else {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      const nextLine = block.endLine + 1;
      const blockLines: number[] = [];
      for (let line = block.startLine; line <= block.endLine; line++) {
        blockLines.push(line);
      }
      edits.push({
        range: {
          start: { line: block.startLine, character: 0 },
          end: lineRangeEnd(nextLine),
        },
        newText: getLinesText(
          [nextLine, ...blockLines],
          nextLine < lineCount - 1
        ),
      });
    }
  }
  const lastBlock = blocks[blocks.length - 1];
  const lastLineLengthAfterMove =
    direction > 0 && lastBlock.endLine === lineCount - 2
      ? d.getLineLength(lastBlock.endLine)
      : d.getLineLength(lineCount - 1);
  const nextSelections = selections.map((selection) =>
    shiftSelectionLines(selection, direction, lineCount, (line) =>
      line === lineCount - 1 ? lastLineLengthAfterMove : d.getLineLength(line)
    )
  );
  d.applyEdits(edits, true, selections, nextSelections, true);
  return nextSelections;
}

// Types a lone Enter at the primary selection, the way the Editor feeds a
// newline keystroke through applyTextChangeToSelections (which expands it via
// expandSingleNewlineInsert to carry the current line's indentation).
function pressEnter(d: TextDocument<unknown>, selection: EditorSelection) {
  const start = d.offsetAt(selection.start);
  const end = d.offsetAt(selection.end);
  return applyTextChangeToSelections(d, [selection], {
    start,
    end,
    text: '\n',
  });
}

describe('applyEdits: surrogate pair boundaries', () => {
  // The document starts with 📚, a two-UTF-16-unit astral character occupying
  // characters 0 and 1 of line 0. Character 1 therefore sits strictly between
  // the high and low surrogate — an invalid caller position that the
  // conventional behavior auto-corrects so the pair is never split.

  test('insert strictly inside a surrogate pair snaps to before the pair', () => {
    const d = doc('📚plans\nfor the\nweekend');
    d.applyEdits([edit(0, 1, 0, 1, 'a')]);
    expect(hasLoneSurrogate(d.getText())).toBe(false);
    expect(d.getLineText(0)).toBe('a📚plans');
  });

  test('replace starting inside a surrogate pair widens to cover the whole pair', () => {
    const d = doc('📚plans\nfor the\nweekend');
    d.applyEdits([edit(0, 1, 0, 2, 'a')]);
    expect(hasLoneSurrogate(d.getText())).toBe(false);
    expect(d.getLineText(0)).toBe('aplans');
  });

  test('replace ending inside a surrogate pair widens to cover the whole pair', () => {
    const d = doc('📚plans\nfor the\nweekend');
    d.applyEdits([edit(0, 0, 0, 1, 'a')]);
    expect(hasLoneSurrogate(d.getText())).toBe(false);
    expect(d.getLineText(0)).toBe('aplans');
  });

  test('applyResolvedEdits normalizes surrogate-pair boundaries', () => {
    const cases = [
      [1, 1, 'a📚plans'],
      [1, 2, 'aplans'],
      [0, 1, 'aplans'],
    ] as const;

    for (const [start, end, expected] of cases) {
      const d = doc('📚plans\nfor the\nweekend');
      d.applyResolvedEdits([{ start, end, text: 'a' }]);
      expect(hasLoneSurrogate(d.getText())).toBe(false);
      expect(d.getLineText(0)).toBe(expected);
    }
  });

  test('replace spanning exactly the whole surrogate pair replaces it cleanly', () => {
    const d = doc('📚plans\nfor the\nweekend');
    d.applyEdits([edit(0, 0, 0, 2, 'a')]);
    expect(d.getLineText(0)).toBe('aplans');
    expect(d.getText()).toBe('aplans\nfor the\nweekend');
  });
});

describe('applyEdits: touching edits', () => {
  test('two zero-width inserts at the identical position apply in input order', () => {
    const d = doc('mole');
    d.applyEdits([edit(0, 1, 0, 1, 'a'), edit(0, 1, 0, 1, 'b')]);
    expect(d.getText()).toBe('mabole');

    // Swapping the input order swaps the output order: ordering comes from
    // the caller's array, not from any property of the edits themselves.
    const d2 = doc('mole');
    d2.applyEdits([edit(0, 1, 0, 1, 'b'), edit(0, 1, 0, 1, 'a')]);
    expect(d2.getText()).toBe('mbaole');
  });
});

describe('applyEdits: compound multi-cursor batches and undo', () => {
  test('undo exactly restores the original text after a compound batch of touching edits', () => {
    // Simulates a two-cursor move-line-up: one edit deletes a line body,
    // another deletes an adjacent line including its break, and two
    // zero-width inserts re-create the moved lines — all ranges touching at
    // their endpoints, applied as one history transaction.
    const original = 'alpha\nbravo\ncharlie\n';
    const d = doc(original);
    d.applyEdits(
      [
        edit(3, 0, 3, 0, 'charlie'),
        edit(2, 0, 2, 7, ''),
        edit(1, 0, 2, 0, ''),
        edit(2, 7, 2, 7, '\nbravo'),
      ],
      true
    );
    expect(d.getText()).toBe('alpha\n\nbravo\ncharlie');

    expect(d.canUndo).toBe(true);
    d.undo();
    expect(d.getText()).toBe(original);

    // The transaction stays reversible in both directions.
    d.redo();
    expect(d.getText()).toBe('alpha\n\nbravo\ncharlie');
    d.undo();
    expect(d.getText()).toBe(original);
  });

  test('undo restores a batch that replaced two equal-size selections with shorter text', () => {
    const original = 'green apples\ngreen apples';
    const d = doc(original);
    // Both cursors have "apples" selected (given bottom-first, as an editor
    // would after adding a selection above) and type the shorter "figs".
    const selectionsBefore = [select(1, 6, 1, 12), select(0, 6, 0, 12)];
    d.applyEdits(
      [edit(1, 6, 1, 12, 'figs'), edit(0, 6, 0, 12, 'figs')],
      true,
      selectionsBefore,
      [select(1, 10, 1, 10), select(0, 10, 0, 10)]
    );
    expect(d.getText()).toBe('green figs\ngreen figs');

    const undone = d.undo();
    expect(d.getText()).toBe(original);
    expect(undone?.[1]).toEqual(selectionsBefore);
  });
});

describe('applyEdits: astral characters and undo history', () => {
  test('manually applied inverse edits round-trip inserts on both sides of an astral character', () => {
    const original = 'x👁y';
    const d = doc(original);

    // Two separate applyEdits calls: one insert immediately before the
    // surrogate pair, one immediately after it (positions in UTF-16 units).
    d.applyEdits([edit(0, 1, 0, 1, '(')]);
    d.applyEdits([edit(0, 4, 0, 4, ')')]);
    expect(d.getText()).toBe('x(👁)y');

    // Ranges near the pair still resolve correctly after the inserts.
    expect(
      d.getText({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
      })
    ).toBe('👁');
    expect(
      d.getText({
        start: { line: 0, character: 4 },
        end: { line: 0, character: 5 },
      })
    ).toBe(')');

    // The exact inverse of both inserts, applied as one batch.
    d.applyEdits([edit(0, 1, 0, 2, ''), edit(0, 4, 0, 5, '')]);
    expect(d.getText()).toBe(original);
    expect(hasLoneSurrogate(d.getText())).toBe(false);
  });

  test('undo and redo round-trip a history entry whose edits touch a surrogate pair', () => {
    // Auto-surround of the leading quote in '👁' with %: two zero-width
    // inserts in one transaction, the second landing immediately before the
    // surrogate pair.
    const original = "'👁'";
    const d = doc(original);
    d.applyEdits([edit(0, 0, 0, 0, '%'), edit(0, 1, 0, 1, '%')], true, [
      select(0, 0, 0, 1),
    ]);
    expect(d.getText()).toBe("%'%👁'");

    d.undo();
    expect(d.getText()).toBe(original);
    expect(hasLoneSurrogate(d.getText())).toBe(false);

    d.redo();
    expect(d.getText()).toBe("%'%👁'");
    expect(hasLoneSurrogate(d.getText())).toBe(false);

    d.undo();
    expect(d.getText()).toBe(original);
  });
});

describe('applyEdits batch: insert at a deletion boundary', () => {
  test('an insert listed before a delete starting at the same offset applies, keeping the insertion', () => {
    // Zero-width insert at offset 5 plus delete of [5,7): the inserted text
    // survives in front of the deleted span — the conventional deterministic
    // handling of an insertion at a deletion's start boundary.
    const d = doc('grapevines');
    d.applyEdits([edit(0, 5, 0, 5, 'XY'), edit(0, 5, 0, 7, '')]);
    expect(d.getText()).toBe('grapeXYnes');
  });

  test('the same logical batch with the delete listed first behaves identically', () => {
    const d = doc('grapevines');
    d.applyEdits([edit(0, 5, 0, 7, ''), edit(0, 5, 0, 5, 'XY')]);
    expect(d.getText()).toBe('grapeXYnes');
  });
});

describe('applyEdits: randomized single-edit invert round-trip', () => {
  test('50 random history edits undo to the byte-identical original and redo to the final text', () => {
    const insertAlphabet = 'twilight harbor\nquiet mooring\n';
    for (const seed of [11, 29, 173]) {
      const rand = makeRandom(seed);
      const original = 'signal flags\nover the pier\n';
      const d = doc(original);
      let mirror = original;

      for (let step = 0; step < 50; step++) {
        const length = mirror.length;
        const from = Math.floor(rand() * (length + 1));
        const to = Math.min(length, from + Math.floor(rand() * 6));
        let insert = '';
        const insertLength = Math.floor(rand() * 5);
        for (let k = 0; k < insertLength; k++) {
          insert += insertAlphabet[Math.floor(rand() * insertAlphabet.length)];
        }
        if (from === to && insert === '') {
          insert = '+'; // keep every step a real edit
        }
        // Each edit records its own history entry: undoBoundary=true defeats
        // typing/backspace coalescing so the undo stack holds all 50 steps.
        d.applyEdits(
          [
            {
              range: { start: d.positionAt(from), end: d.positionAt(to) },
              newText: insert,
            },
          ],
          true,
          undefined,
          undefined,
          true
        );
        mirror = mirror.slice(0, from) + insert + mirror.slice(to);
        expect(d.getText()).toBe(mirror);
      }

      expect(d.version).toBe(50);
      let undoCount = 0;
      while (d.canUndo) {
        d.undo();
        undoCount++;
      }
      expect(undoCount).toBe(50);
      expect(d.getText()).toBe(original);
      expect(d.version).toBe(0);

      let redoCount = 0;
      while (d.canRedo) {
        d.redo();
        redoCount++;
      }
      expect(redoCount).toBe(50);
      expect(d.getText()).toBe(mirror);
      expect(d.version).toBe(50);
    }
  });
});

describe('applyEdits batch: changed line ranges across line-count changes', () => {
  test('a line-adding first edit shifts the second edit into post-edit line numbers', () => {
    // Edit 1 splits line 0 in two (+1 line); edit 2 rewrites old line 3, which
    // is line 4 after the split. The reported ranges must be ascending and in
    // post-edit coordinates, one range per disjoint edit.
    const d = doc('ada\nbabbage\ncurie\ndarwin');
    const change = d.applyEdits([
      edit(0, 3, 0, 3, '\nhopper'),
      edit(3, 0, 3, 6, 'lovelace'),
    ]);
    expect(d.getText()).toBe('ada\nhopper\nbabbage\ncurie\nlovelace');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 3,
      endCharacter: 6,
      endLine: 4,
      endedAtDocumentEnd: true,
      previousLineCount: 4,
      lineCount: 5,
      lineDelta: 1,
      changedLineRanges: [
        [0, 1],
        [4, 4],
      ],
      changedLineChanges: [
        [0, 1, 1, 3, 3, false],
        [4, 4, 0, 0, 6, true],
      ],
    });
  });

  test('a line-removing first edit shifts the second edit down in post-edit line numbers', () => {
    // Edit 1 joins lines 0 and 1 (-1 line); edit 2 rewrites old line 3, which
    // is line 2 after the join.
    const d = doc('ada\nbabbage\ncurie\ndarwin');
    const change = d.applyEdits([
      edit(0, 3, 1, 0, ' '),
      edit(3, 0, 3, 6, 'lovelace'),
    ]);
    expect(d.getText()).toBe('ada babbage\ncurie\nlovelace');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 3,
      endCharacter: 6,
      endLine: 2,
      endedAtDocumentEnd: true,
      previousLineCount: 4,
      lineCount: 3,
      lineDelta: -1,
      changedLineRanges: [
        [0, 0],
        [2, 2],
      ],
      changedLineChanges: [
        [0, 0, -1, 3, 0, false],
        [2, 2, 0, 0, 6, true],
      ],
    });
  });
});

describe('applyEdits: no-op edits recorded in history', () => {
  test('a zero-width empty edit bumps the version and its history entry undoes/redoes harmlessly', () => {
    const d = doc('anchor');
    const change = d.applyEdits([edit(0, 3, 0, 3, '')], true, [caret(0, 3)]);

    // The degenerate edit still produces a change record and a version bump,
    // but the buffer is untouched.
    expect(change?.lineDelta).toBe(0);
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);

    // Undoing the identity entry is a real history step that changes nothing.
    const undone = d.undo();
    expect(undone).toBeDefined();
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(0);
    expect(d.canRedo).toBe(true);

    const redone = d.redo();
    expect(redone).toBeDefined();
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  test('a no-op entry does not coalesce with real typing on either side', () => {
    const d = doc('');
    d.applyEdits([edit(0, 0, 0, 0, 'a')], true, [caret(0, 0)]);
    d.applyEdits([edit(0, 1, 0, 1, '')], true, [caret(0, 1)]); // no-op
    d.applyEdits([edit(0, 1, 0, 1, 'b')], true, [caret(0, 1)]);
    expect(d.getText()).toBe('ab');

    // Three separate undo steps: the identity entry neither merges into the
    // preceding keystroke nor lets the following keystroke merge across it.
    d.undo();
    expect(d.getText()).toBe('a');
    d.undo();
    expect(d.getText()).toBe('a');
    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    d.redo();
    d.redo();
    d.redo();
    expect(d.getText()).toBe('ab');
    expect(d.canRedo).toBe(false);
  });
});

describe('applyEdits: out-of-bounds edit ranges clamp instead of throwing', () => {
  // DIVERGENCE: a stricter contract would reject a change whose start is
  // negative outright; pierre normalizes every edit position through
  // normalizePosition, so a negative character (or negative line) clamps to
  // the document start and the edit applies to the clamped range.
  test('negative coordinates clamp to the document start', () => {
    const d = doc('kelp');
    d.applyEdits([edit(0, -1, 0, 1, '')]);
    expect(d.getText()).toBe('elp'); // delete resolved as [0,1)

    const d2 = doc('ab\ncd');
    d2.applyEdits([edit(-5, -5, -5, -5, '!')]);
    expect(d2.getText()).toBe('!ab\ncd'); // insert resolved at offset 0
  });

  // DIVERGENCE: a stricter contract would reject an end of 10 on a 4-char
  // document; pierre clamps the end character to the line length, so the
  // replacement absorbs exactly the real tail of the line.
  test('an end character past the line length clamps to the line end', () => {
    const d = doc('kelp');
    d.applyEdits([edit(0, 2, 0, 10, 'x')]);
    expect(d.getText()).toBe('kex'); // range resolved as [2,4)
  });

  // DIVERGENCE: a stricter contract would throw for any position beyond the
  // document; pierre clamps the line to the last line but keeps a character
  // that is still in range on that line — an edit addressed to line 9 lands
  // mid-way through the final line, not at the document end.
  test('a line beyond EOF clamps to the last line, preserving an in-range character', () => {
    const d = doc('ab\ncd');
    d.applyEdits([edit(9, 1, 9, 1, '!')]);
    expect(d.getText()).toBe('ab\nc!d'); // resolved to (line 1, character 1)

    // Only when the character also overshoots does the edit land at doc end.
    const d2 = doc('ab\ncd');
    d2.applyEdits([edit(9, 99, 9, 99, '!')]);
    expect(d2.getText()).toBe('ab\ncd!');
  });

  // DIVERGENCE: a stricter contract would throw; pierre clamps a range end
  // whose line overshoots to (last line, in-range character), so the
  // replacement runs from the start position to that clamped point rather
  // than to EOF.
  test('a range end on a line beyond EOF clamps into the last line', () => {
    const d = doc('ab\ncd');
    d.applyEdits([edit(0, 1, 7, 7, 'Z')]);
    // End (7,7) clamps to (line 1, character 2) — the document end — so the
    // replacement covers [1, 5).
    expect(d.getText()).toBe('aZ');
  });
});

describe('line-based indent commands with selections sharing a line', () => {
  test('two carets on one line indent that line exactly once', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('quartz vein');

    try {
      editor.setState({ selections: [caret(0, 2), caret(0, 6)] });

      pressKey(window, content, { key: ']', metaKey: true });

      expect(editor.getText()).toBe('  quartz vein');
      expect(editor.getState().selections).toEqual([caret(0, 4), caret(0, 8)]);
    } finally {
      cleanup();
    }
  });

  test('two ranges sharing a line indent every line exactly once', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('ada\nberyl\ncobalt');

    try {
      editor.setState({
        selections: [range(0, 1, 1, 2), range(1, 3, 2, 1)],
      });

      pressKey(window, content, { key: ']', metaKey: true });

      expect(editor.getText()).toBe('  ada\n  beryl\n  cobalt');
    } finally {
      cleanup();
    }
  });

  test('two carets on one tab-indented line outdent it exactly once', async () => {
    const { cleanup, content, editor, window } =
      await createEditorFixture('\tquartz vein');

    try {
      editor.setState({ selections: [caret(0, 3), caret(0, 7)] });

      pressKey(window, content, { key: 'Tab', shiftKey: true });

      expect(editor.getText()).toBe('quartz vein');
      expect(editor.getState().selections).toEqual([caret(0, 2), caret(0, 6)]);
    } finally {
      cleanup();
    }
  });
});

describe('indentLess on tab and mixed indentation', () => {
  // Pierre-fe has a single tabSize knob that acts as both the tab's visual
  // width and the indent unit, and its outdent removes raw characters (one
  // whole tab, or up to tabSize leading spaces). An alternative model
  // separates tab size (4) from indent unit (2) and rewrites the leading
  // whitespace by column arithmetic. Under pierre-fe's own model each outdent
  // below removes exactly one visual unit, so this is a coherent policy
  // difference, not corruption — the residual whitespace is just never
  // normalized to spaces.

  test('outdenting a tab-indented line removes the whole tab', () => {
    // DIVERGENCE: the column-arithmetic model splits the tab ('\tone' ->
    // '  one' with a 2-space unit under a 4-column tab); pierre-fe deletes the
    // tab character itself, which at tabSize 2 is exactly one indent unit of
    // visual width.
    const d = doc('\tnode');
    const [edits, next] = resolveIndentEdits(d, caret(0, 5), 2, true);
    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        newText: '',
      },
    ]);
    d.applyEdits(edits);
    expect(d.getText()).toBe('node');
    expect(next).toEqual(caret(0, 4));
  });

  test('outdenting space-then-tab indentation trims leading spaces only', () => {
    // DIVERGENCE: the column-arithmetic model normalizes '   \tone' to
    // '  one' (column count minus one unit, re-written as spaces); pierre-fe
    // deletes tabSize leading space characters and leaves the denormalized
    // ' \t' run in place. At tabSize 2 the visual width still drops by exactly
    // one unit (4 -> 2 columns), so the indentation is not broken, merely
    // unnormalized.
    const d = doc('   \tnode');
    const [edits, next] = resolveIndentEdits(d, caret(0, 8), 2, true);
    d.applyEdits(edits);
    expect(d.getText()).toBe(' \tnode');
    expect(next).toEqual(caret(0, 6));
  });

  test('outdenting spaces before a tab leaves the tab as the full indent', () => {
    // DIVERGENCE: the column-arithmetic model rewrites '  \ttwo' to '  two';
    // pierre-fe removes the two spaces and keeps the tab ('\tpair'), which
    // again renders at one indent unit under its own tabSize-2 metrics.
    const d = doc('  \tpair');
    const [edits, next] = resolveIndentEdits(d, caret(0, 7), 2, true);
    d.applyEdits(edits);
    expect(d.getText()).toBe('\tpair');
    expect(next).toEqual(caret(0, 5));
  });
});

describe('block indent over blank and whitespace-only lines', () => {
  test('block indent and outdent leave blank lines untouched', () => {
    const original = 'alpha\n\n   \nbeta';
    const d = doc(original);
    const [indentEdits, indentedSelection] = resolveIndentEdits(
      d,
      range(0, 0, 3, 4),
      2,
      false
    );
    d.applyEdits(indentEdits);
    expect(d.getText()).toBe('  alpha\n\n   \n  beta');

    const [outdentEdits] = resolveIndentEdits(d, indentedSelection, 2, true);
    d.applyEdits(outdentEdits);
    expect(d.getText()).toBe(original);
  });

  test('single-line indent still inserts whitespace on a blank line', () => {
    const d = doc('');
    const [edits] = resolveIndentEdits(d, caret(0, 0), 2, false);
    d.applyEdits(edits);
    expect(d.getText()).toBe('  ');
  });
});

describe('move line commands with merged and same-line multi-cursor blocks', () => {
  test('interleaved ranges and a caret merge into one block moving up', () => {
    // The three selections touch lines 1-2, 3, and 3-4; the merged block is
    // lines 1-4 and must rotate above line 0 as a unit, with every selection
    // shifted up one line at its original columns.
    const d = doc('red\ngreen\nblue\ncyan\npink');
    const next = moveLines(
      d,
      [range(1, 0, 2, 2), caret(3, 2), range(3, 3, 4, 4)],
      -1
    );
    expect(d.getText()).toBe('green\nblue\ncyan\npink\nred');
    expect(next).toEqual([range(0, 0, 1, 2), caret(2, 2), range(2, 3, 3, 4)]);
  });

  test('interleaved ranges and a caret merge into one block moving down', () => {
    const d = doc('red\ngreen\nblue\ncyan\npink\ngray');
    const next = moveLines(
      d,
      [range(1, 0, 2, 2), caret(3, 2), range(3, 3, 4, 4)],
      1
    );
    expect(d.getText()).toBe('red\ngray\ngreen\nblue\ncyan\npink');
    expect(next).toEqual([range(2, 0, 3, 2), caret(4, 2), range(4, 3, 5, 4)]);
  });

  test('multiple carets on one line all survive a move down at their columns', () => {
    const d = doc('alpha\nbravo\ncharlie');
    const next = moveLines(d, [caret(1, 1), caret(1, 4)], 1);
    expect(d.getText()).toBe('alpha\ncharlie\nbravo');
    expect(next).toEqual([caret(2, 1), caret(2, 4)]);
  });

  test('multiple carets on one line all survive a move up at their columns', () => {
    const d = doc('alpha\nbravo\n');
    const next = moveLines(d, [caret(1, 1), caret(1, 3), caret(1, 5)], -1);
    expect(d.getText()).toBe('bravo\nalpha\n');
    expect(next).toEqual([caret(0, 1), caret(0, 3), caret(0, 5)]);
  });

  test('a range ending at column 0 does not drag the line below into the move', () => {
    // The selection ends at (3,0), so line 3 carries no selected content;
    // getSelectedLineBlocks must exclude it and only lines 1-2 move.
    const d = doc('ash\nbay\ncedar\ndune');
    const next = moveLines(d, [range(1, 0, 3, 0)], -1);
    expect(d.getText()).toBe('bay\ncedar\nash\ndune');
    expect(next).toEqual([range(0, 0, 2, 0)]);
  });
});

describe('Enter and indentation carry-over', () => {
  test('Enter copies the current line leading whitespace onto the new line', () => {
    const d = doc('  tune');
    const { nextSelections } = pressEnter(d, caret(0, 6));
    expect(d.getText()).toBe('  tune\n  ');
    expect(nextSelections).toEqual([caret(1, 2)]);
  });

  test('Enter on a whitespace-only line duplicates that whitespace', () => {
    // DIVERGENCE: a language-aware newline-and-indent command replaces a
    // whitespace-only line with '\n', clearing the stale indentation.
    // Pierre-fe's Enter is keep-indent semantics: expandSingleNewlineInsert
    // copies the current line's leading whitespace unconditionally, so
    // '    ' + Enter leaves '    \n    ' — trailing whitespace stays behind
    // and the indent is duplicated. Judged a policy, not a bug: nothing is
    // lost or corrupted, the result is deterministic and undoable, and
    // clearing would require a language-aware indent pass pierre-fe
    // deliberately does not run.
    const d = doc('    ');
    const { nextSelections } = pressEnter(d, caret(0, 4));
    expect(d.getText()).toBe('    \n    ');
    expect(nextSelections).toEqual([caret(1, 4)]);
  });

  test('Enter replacing a multi-line selection indents from the selection-start line', () => {
    // The replaced range spans two indented lines; the inserted break must
    // copy the indentation of the line the selection STARTS on, and the caret
    // lands between that indent and the surviving tail text.
    const d = doc('fn a:\n  leftgone\n  deadright');
    const { nextSelections } = pressEnter(d, range(1, 6, 2, 6));
    expect(d.getText()).toBe('fn a:\n  left\n  right');
    expect(nextSelections).toEqual([caret(2, 2)]);
  });

  test('Enter after an unindented line inserts a bare break', () => {
    const d = doc('onemore');
    const { nextSelections } = pressEnter(d, caret(0, 3));
    expect(d.getText()).toBe('one\nmore');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });
});
