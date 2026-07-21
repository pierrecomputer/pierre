import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import {
  Editor,
  type EditorFocusOptions,
  type EditorOptions,
} from '../src/editor/editor';
import type { Marker } from '../src/editor/marker';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { DiffsEditableComponent, FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = Array.from(
      container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ??
        []
    ).find(
      (element) =>
        element.contentEditable === 'true' ||
        element.getAttribute('contenteditable') === 'true'
    );
    if (content != null) {
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
  file: File<undefined>;
}

interface DiffEditorFixture {
  cleanup(): void;
  container: HTMLElement;
  content: HTMLElement;
  editor: Editor<undefined>;
  fileDiff: FileDiff<undefined>;
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
    file,
  };
}

async function createDiffEditorFixture(
  diffStyle: 'split' | 'unified'
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    diffStyle,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  fileDiff.render({
    oldFile: { name: 'edits.ts', contents: 'alpha\nold\ncharlie' },
    newFile: { name: 'edits.ts', contents: 'alpha\nnew\ncharlie' },
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(fileDiff);

  const content = await waitForEditableContent(container);
  return {
    cleanup() {
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
    container,
    content,
    editor,
    fileDiff,
  };
}

function setEditorViewport(
  file: DiffsEditableComponent<undefined>,
  viewport: HTMLElement | Document
): void {
  file.getEditorViewport = () => viewport;
}

function setRect(element: Element, top: number, bottom: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        bottom,
        height: bottom - top,
        left: 0,
        right: 100,
        top,
        width: 100,
        x: 0,
        y: top,
        toJSON() {
          return {};
        },
      }) as DOMRect,
  });
}

function getLineRows(content: HTMLElement): HTMLElement[] {
  return Array.from(content.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.line != null
  );
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
    let onAttachCompleted = false;
    const onAttach = mock(
      (
        attachedEditor: Editor<undefined>,
        _file: DiffsEditableComponent<undefined>
      ) => {
        attachedEditor.setMarkers([]);
        onAttachCompleted = true;
      }
    );
    const { cleanup, editor, file } = await createEditorFixture(
      'alpha\nbravo',
      { onAttach }
    );
    try {
      await wait(0);
      expect(onAttach).toHaveBeenCalledTimes(1);
      expect(onAttachCompleted).toBe(true);
      expect(onAttach.mock.calls[0]?.[0]).toBe(editor);
      expect(onAttach.mock.calls[0]?.[1]).toBe(file);
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

  test('focus() targets and normalizes a one-based document line', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const firstTarget: EditorFocusOptions = {
        lineNumber: 2,
        preventScroll: true,
      };
      editor.focus(firstTarget);
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 0,
        },
      ]);

      editor.focus({ lineNumber: 99, character: 99, preventScroll: true });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 2, character: 7 },
          end: { line: 2, character: 7 },
          direction: 0,
        },
      ]);

      editor.focus({
        lineNumber: Number.NaN,
        character: Number.NaN,
        preventScroll: true,
      });
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('targeted focus honors preventScroll', async () => {
    const { cleanup, editor } = await createEditorFixture('alpha\nbravo');
    const scrollIntoView = spyOn(HTMLElement.prototype, 'scrollIntoView');
    try {
      editor.focus({ lineNumber: 2, preventScroll: true });
      expect(scrollIntoView).not.toHaveBeenCalled();

      editor.focus({ lineNumber: 1 });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      scrollIntoView.mockRestore();
      cleanup();
    }
  });

  test('targeted focus before attachment is a no-op', () => {
    const editor = new Editor<undefined>();
    try {
      editor.focus({ lineNumber: 2 });
      expect(editor.getState().selections).toBeUndefined();
    } finally {
      editor.cleanUp();
    }
  });

  test('first-visible focus targets the first row whose top is in an element viewport', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 10, 50);

      const rows = getLineRows(content);
      setRect(rows[0], 0, 20);
      setRect(rows[1], 40, 60);
      setRect(rows[2], 60, 80);

      editor.focus({
        lineNumber: 'first-visible',
        character: 4,
        preventScroll: true,
      });
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

  test('first-visible focus uses document viewport bounds', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      setEditorViewport(file, document);
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 50,
      });

      const rows = getLineRows(content);
      setRect(rows[0], -1, 19);
      setRect(rows[1], 19, 39);
      setRect(rows[2], 39, 59);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start).toEqual({
        line: 1,
        character: 0,
      });
    } finally {
      cleanup();
    }
  });

  test('first-visible focus applies a top offset after sticky headers', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 0, 60);

      const shadowRoot = content.getRootNode() as ShadowRoot;
      const header = document.createElement('div');
      header.dataset.diffsHeader = 'file';
      header.dataset.sticky = '';
      setRect(header, 0, 20);
      shadowRoot.prepend(header);

      for (const lineType of [
        'annotation',
        'separator',
        'buffer',
        'change-deletion',
      ]) {
        const row = document.createElement('div');
        row.dataset.line = '99';
        row.dataset.lineType = lineType;
        setRect(row, 35, 40);
        content.prepend(row);
      }

      const rows = getLineRows(content).filter(
        (row) => row.dataset.line !== '99'
      );
      setRect(rows[0], 10, 20);
      setRect(rows[1], 25, 35);
      setRect(rows[2], 35, 45);

      editor.focus({
        lineNumber: 'first-visible',
        preventScroll: true,
        offset: 10,
      });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus preserves focus and selection without a visible row top', async () => {
    const { cleanup, content, editor, file } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.focus({ lineNumber: 2, preventScroll: true });
      await wait(0);
      const selections = editor.getState().selections;
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections).toEqual(selections);
      expect(document.activeElement).toBe(button);

      const viewport = document.createElement('div');
      setEditorViewport(file, viewport);
      setRect(viewport, 0, 10);
      const rows = getLineRows(content);
      setRect(rows[0], -5, 5);
      setRect(rows[1], 10, 20);
      setRect(rows[2], 15, 25);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections).toEqual(selections);
      expect(document.activeElement).toBe(button);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus skips unified deletion rows', async () => {
    const { cleanup, content, editor, fileDiff } =
      await createDiffEditorFixture('unified');
    try {
      const viewport = document.createElement('div');
      setEditorViewport(fileDiff, viewport);
      setRect(viewport, 0, 60);

      const rows = getLineRows(content);
      for (const row of rows) {
        setRect(row, 100, 120);
      }
      const deletion = rows.find(
        (row) => row.dataset.lineType === 'change-deletion'
      );
      const addition = rows.find(
        (row) => row.dataset.lineType === 'change-addition'
      );
      const trailingContext = rows.find(
        (row) => row.dataset.line === '3' && row.dataset.lineType === 'context'
      );
      expect(deletion).toBeDefined();
      expect(addition).toBeDefined();
      expect(trailingContext).toBeDefined();
      setRect(deletion!, 10, 30);
      setRect(addition!, -5, 15);
      setRect(trailingContext!, 30, 50);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('first-visible focus scans the additions column in split diffs', async () => {
    const { cleanup, container, content, editor, fileDiff } =
      await createDiffEditorFixture('split');
    try {
      const viewport = document.createElement('div');
      setEditorViewport(fileDiff, viewport);
      setRect(viewport, 0, 60);

      const deletionContent = container.shadowRoot?.querySelector<HTMLElement>(
        '[data-code][data-deletions] [data-content]'
      );
      expect(deletionContent).toBeDefined();
      for (const row of getLineRows(deletionContent!)) {
        setRect(row, 10, 30);
      }

      const additionRows = getLineRows(content);
      for (const row of additionRows) {
        setRect(row, 100, 120);
      }
      const target = additionRows.find(
        (row) => row.dataset.line === '3' && row.dataset.lineType === 'context'
      );
      expect(target).toBeDefined();
      setRect(target!, 30, 50);

      editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      expect(editor.getState().selections?.[0]?.start.line).toBe(2);
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
