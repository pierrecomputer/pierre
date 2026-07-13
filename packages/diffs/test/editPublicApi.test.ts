import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Edit, type EditOptions } from '../src/edit/edit';
import type { Marker } from '../src/edit/marker';
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

interface EditFixture {
  cleanup(): void;
  content: HTMLElement;
  edit: Edit<undefined>;
}

// Mounts a real File-backed edit, mirroring the harness the applyEdits and
// marker suites use, and returns the edit plus its contenteditable element.
async function createEditFixture(
  contents: string,
  editorOptions?: EditOptions<undefined>
): Promise<EditFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const edit = new Edit<undefined>(editorOptions);
  const initialFile: FileContents = { name: 'edits.ts', contents };

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
  };
}

function insertText(
  edit: Edit<undefined>,
  line: number,
  character: number,
  text: string,
  updateHistory = false
): void {
  edit.applyEdits(
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

function markerPopup(content: HTMLElement): HTMLElement | null {
  return (content.getRootNode() as ShadowRoot).querySelector(
    '[data-marker-popup]'
  );
}

// Hovers the marker over `oneIndexedLine` by dispatching a mouseover whose
// composedPath points at that row's first tokenized span, matching the marker
// popup suite (jsdom does not report composedPath across the shadow boundary).
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

describe('Edit state round trip', () => {
  test('setState restores selections without rebuilding the document or dropping undo history', async () => {
    const { cleanup, edit } = await createEditFixture('alpha\nbravo\ncharlie');
    try {
      edit.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      insertText(edit, 1, 0, 'ZZ', true);
      expect(edit.canUndo).toBe(true);
      const editedText = edit.getText();

      edit.setSelections([
        {
          start: { line: 2, character: 1 },
          end: { line: 2, character: 4 },
          direction: 'forward',
        },
      ]);
      const state = edit.getState();

      // Move the caret elsewhere, then restore the captured state.
      edit.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      edit.setState(state);

      expect(edit.getState().selections).toEqual(state.selections);
      // getState/setState carry no cacheKey, so restoring state neither rebuilds
      // the document nor discards its undo history.
      expect(edit.canUndo).toBe(true);
      expect(edit.getText()).toBe(editedText);
      edit.undo();
      expect(edit.getText()).toBe('alpha\nbravo\ncharlie');
    } finally {
      cleanup();
    }
  });
});

describe('Edit.setOptions', () => {
  test('applies an option change after construction', async () => {
    const onChange = mock(() => {});
    const { cleanup, edit } = await createEditFixture('alpha\nbravo');
    try {
      // With no onChange configured, an edit notifies nobody.
      insertText(edit, 0, 5, 'X', true);
      expect(onChange).not.toHaveBeenCalled();

      // Installing onChange at runtime makes the next edit report the change.
      edit.setOptions({ onChange });
      insertText(edit, 0, 0, 'Y', true);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe('Edit focus lifecycle', () => {
  test('fires onAttach when the edit attaches to a file', async () => {
    const onAttach = mock((_editor: Edit<undefined>) => {});
    const { cleanup, edit } = await createEditFixture('alpha\nbravo', {
      onAttach,
    });
    try {
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttach.mock.calls[0]?.[0]).toBe(edit);
    } finally {
      cleanup();
    }
  });

  test('fires onFocus and onBlur as the content gains and loses focus', async () => {
    const onFocus = mock(() => {});
    const onBlur = mock(() => {});
    const { cleanup, content } = await createEditFixture('alpha\nbravo', {
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
    const { cleanup, content, edit } = await createEditFixture('alpha\nbravo');
    try {
      const blurSpy = spyOn(content, 'blur');
      edit.blur();
      expect(blurSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  test('focus() without a selection focuses the content and honors preventScroll', async () => {
    const { cleanup, content, edit } = await createEditFixture('alpha\nbravo');
    try {
      edit.setSelections([]);
      const focusSpy = spyOn(content, 'focus');
      edit.focus();
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: false });
      edit.focus({ preventScroll: true });
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true });
    } finally {
      cleanup();
    }
  });

  test('focus() with a selection defers the content focus to a frame', async () => {
    const { cleanup, content, edit } = await createEditFixture('alpha\nbravo');
    try {
      edit.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      const focusSpy = spyOn(content, 'focus');
      edit.focus();
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

describe('Edit.setMarkers', () => {
  test('clearing markers tears down the renderer and its popup', async () => {
    const { cleanup, edit, content } = await createEditFixture(
      'l0\nl1\nl2\nl3\nl4\nl5'
    );
    try {
      // Clearing before any markers were set is a no-op that must not throw.
      edit.setMarkers([]);

      const markers: Marker[] = [
        {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 2 },
          severity: 'error',
          message: 'boom',
        },
      ];
      edit.setMarkers(markers);
      hoverMarkerLine(content, 4);
      await wait(350);
      expect(markerPopup(content)).not.toBeNull();

      // Clearing markers disposes the renderer and removes its popup.
      edit.setMarkers([]);
      expect(markerPopup(content)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('Edit history option plumbing', () => {
  test('caps the undo history at historyMaxEntries', async () => {
    const { cleanup, edit } = await createEditFixture('abcdef', {
      historyMaxEntries: 2,
    });
    try {
      // Three replacements, none of which coalesce, push three undo entries.
      edit.applyEdits(
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
      edit.applyEdits(
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
      edit.applyEdits(
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
      expect(edit.getText()).toBe('XYZdef');

      // The cap keeps only the two most recent entries, so the oldest edit can
      // no longer be undone.
      edit.undo();
      edit.undo();
      expect(edit.canUndo).toBe(false);
      expect(edit.getText()).toBe('Xbcdef');
    } finally {
      cleanup();
    }
  });
});
