import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
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
}

interface EditorFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  window: EditorTestWindow;
}

async function createEditorFixture(contents: string): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
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
});
