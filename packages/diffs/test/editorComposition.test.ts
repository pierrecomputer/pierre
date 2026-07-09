import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { DirectionForward, DirectionNone } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { DiffsEditorSelection, FileContents } from '../src/types';
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

interface CreateEditorFixtureOptions {
  contents?: string;
  platform?: string;
  selections?: DiffsEditorSelection[];
}

async function createEditorFixture(
  options: CreateEditorFixtureOptions = {}
): Promise<EditorFixture> {
  const { contents = 'line 1', platform = 'MacIntel', selections } = options;
  const dom = installDom({ navigator: { platform } });
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = {
    name: 'editor.ts',
    contents,
  };

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
  const input = panel.querySelector<HTMLInputElement>('input[data-replace]');
  if (input == null) {
    throw new Error('replace input was not rendered');
  }
  return input;
}

function updateInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

describe('Editor composition input', () => {
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
      expect(editor.getState().file.contents).toBe('line 1');

      content.dispatchEvent(
        new window.CompositionEvent('compositionend', {
          bubbles: true,
          composed: true,
          data: 'あ',
        })
      );

      expect(editor.getState().file.contents).toBe('line 1あ');
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

      expect(editor.getState().file.contents).toBe('line 1');
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
      expect(editor.getState().file.contents).toBe('line 1');
    } finally {
      consoleError.mockRestore();
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
      expect(editor.getState().selections).toEqual([
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
      expect(editor.getState().file.contents).toBe('omega beta alpha');
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
      expect(editor.getState().file.contents).toBe('  alpha\n  beta');
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
      expect(editor.getState().file.contents).toBe('foo');
      expect(editor.getState().selections).toEqual([
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
      expect(editor.getState().file.contents).toBe('foo');
      expect(editor.getState().selections).toEqual([
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
      expect(editor.getState().file.contents).toBe(' foo');
      expect(editor.getState().selections).toEqual([
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
      expect(editor.getState().file.contents).toBe('  abcde  fgh');
      // The second caret follows its own inserted indent (column 9), not the
      // pre-shift column 7 that lands before it.
      expect(editor.getState().selections).toEqual([
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
