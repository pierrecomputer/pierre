import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

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
  window: EditorTestWindow;
}

async function createEditorFixture(
  contents: string,
  editorOptions?: EditorOptions<undefined>
): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>(editorOptions);
  const initialFile: FileContents = { name: 'edits.ts', contents };

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

describe('Editor.applyEdits selection sync', () => {
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

      expect(editor.getState().file.contents).toBe(
        'NEW\nalpha\nbravo\ncharlie'
      );
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

      expect(editor.getState().file.contents).toBe('alXYZpha\nbravo');
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

      expect(editor.getState().file.contents).toBe(
        'alpha\nbravo\nNEW\ncharlie'
      );
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

  test('restores the remapped caret on redo when history is updated', async () => {
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
        true
      );

      pressUndoRedo(window, content, false);
      expect(editor.getState().file.contents).toBe('alpha\nbravo\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 0,
        },
      ]);

      pressUndoRedo(window, content, true);
      expect(editor.getState().file.contents).toBe(
        'NEW\nalpha\nbravo\ncharlie'
      );
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
      expect(editor.getState().file.contents).toBe('bravo\nalpha\ncharlie');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 0,
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(editor.getState().file.contents).toBe('alpha\nbravo\ncharlie');
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
      expect(editor.getState().file.contents).toBe('alpha\ncharlie\nbravo');
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
      expect(editor.getState().file.contents).toBe(
        'zero\nfour\none\ntwo\nthree'
      );
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
      expect(editor.getState().file.contents).toBe('alpha\ncharlie\nbravo');
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
      expect(editor.getState().file.contents).toBe('b\na\nc\ne\nd\nf');
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

      expect(editor.getState().file.contents).toBe('alpha!');
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
      expect(editor.getState().file.contents).toBe('alpha!');

      editor.undo();
      expect(editor.getState().file.contents).toBe('alpha');
      expect(editor.canUndo).toBe(false);
      expect(editor.canRedo).toBe(true);

      editor.redo();
      expect(editor.getState().file.contents).toBe('alpha!');
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

      expect(editor.getState().file.contents).toBe('alpha');
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
      const keyboardResult = editor.getState().file.contents;

      pressUndoRedo(window, content, true);
      expect(editor.getState().file.contents).toBe('Xalpha');

      editor.undo();
      expect(editor.getState().file.contents).toBe(keyboardResult);
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
