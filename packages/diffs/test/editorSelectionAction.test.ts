import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import type { SelectionActionContext } from '../src/editor/selectionAction';
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

interface SelectionActionFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
}

async function createSelectionActionFixture(
  contents: string,
  editorOptions: EditorOptions<undefined>
): Promise<SelectionActionFixture> {
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

// Returns the clickable gutter icon that opens the selection action.
function findSelectionActionIcon(content: HTMLElement): HTMLElement {
  const root = content.getRootNode() as ShadowRoot;
  const icon = root.querySelector<HTMLElement>('[data-selection-action-icon]');
  if (icon === null) {
    throw new Error('selection action icon was not rendered');
  }
  return icon;
}

describe('Editor selection action', () => {
  // The gutter icon element is cached and reused across renders for the same
  // line. During a drag it is first created from the first single-character
  // selection, so its click handler must read the current selection rather than
  // the stale snapshot it was created with.
  test('forward-grown selection: acts on the full selection, not the first character', async () => {
    let captured: SelectionActionContext<undefined> | undefined;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction(context) {
          captured = context;
          return document.createElement('div');
        },
      }
    );

    try {
      // First selection (single character) creates and caches the icon.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
          direction: 'forward',
        },
      ]);

      // The selection grows on the same line; the cached icon is reused.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);

      findSelectionActionIcon(content).click();

      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');

      captured!.replaceSelectionText(`TODO(${captured!.getSelectionText()})`);
      expect(editor.getState().file.contents).toBe('TODO(hello) world');
    } finally {
      cleanup();
    }
  });

  // Mirror of the forward case: a backward drag first creates the icon from the
  // last character, so the stale snapshot would be the selection's last letter.
  test('backward-grown selection: acts on the full selection, not the last character', async () => {
    let captured: SelectionActionContext<undefined> | undefined;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction(context) {
          captured = context;
          return document.createElement('div');
        },
      }
    );

    try {
      // First selection is the last character of the word being selected.
      editor.setSelections([
        {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 5 },
          direction: 'backward',
        },
      ]);

      // The selection grows backward on the same line; the cached icon is reused.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'backward',
        },
      ]);

      findSelectionActionIcon(content).click();

      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');
    } finally {
      cleanup();
    }
  });
});
