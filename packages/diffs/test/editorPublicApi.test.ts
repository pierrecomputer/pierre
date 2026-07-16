import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import type { Marker } from '../src/editor/marker';
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

interface EditorFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
}

// Mounts a real File-backed editor, mirroring the harness the applyEdits and
// marker suites use, and returns the editor plus its contenteditable element.
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
  };
}

function insertText(
  editor: Editor<undefined>,
  line: number,
  character: number,
  text: string,
  updateHistory = true
): void {
  editor.applyEdits(
    [
      {
        range: {
          start: { line, character },
          end: { line, character },
        },
        newText: text,
      },
    ],
    updateHistory
  );
}

function markerPopover(content: HTMLElement): HTMLElement | null {
  return (content.getRootNode() as ShadowRoot).querySelector(
    '[data-marker-popover]'
  );
}

// Hovers the marker over `oneIndexedLine` by dispatching a mouseover whose
// composedPath points at that row's first tokenized span, matching the marker
// popover suite (jsdom does not report composedPath across the shadow boundary).
function hoverMarkerLine(content: HTMLElement, oneIndexedLine: number): void {
  const lineElement = Array.from(
    content.querySelectorAll<HTMLElement>('[data-line]')
  ).find((el) => el.dataset.line === String(oneIndexedLine));
  const charSpan = lineElement?.querySelector<HTMLElement>('[data-char]');
  if (charSpan == null) {
    throw new Error(`no tokenized span found on line ${oneIndexedLine}`);
  }
  const event = new Event('mouseover', { bubbles: true, composed: true });
  Object.defineProperty(event, 'composedPath', { value: () => [charSpan] });
  content.dispatchEvent(event);
}

describe('Editor state round trip', () => {
  test('setState restores selections without rebuilding the document or dropping undo history', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      insertText(editor, 1, 0, 'ZZ', true);
      expect(editor.canUndo).toBe(true);
      const editedText = editor.getText();

      editor.setSelections([
        {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          direction: 'forward',
        },
      ]);
      const state = editor.getState();

      // Move the caret elsewhere, then restore the captured state.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      editor.setState(state);

      expect(editor.getState().selections).toEqual(state.selections);
      // getState/setState carry no cacheKey, so restoring state neither rebuilds
      // the document nor discards its undo history.
      expect(editor.canUndo).toBe(true);
      expect(editor.getText()).toBe(editedText);
      editor.undo();
      expect(editor.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setOptions', () => {
  test('applies an option change after construction', async () => {
    const onChange = mock(() => {});
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo');
    try {
      // With no onChange configured, an edit notifies nobody.
      insertText(editor, 0, 5, 'X', true);
      expect(onChange).not.toHaveBeenCalled();

      // Installing onChange at runtime makes the next edit report the change.
      editor.setOptions({ onChange });
      insertText(editor, 0, 0, 'Y', true);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe('Editor focus lifecycle', () => {
  test('fires onAttach when the editor attaches to a file', async () => {
    const onAttach = mock((_editor: Editor<undefined>) => {});
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo', {
      onAttach,
    });
    try {
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttach.mock.calls[0]?.[0]).toBe(editor);
    } finally {
      cleanup();
    }
  });

  test('fires onFocus and onBlur as the content gains and loses focus', async () => {
    const onFocus = mock(() => {});
    const onBlur = mock(() => {});
    const { cleanup, content } = await createEditorFixture('alpha\nbravo', {
      onFocus,
      onBlur,
    });
    try {
      content.dispatchEvent(new Event('focus'));
      content.dispatchEvent(new Event('blur'));
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onBlur).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('blur() blurs the content element', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      const blurSpy = spyOn(content, 'blur');
      editor.blur();
      expect(blurSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('focus() without a selection focuses the content and honors preventScroll', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      editor.setSelections([]);
      const focusSpy = spyOn(content, 'focus');
      editor.focus();
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: false });
      editor.focus({ preventScroll: true });
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    } finally {
      cleanup();
    }
  });

  test('focus() with a selection defers the content focus to a frame', async () => {
    const { cleanup, content, editor } =
      await createEditorFixture('alpha\nbravo');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      const focusSpy = spyOn(content, 'focus');
      editor.focus();
      // The real focus() runs in a rAF so it does not clobber the re-anchored
      // native selection.
      expect(focusSpy).not.toHaveBeenCalled();
      await wait(0);
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: false });
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setMarkers', () => {
  test('clearing markers tears down the renderer and its popover', async () => {
    const { cleanup, editor, content } = await createEditorFixture(
      'l0\nl1\nl2\nl3\nl4\nl5'
    );
    try {
      // Clearing before any markers were set is a no-op that must not throw.
      editor.setMarkers([]);

      const markers: Marker[] = [
        {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 2 },
          severity: 'error',
          message: 'boom',
        },
      ];
      editor.setMarkers(markers);
      hoverMarkerLine(content, 4);
      await wait(350);
      expect(markerPopover(content)).not.toBeNull();

      // Clearing markers disposes the renderer and removes its popover.
      editor.setMarkers([]);
      expect(markerPopover(content)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('Editor history option plumbing', () => {
  test('caps the undo history at historyMaxEntries', async () => {
    const { cleanup, editor } = await createEditorFixture('abcdef', {
      historyMaxEntries: 2,
    });
    try {
      // Three replacements, none of which coalesce, push three undo entries.
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            newText: 'X',
          },
        ],
        true
      );
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 2 },
            },
            newText: 'Y',
          },
        ],
        true
      );
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 3 },
            },
            newText: 'Z',
          },
        ],
        true
      );
      expect(editor.getText()).toBe('XYZdef');

      // The cap keeps only the two most recent entries, so the oldest edit can
      // no longer be undone.
      editor.undo();
      editor.undo();
      expect(editor.canUndo).toBe(false);
      expect(editor.getText()).toBe('Xbcdef');
    } finally {
      cleanup();
    }
  });
});
