import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import type { EditorKeymap } from '../src/editor/command';
import { Editor } from '../src/editor/editor';
import { DirectionForward, DirectionNone } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { clearRenderQueue } from '../src/managers/UniversalRenderingManager';
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
  editor: Editor<'file', undefined>;
  file: File<undefined>;
  fileContainer: HTMLElement;
  window: EditorTestWindow;
}

interface EditorTestWindow extends Window {
  CompositionEvent: {
    new (type: string, eventInitDict?: CompositionEventInit): CompositionEvent;
  };
  InputEvent: {
    new (type: string, eventInitDict?: InputEventInit): InputEvent;
  };
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
}

type EditableSelection = Parameters<
  Editor<'file', undefined>['setSelections']
>[0][number];

interface CreateEditorFixtureOptions {
  contents?: string;
  keymap?: EditorKeymap;
  platform?: string;
  selections?: EditableSelection[];
}

async function createEditorFixture(
  options: CreateEditorFixtureOptions = {}
): Promise<EditorFixture> {
  const {
    contents = 'line 1',
    keymap,
    platform = 'MacIntel',
    selections,
  } = options;
  const dom = installDom({ navigator: { platform } });
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    useTokenTransformer: true,
  });
  const initialFile: FileContents = {
    name: 'editor.ts',
    contents,
  };
  const editor = new Editor('file', { keymap });

  file.render({
    file: initialFile,
    fileContainer,
    forceRender: true,
  });
  editor.edit(file);

  const content = await waitForEditableContent(fileContainer);
  editor.setSelections(
    selections ?? [
      {
        start: { line: 0, character: initialFile.contents.length },
        end: { line: 0, character: initialFile.contents.length },
        direction: 'none',
      },
    ]
  );

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
    window: dom.window as unknown as EditorTestWindow,
  };
}

function dispatchKeydown(
  window: EditorTestWindow,
  target: HTMLElement,
  init: KeyboardEventInit
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchBackspace(
  window: EditorTestWindow,
  target: HTMLElement
): InputEvent {
  const event = new window.InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'deleteContentBackward',
    data: null,
  });
  target.dispatchEvent(event);
  return event;
}

async function openSearchReplacePanel({
  content,
  window,
}: Pick<EditorFixture, 'content' | 'window'>): Promise<HTMLElement> {
  dispatchKeydown(window, content, {
    key: 'f',
    code: 'KeyF',
    metaKey: true,
    altKey: true,
  });
  await wait(0);

  const panel = (
    content.getRootNode() as ParentNode
  ).querySelector<HTMLElement>('[data-search-panel]');
  if (panel == null) {
    throw new Error('search replace panel did not open');
  }
  return panel;
}

function findReplaceInput(panel: HTMLElement): HTMLInputElement {
  const input = panel.shadowRoot?.querySelector<HTMLInputElement>(
    'input[data-replace]'
  );
  if (input == null) {
    throw new Error('replace input was not rendered');
  }
  return input;
}

function findSearchInput(panel: HTMLElement): HTMLInputElement {
  const input =
    panel.shadowRoot?.querySelector<HTMLInputElement>('input[data-search]');
  if (input == null) {
    throw new Error('search input was not rendered');
  }
  return input;
}

function updateInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

interface ControlledFrames {
  // Runs every animation frame queued so far, in order, as one render pass.
  frame(): void;
  restore(): void;
}

// Replaces requestAnimationFrame with a manual queue so tests decide when the
// editor's deferred focus and settle frames run. Drops anything the fixture
// already queued so the test starts from an empty render queue.
function installControlledFrames(): ControlledFrames {
  clearRenderQueue();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const raf = spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
    (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }
  );
  const cancel = spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(
    (id) => {
      frames.delete(id);
    }
  );
  return {
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    },
    restore() {
      clearRenderQueue();
      raf.mockRestore();
      cancel.mockRestore();
    },
  };
}

// Makes the next selectionchange report a collapsed native caret inside the
// first rendered line's text, `character` code units in. The line is
// flattened to a single text node so the offset maps directly to a column.
function reportNativeCaret(content: HTMLElement, character: number): void {
  const row = content.querySelector<HTMLElement>('[data-line="1"]')!;
  row.replaceChildren(row.textContent ?? '');
  const node = row.firstChild!;
  const selection = document.getSelection()!;
  Object.defineProperty(selection, 'getComposedRanges', {
    configurable: true,
    value: () => [
      {
        collapsed: true,
        startContainer: node,
        startOffset: character,
        endContainer: node,
        endOffset: character,
      },
    ],
  });
  document.dispatchEvent(new Event('selectionchange'));
}

function caretAt(character: number): EditableSelection {
  return {
    start: { line: 0, character },
    end: { line: 0, character },
    direction: 'none',
  };
}

describe('Editor composition input', () => {
  test('keeps the insertion position when deferred focus settles during the next composition', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: '앞뒤',
      selections: [caretAt(1)],
    });
    const { frame, restore } = installControlledFrames();
    const composition = (type: string, data = '') =>
      content.dispatchEvent(
        new window.CompositionEvent(type, {
          bubbles: true,
          composed: true,
          data,
        })
      );

    try {
      content.focus();
      editor.focus();
      frame();
      frame();
      composition('compositionstart');
      composition('compositionend', '가');
      composition('compositionstart');
      frame();
      frame();

      // The browser shows the unfinished syllable in the row before it exists
      // in the model, and reports the native caret after it.
      const row = content.querySelector<HTMLElement>('[data-line="1"]')!;
      row.textContent = '앞가ㄴ뒤';
      reportNativeCaret(content, 3);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 2,
      });
      composition('compositionend', '나');

      expect(editor.getText()).toBe('앞가나뒤');
    } finally {
      restore();
      cleanup();
    }
  });

  test('ending a composition does not release a pending focus request', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'abcdef',
      selections: [caretAt(3)],
    });
    const { frame, restore } = installControlledFrames();
    const composition = (type: string, data = '') =>
      content.dispatchEvent(
        new window.CompositionEvent(type, {
          bubbles: true,
          composed: true,
          data,
        })
      );

    try {
      // Queue a caret placement, then cancel a composition before its focus
      // frame has run. The browser's stale caret must stay ignored until the
      // placement settles.
      editor.setSelections([caretAt(3)]);
      composition('compositionstart');
      composition('compositionend', '');
      expect(content.hasAttribute('data-composing')).toBe(false);
      reportNativeCaret(content, 0);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 3,
      });

      frame();
      frame();
      reportNativeCaret(content, 0);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 0,
      });
    } finally {
      restore();
      cleanup();
    }
  });

  test('lets the browser own IME preview before committing composition text', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture();
    const consoleWarn = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      content.dispatchEvent(
        new window.CompositionEvent('compositionstart', {
          bubbles: true,
          composed: true,
        })
      );

      const preview = new window.InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: 'あ',
        inputType: 'insertCompositionText',
      });
      content.dispatchEvent(preview);

      expect(preview.defaultPrevented).toBe(false);
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(editor.getText()).toBe('line 1');

      content.dispatchEvent(
        new window.CompositionEvent('compositionend', {
          bubbles: true,
          composed: true,
          data: 'あ',
        })
      );

      expect(editor.getText()).toBe('line 1あ');
    } finally {
      consoleWarn.mockRestore();
      cleanup();
    }
  });

  test('does not commit canceled composition preview text', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture();

    try {
      content.dispatchEvent(
        new window.CompositionEvent('compositionstart', {
          bubbles: true,
          composed: true,
        })
      );
      content.dispatchEvent(
        new window.CompositionEvent('compositionupdate', {
          bubbles: true,
          composed: true,
          data: 'あ',
        })
      );
      content.dispatchEvent(
        new window.CompositionEvent('compositionend', {
          bubbles: true,
          composed: true,
          data: '',
        })
      );

      expect(editor.getText()).toBe('line 1');
    } finally {
      cleanup();
    }
  });

  test('leaves the caret alone for a composing ArrowDown', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha\nbeta',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, {
        key: 'ArrowDown',
        isComposing: true,
      });

      expect(event.defaultPrevented).toBe(false);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('survives selection changes when getComposedRanges is unavailable', async () => {
    // The editor renders inside a shadow root and reads the selection via
    // Selection.getComposedRanges, a newly available API. On browsers and
    // embedded WebViews that lack it (as jsdom does here), a selectionchange
    // must not throw out of the listener and leave the surface unusable.
    const { cleanup, editor } = await createEditorFixture();
    // jsdom forwards uncaught listener exceptions to console.error, so a throw
    // inside the selectionchange handler surfaces here rather than propagating
    // out of dispatchEvent.
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(document.getSelection()?.getComposedRanges).toBeUndefined();
      // Drain any pending focus frames so the listener no longer ignores
      // selection changes and actually reaches the composed-range read.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      document.dispatchEvent(new Event('selectionchange'));

      expect(consoleError).not.toHaveBeenCalled();
      expect(editor.getText()).toBe('line 1');
    } finally {
      consoleError.mockRestore();
      cleanup();
    }
  });
});

describe('Editor focus ownership', () => {
  test('a superseded caret placement cannot focus or release the newer one', async () => {
    const { cleanup, content, editor } = await createEditorFixture({
      contents: 'hello world',
    });
    const { frame, restore } = installControlledFrames();
    const focus = spyOn(content, 'focus');

    try {
      // First placement focuses; its settle frame is now queued.
      editor.setSelections([caretAt(1)]);
      frame();
      expect(focus).toHaveBeenCalledTimes(1);

      // Second placement queues its focus frame into the same render pass as
      // the first placement's settle frame.
      editor.setSelections([caretAt(5)]);
      focus.mockClear();
      frame();
      expect(focus).toHaveBeenCalledTimes(1);

      // The browser reports the first placement's caret while the second is
      // still settling. It must not move the editor's caret.
      reportNativeCaret(content, 1);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 5,
      });

      // Once the second placement settles, native selection reads resume.
      frame();
      reportNativeCaret(content, 1);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 1,
      });
    } finally {
      focus.mockRestore();
      restore();
      cleanup();
    }
  });

  test('a host re-render still restores focus when a placement supersedes the restore', async () => {
    const { cleanup, content, editor, file, fileContainer } =
      await createEditorFixture({ contents: 'hello world' });
    const { frame, restore } = installControlledFrames();
    const shadowRoot = fileContainer.shadowRoot!;
    let focus = spyOn(content, 'focus');

    try {
      content.focus();
      editor.focus();
      frame();
      frame();
      focus.mockRestore();

      // A full host render replaces the rows and queues a focus restore. A
      // caret placement before that restore's frame supersedes it.
      file.render({
        file: { name: 'editor.ts', contents: 'hello world' },
        fileContainer,
        forceRender: true,
      });
      const current = shadowRoot.querySelector<HTMLElement>('[data-content]')!;
      focus = spyOn(current, 'focus');
      editor.setSelections([caretAt(5)]);
      frame();
      frame();
      frame();

      expect(focus).toHaveBeenCalled();
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 5,
      });
    } finally {
      focus.mockRestore();
      restore();
      cleanup();
    }
  });

  test('a direct focus call after a host re-render leaves no restore behind', async () => {
    const { cleanup, content, editor, file, fileContainer } =
      await createEditorFixture({ contents: 'hello world' });
    const { frame, restore } = installControlledFrames();

    try {
      content.focus();
      editor.focus();
      frame();
      frame();

      // A full host render queues a focus restore. A plain focus() in the
      // same tick does not go through the restore path.
      file.render({
        file: { name: 'editor.ts', contents: 'hello world' },
        fileContainer,
        forceRender: true,
      });
      editor.focus();
      frame();
      frame();
      frame();

      // Once everything has settled, the browser's selection is the user's
      // again and must be read back.
      const current =
        fileContainer.shadowRoot!.querySelector<HTMLElement>('[data-content]')!;
      reportNativeCaret(current, 2);
      expect(editor.getViewState().selections?.[0]?.start).toEqual({
        line: 0,
        character: 2,
      });
    } finally {
      restore();
      cleanup();
    }
  });

  test('a landed restore does not release a keyboard placement that follows it', async () => {
    const { cleanup, content, editor, file, fileContainer, window } =
      await createEditorFixture({
        contents: 'hello world',
        selections: [caretAt(1)],
      });
    const { frame, restore } = installControlledFrames();

    try {
      content.focus();
      editor.focus();
      frame();
      frame();

      // A host render queues a restore; its focus frame runs, leaving only
      // its settle frame pending.
      file.render({
        file: { name: 'editor.ts', contents: 'hello world' },
        fileContainer,
        forceRender: true,
      });
      frame();

      // A keyboard selection extends the caret and places it again before
      // that settle frame runs. The restore's settle must not release this
      // newer placement, or the browser's collapsed caret would be read back
      // over the selection.
      const current =
        fileContainer.shadowRoot!.querySelector<HTMLElement>('[data-content]')!;
      dispatchKeydown(window, current, {
        key: 'ArrowRight',
        code: 'ArrowRight',
        shiftKey: true,
      });
      const selection = () => editor.getViewState().selections?.[0];
      expect(selection()?.end).toEqual({ line: 0, character: 2 });
      frame();
      reportNativeCaret(current, 2);
      expect(selection()?.start).toEqual({ line: 0, character: 1 });
      expect(selection()?.end).toEqual({ line: 0, character: 2 });

      frame();
      reportNativeCaret(current, 2);
      expect(selection()?.start).toEqual({ line: 0, character: 2 });
    } finally {
      restore();
      cleanup();
    }
  });

  test('a queued focus survives a host render that replaces the document', async () => {
    const { cleanup, editor, file, fileContainer } = await createEditorFixture({
      contents: 'hello world',
    });
    const { frame, restore } = installControlledFrames();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    const focused: HTMLElement[] = [];
    const focus = spyOn(HTMLElement.prototype, 'focus').mockImplementation(
      function (this: HTMLElement) {
        focused.push(this);
      }
    );

    try {
      // The editor asks for focus; the real focus() call is a frame away.
      editor.focus({ lineNumber: 1, preventScroll: true });
      // Before that frame, the host renders a different file, replacing the
      // editor's document and DOM. The editor's request must still win over
      // the input that held focus until then.
      file.render({
        file: { name: 'other.ts', contents: 'alpha' },
        fileContainer,
        forceRender: true,
      });
      frame();
      frame();

      const current =
        fileContainer.shadowRoot!.querySelector<HTMLElement>('[data-content]')!;
      expect(focused.at(-1) === current).toBe(true);
    } finally {
      focus.mockRestore();
      input.remove();
      restore();
      cleanup();
    }
  });
});

describe('Editor keyboard editing', () => {
  test('uses primary Linux Ctrl+A as select-all instead of cursor move', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha\nbeta',
      platform: 'Linux x86_64',
      selections: [
        {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, {
        key: 'a',
        ctrlKey: true,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 4 },
          direction: DirectionForward,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('moves and extends every caret by word with Windows Ctrl+Arrow', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha beta.gamma\nfoo bar',
      platform: 'Win32',
      selections: [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'none',
        },
      ],
    });

    try {
      const move = dispatchKeydown(window, content, {
        key: 'ArrowRight',
        ctrlKey: true,
      });
      expect(move.defaultPrevented).toBe(true);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: DirectionNone,
        },
        {
          start: { line: 1, character: 3 },
          end: { line: 1, character: 3 },
          direction: DirectionNone,
        },
      ]);

      const extend = dispatchKeydown(window, content, {
        key: 'ArrowRight',
        ctrlKey: true,
        shiftKey: true,
      });
      expect(extend.defaultPrevented).toBe(true);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 10 },
          direction: DirectionForward,
        },
        {
          start: { line: 1, character: 3 },
          end: { line: 1, character: 7 },
          direction: DirectionForward,
        },
      ]);

      const unrelated = dispatchKeydown(window, content, {
        key: 'ArrowRight',
        ctrlKey: true,
        altKey: true,
      });
      expect(unrelated.defaultPrevented).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('moves left by word with Linux Ctrl+ArrowLeft', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha beta.gamma',
      platform: 'Linux x86_64',
    });

    try {
      const event = dispatchKeydown(window, content, {
        key: 'ArrowLeft',
        ctrlKey: true,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 11 },
          end: { line: 0, character: 11 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('lets a custom keymap override Ctrl+Arrow word moves', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha beta',
      keymap: [{ bindings: { 'ctrl+ArrowRight': 'selectAll' } }],
      platform: 'Win32',
      selections: [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, {
        key: 'ArrowRight',
        ctrlKey: true,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
          direction: DirectionForward,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('uses primary Linux Ctrl+F as search instead of cursor move', async () => {
    const { cleanup, content, window } = await createEditorFixture({
      contents: 'alpha beta',
      platform: 'Linux x86_64',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, {
        key: 'f',
        ctrlKey: true,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(
        (content.getRootNode() as ParentNode).querySelector(
          '[data-search-panel]'
        )
      ).toBeInstanceOf(HTMLElement);
    } finally {
      cleanup();
    }
  });

  test('replaces the current match on Enter from the replace input', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha beta alpha',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const replaceInput = findReplaceInput(panel);
      updateInputValue(replaceInput, 'omega');

      const event = dispatchKeydown(window, replaceInput, { key: 'Enter' });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('omega beta alpha');
    } finally {
      cleanup();
    }
  });

  test('lets composing Enter commit IME text in the replace input', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha beta',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const replaceInput = findReplaceInput(panel);
      updateInputValue(replaceInput, 'omega');

      const event = dispatchKeydown(window, replaceInput, {
        key: 'Enter',
        isComposing: true,
      });

      expect(event.defaultPrevented).toBe(false);
      expect(panel.isConnected).toBe(true);
      expect(editor.getText()).toBe('alpha beta');
    } finally {
      cleanup();
    }
  });

  test('lets composing Enter commit IME text in the search input', async () => {
    const { cleanup, content, window } = await createEditorFixture({
      contents: 'alpha beta',
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const searchInput = findSearchInput(panel);
      updateInputValue(searchInput, 'beta');

      const event = dispatchKeydown(window, searchInput, {
        key: 'Enter',
        isComposing: true,
      });

      expect(event.defaultPrevented).toBe(false);
      expect(panel.isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('keeps the panel open when Escape cancels a composition', async () => {
    const { cleanup, content, window } = await createEditorFixture({
      contents: 'alpha beta',
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const searchInput = findSearchInput(panel);

      const event = dispatchKeydown(window, searchInput, {
        key: 'Escape',
        keyCode: 229,
      });

      expect(event.defaultPrevented).toBe(false);
      expect(panel.isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('keeps the panel open when Escape cancels a replace input composition', async () => {
    const { cleanup, content, window } = await createEditorFixture({
      contents: 'alpha beta',
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const replaceInput = findReplaceInput(panel);

      const event = dispatchKeydown(window, replaceInput, {
        key: 'Escape',
        keyCode: 229,
      });

      expect(event.defaultPrevented).toBe(false);
      expect(panel.isConnected).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('closes the search panel on Escape from the replace input', async () => {
    const { cleanup, content, window } = await createEditorFixture({
      contents: 'alpha beta',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const panel = await openSearchReplacePanel({ content, window });
      const replaceInput = findReplaceInput(panel);

      const event = dispatchKeydown(window, replaceInput, { key: 'Escape' });

      expect(event.defaultPrevented).toBe(true);
      expect(panel.isConnected).toBe(false);
      expect(
        (content.getRootNode() as ParentNode).querySelector(
          '[data-search-panel]'
        )
      ).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('applies single-line indent once per collapsed caret', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'alpha\nbeta',
      selections: [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, { key: 'Tab' });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('  alpha\n  beta');
    } finally {
      cleanup();
    }
  });

  test('deletes one soft tab when backspacing in leading indentation', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: '  foo',
      selections: [
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchBackspace(window, content);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('foo');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('deletes one hard tab when backspacing in leading indentation', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: '\tfoo',
      selections: [
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchBackspace(window, content);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('foo');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('deletes only the selection when backspacing a range in indentation', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: '  foo',
      selections: [
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
      ],
    });

    try {
      const event = dispatchBackspace(window, content);

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe(' foo');
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });

  test('shifts later same-line carets past earlier inserted indents', async () => {
    const { cleanup, content, editor, window } = await createEditorFixture({
      contents: 'abcdefgh',
      selections: [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ],
    });

    try {
      const event = dispatchKeydown(window, content, { key: 'Tab' });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getText()).toBe('  abcde  fgh');
      // The second caret follows its own inserted indent (column 9), not the
      // pre-shift column 7 that lands before it.
      expect(editor.getViewState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: DirectionNone,
        },
        {
          start: { line: 0, character: 9 },
          end: { line: 0, character: 9 },
          direction: DirectionNone,
        },
      ]);
    } finally {
      cleanup();
    }
  });
});
