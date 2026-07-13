import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Edit, type EditOptions } from '../src/edit/edit';
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

interface EditTestWindow extends Window {
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
  PointerEvent: {
    new (type: string, eventInitDict?: PointerEventInit): PointerEvent;
  };
}

interface EditFixture {
  cleanup(): void;
  content: HTMLElement;
  edit: Edit<undefined>;
  file: File<undefined>;
  fileContainer: HTMLElement;
  fileContents: FileContents;
  window: EditTestWindow;
}

async function createEditFixture(
  contents: string,
  editorOptions?: EditOptions<undefined>,
  fileOptions?: Partial<FileOptions<undefined>>,
  fileContents?: Partial<FileContents>
): Promise<EditFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    ...fileOptions,
  });
  const edit = new Edit<undefined>(editorOptions);
  const initialFile: FileContents = {
    name: 'edits.ts',
    contents,
    ...fileContents,
  };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  edit.edit(file);

  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      edit.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    edit,
    file,
    fileContainer,
    fileContents: initialFile,
    window: dom.window as unknown as EditTestWindow,
  };
}

// Drives edit mode's undo/redo keyboard shortcut. The harness navigator
// reports macOS, so the primary modifier is the meta key; `shift` selects redo.
function pressUndoRedo(
  window: EditTestWindow,
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
  window: EditTestWindow,
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
  window: EditTestWindow,
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

describe('Edit.applyEdits selection sync', () => {
  test('keeps inserted file lines coherent when switching files', async () => {
    const { cleanup, edit, file, fileContainer, fileContents } =
      await createEditFixture('alpha\nbravo\n', undefined, {
        disableErrorHandling: true,
      });

    try {
      edit.applyEdits([
        {
          range: {
            start: { line: 1, character: 5 },
            end: { line: 1, character: 5 },
          },
          newText: '\ncharlie',
        },
      ]);

      expect(edit.getText()).toBe('alpha\nbravo\ncharlie\n');

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
      expect(edit.getText()).toBe('alpha\nbravo\ncharlie\n');
    } finally {
      cleanup();
    }
  });

  test('shifts the caret down when an edit inserts lines above it', async () => {
    const { cleanup, edit } = await createEditFixture('alpha\nbravo\ncharlie');

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(edit.getText()).toBe('NEW\nalpha\nbravo\ncharlie');
      // The caret was inside "charlie"; inserting a line above must move it down
      // one line so it still points at the same character of "charlie".
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, edit } = await createEditFixture('alpha\nbravo');

    try {
      edit.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: 'XYZ',
        },
      ]);

      expect(edit.getText()).toBe('alXYZpha\nbravo');
      // The caret must follow the inserted text so the next keystroke lands
      // after it, not in front of it.
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, edit } = await createEditFixture('alpha\nbravo\ncharlie');

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          direction: 'forward',
        },
      ]);

      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(edit.getState().selections).toEqual([
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
    const { cleanup, edit } = await createEditFixture('alpha\nbravo\ncharlie');

    try {
      edit.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      edit.applyEdits([
        {
          range: {
            start: { line: 2, character: 0 },
            end: { line: 2, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(edit.getText()).toBe('alpha\nbravo\nNEW\ncharlie');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      edit.applyEdits(
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
      expect(edit.getText()).toBe('alpha\nbravo\ncharlie');
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 0,
        },
      ]);

      pressUndoRedo(window, content, true);
      expect(edit.getText()).toBe('NEW\nalpha\nbravo\ncharlie');
      // Redo must restore the caret to the post-edit (remapped) position, not
      // leave it where undo placed it.
      expect(edit.getState().selections).toEqual([
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

  test('does not steal focus when edit mode is not focused', async () => {
    const { cleanup, content, edit } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // The edit tracks focus via focus/blur on the content element. Focus
      // first so edit mode is genuinely focused, then blur to mimic the user
      // moving to another input on the page. The focus is required: edit mode
      // starts unfocused, so without it the blur would be a no-op and the test
      // would pass even if the blur handler stopped clearing focus.
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));

      const focusSpy = spyOn(edit, 'focus');
      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      // Selection state is still remapped so it stays correct...
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 3, character: 3 },
          end: { line: 3, character: 3 },
          direction: 0,
        },
      ]);
      // ...but edit mode must not pull focus back to itself.
      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
    } finally {
      cleanup();
    }
  });

  test('repositions focus when edit mode is already focused', async () => {
    const { cleanup, content, edit } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // Mark edit mode as focused the same way a real focus would.
      content.dispatchEvent(new Event('focus'));

      const focusSpy = spyOn(edit, 'focus');
      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(edit.getState().selections).toEqual([
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
    const { cleanup, edit } = await createEditFixture('alpha\nbravo\ncharlie');

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);
      // focus() queues the real contentElement.focus() in a rAF, so the focus
      // event has not fired yet. A same-tick applyEdits (the common
      // set-selection-then-edit flow) must still treat edit mode as focused and
      // reposition, rather than skip and leave the native selection stale while
      // the queued focus lands afterward.
      edit.focus();

      const focusSpy = spyOn(edit, 'focus');
      edit.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'NEW\n',
        },
      ]);

      expect(edit.getState().selections).toEqual([
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

  test('ignores a selectionchange while edit mode is unfocused', async () => {
    const { cleanup, content, edit } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );
    // Spying on the shared global document/window getSelection, so restore in
    // finally to avoid leaking the stubs into later tests.
    let getSelectionStub: { mockRestore(): void } | undefined;
    let windowSelectionStub: { mockRestore(): void } | undefined;

    try {
      edit.setSelections([
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
      // The focus events below also drive edit mode's native-selection re-sync
      // (window.getSelection().setBaseAndExtent), so stub that to a no-op rather
      // than let jsdom's partial Selection throw.
      windowSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
        setBaseAndExtent: () => {},
      } as unknown as Selection);

      // Unfocused: a selectionchange whose range still belongs to edit mode
      // must not overwrite the remapped caret before the user returns.
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('selectionchange'));
      expect(edit.getState().selections).toEqual([
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
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );
    // Stub the native Selection so the re-sync is observable and so jsdom's
    // partial setBaseAndExtent does not throw during setup focus frames.
    const setBaseAndExtent = mock(() => {});
    const getSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
      setBaseAndExtent,
    } as unknown as Selection);

    try {
      edit.setSelections([
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
      // edit must re-assert the remapped selection onto the native Selection,
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
      edit,
      window: testWindow,
    } = await createEditFixture('alpha\nbravo\ncharlie');
    const setBaseAndExtent = mock(() => {});
    const getSelectionStub = spyOn(window, 'getSelection').mockReturnValue({
      setBaseAndExtent,
    } as unknown as Selection);

    try {
      edit.setSelections([
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

      // The edit must defer to the click's own caret, not re-assert the stale
      // remapped selection over it.
      content.dispatchEvent(new Event('focus'));
      expect(setBaseAndExtent).not.toHaveBeenCalled();
    } finally {
      getSelectionStub.mockRestore();
      cleanup();
    }
  });
});

describe('Edit move line commands', () => {
  test('moves the current line up and down', async () => {
    const { cleanup, content, edit, window } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ]);

      pressMoveLine(window, content, 'up');
      expect(edit.getText()).toBe('bravo\nalpha\ncharlie');
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 0,
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(edit.getText()).toBe('alpha\nbravo\ncharlie');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 3 },
          direction: 'none',
        },
      ]);

      pressMoveLine(window, content, 'up');
      expect(edit.getText()).toBe('alpha\ncharlie\nbravo');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } = await createEditFixture(
      'zero\none\ntwo\nthree\nfour'
    );

    try {
      edit.setSelections([
        {
          start: { line: 1, character: 1 },
          end: { line: 3, character: 2 },
          direction: 'forward',
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(edit.getText()).toBe('zero\nfour\none\ntwo\nthree');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
          direction: 'forward',
        },
      ]);

      pressMoveLine(window, content, 'down');
      expect(edit.getText()).toBe('alpha\ncharlie\nbravo');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } =
      await createEditFixture('a\nb\nc\nd\ne\nf');

    try {
      edit.setSelections([
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
      expect(edit.getText()).toBe('b\na\nc\ne\nd\nf');
      expect(edit.getState().selections).toEqual([
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

describe('Edit editing commands', () => {
  test('copies selected lines and keeps the requested copy selected', async () => {
    const { cleanup, content, edit, window } = await createEditFixture(
      'alpha\nbravo\ncharlie'
    );

    try {
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha\nbravo\nbravo\ncharlie');
      expect(edit.getState().selections?.[0].start).toEqual({
        line: 1,
        character: 2,
      });

      pressKey(window, content, {
        key: 'ArrowDown',
        altKey: true,
        shiftKey: true,
      });
      expect(edit.getText()).toBe('alpha\nbravo\nbravo\nbravo\ncharlie');
      expect(edit.getState().selections?.[0].start).toEqual({
        line: 2,
        character: 2,
      });
    } finally {
      cleanup();
    }
  });

  test('simplifies to the primary range before collapsing it', async () => {
    const { cleanup, content, edit, window } =
      await createEditFixture('alpha\nbravo');

    try {
      edit.setSelections([
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
      expect(edit.getState().selections).toEqual([
        {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 4 },
          direction: 1,
        },
      ]);

      pressKey(window, content, { key: 'Escape' });
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } =
      await createEditFixture('zero\n  one\ntwo');

    try {
      edit.setSelections([
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

      expect(edit.getText()).toBe('zero\n\n  one\n  \ntwo');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } =
      await createEditFixture('zero\n  one\ntwo');

    try {
      edit.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 1, character: 3 },
          direction: 'backward',
        },
      ]);

      pressKey(window, content, { key: 'Enter', metaKey: true });

      expect(edit.getText()).toBe('zero\n\n  one\ntwo');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } = await createEditFixture('alpha');

    try {
      edit.setSelections([
        {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 3 },
          direction: 'none',
        },
      ]);

      pressKey(window, content, { key: ']', metaKey: true });
      expect(edit.getText()).toBe('  alpha');
      expect(edit.getState().selections?.[0].start.character).toBe(5);

      pressKey(window, content, { key: '[', metaKey: true });
      expect(edit.getText()).toBe('alpha');
      expect(edit.getState().selections?.[0].start.character).toBe(3);
    } finally {
      cleanup();
    }
  });

  test('toggles default and SQL line comments', async () => {
    const typescriptFixture = await createEditFixture('  const value = 1;');
    try {
      typescriptFixture.edit.setSelections([
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
      expect(typescriptFixture.edit.getText()).toBe('  // const value = 1;');
      pressKey(typescriptFixture.window, typescriptFixture.content, {
        key: '/',
        metaKey: true,
      });
      expect(typescriptFixture.edit.getText()).toBe('  const value = 1;');
    } finally {
      typescriptFixture.cleanup();
    }

    const sqlFixture = await createEditFixture(
      'select * from users;',
      undefined,
      undefined,
      { name: 'query.sql' }
    );
    try {
      sqlFixture.edit.setSelections([
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
      expect(sqlFixture.edit.getText()).toBe('-- select * from users;');
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
      const fixture = await createEditFixture(contents, undefined, undefined, {
        name,
      });
      try {
        fixture.edit.setSelections(
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
        expect(fixture.edit.getText()).toBe(commented);

        pressKey(fixture.window, fixture.content, {
          key: '/',
          metaKey: true,
        });
        expect(fixture.edit.getText()).toBe(contents);
      } finally {
        fixture.cleanup();
      }
    }
  });

  test('toggles block comments while preserving the selected content', async () => {
    const { cleanup, content, edit, window } =
      await createEditFixture('alpha beta');

    try {
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha /* beta */');
      expect(edit.getState().selections).toEqual([
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
      expect(edit.getText()).toBe('alpha beta');
      expect(edit.getState().selections).toEqual([
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
    const { cleanup, content, edit, window } =
      await createEditFixture('alpha ');

    try {
      edit.setSelections([
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
      expect(edit.getText()).toBe('alpha /*  */');
      expect(edit.getState().selections?.[0].start.character).toBe(9);

      pressKey(window, content, {
        key: 'A',
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
      });
      expect(edit.getText()).toBe('alpha ');
      expect(edit.getState().selections?.[0].start.character).toBe(6);
    } finally {
      cleanup();
    }
  });
});

describe('Edit undo/redo API', () => {
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
    const { cleanup, edit } = await createEditFixture('alpha');

    try {
      expect(edit.canUndo).toBe(false);
      expect(edit.canRedo).toBe(false);

      edit.applyEdits(insertBang, true);

      expect(edit.getText()).toBe('alpha!');
      expect(edit.canUndo).toBe(true);
      expect(edit.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('undo reverts the last edit and redo re-applies it', async () => {
    const { cleanup, edit } = await createEditFixture('alpha');

    try {
      edit.applyEdits(insertBang, true);
      expect(edit.getText()).toBe('alpha!');

      edit.undo();
      expect(edit.getText()).toBe('alpha');
      expect(edit.canUndo).toBe(false);
      expect(edit.canRedo).toBe(true);

      edit.redo();
      expect(edit.getText()).toBe('alpha!');
      expect(edit.canUndo).toBe(true);
      expect(edit.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('undo and redo do nothing when there is no history', async () => {
    const { cleanup, edit } = await createEditFixture('alpha');

    try {
      edit.undo();
      edit.redo();

      expect(edit.getText()).toBe('alpha');
      expect(edit.canUndo).toBe(false);
      expect(edit.canRedo).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('programmatic undo matches the keyboard undo result', async () => {
    const { cleanup, content, edit, window } = await createEditFixture('alpha');

    try {
      const edits = [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'X',
        },
      ];

      edit.applyEdits(edits, true);
      pressUndoRedo(window, content, false);
      const keyboardResult = edit.getText();

      pressUndoRedo(window, content, true);
      expect(edit.getText()).toBe('Xalpha');

      edit.undo();
      expect(edit.getText()).toBe(keyboardResult);
    } finally {
      cleanup();
    }
  });

  test('undo notifies the onChange callback', async () => {
    let changeCount = 0;
    const { cleanup, edit } = await createEditFixture('alpha', {
      onChange() {
        changeCount++;
      },
    });

    try {
      edit.applyEdits(insertBang, true);
      const countAfterEdit = changeCount;

      edit.undo();

      // Undo runs through the same change path as an edit, so consumers are
      // notified and can re-read canUndo/canRedo to update their UI.
      expect(changeCount).toBe(countAfterEdit + 1);
    } finally {
      cleanup();
    }
  });
});
