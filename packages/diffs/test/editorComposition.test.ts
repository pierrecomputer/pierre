import { afterAll, describe, expect, spyOn, test } from 'bun:test';

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
}

async function createEditorFixture(): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = {
    name: 'ime.ts',
    contents: 'line 1',
  };

  file.render({
    file: initialFile,
    fileContainer,
    forceRender: true,
  });
  editor.edit(file);

  const content = await waitForEditableContent(fileContainer);
  editor.setSelections([
    {
      start: { line: 0, character: initialFile.contents.length },
      end: { line: 0, character: initialFile.contents.length },
      direction: 'none',
    },
  ]);

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
