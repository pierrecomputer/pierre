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

// Returns the floating popover that hosts the selection action, mounted into the
// editor's overlay layer as soon as a ranged selection settles.
function findSelectionActionPopover(content: HTMLElement): HTMLElement {
  const root = content.getRootNode() as ShadowRoot;
  const popover = root.querySelector<HTMLElement>(
    '[data-selection-action-popover]'
  );
  if (popover === null) {
    throw new Error('selection action popover was not rendered');
  }
  return popover;
}

describe('Editor selection action', () => {
  // The popover element is created once when the selection settles and kept open
  // across selection changes, so its handlers must read the current primary
  // selection rather than the snapshot taken when it was first created. During a
  // drag the popover is first created from the initial single-character
  // selection.
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
      // First selection (single character) creates the popover.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
          direction: 'forward',
        },
      ]);

      // The selection grows on the same line; the popover stays open.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);

      expect(() => findSelectionActionPopover(content)).not.toThrow();
      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');

      captured!.replaceSelectionText(`TODO(${captured!.getSelectionText()})`);
      expect(editor.getState().file.contents).toBe('TODO(hello) world');
    } finally {
      cleanup();
    }
  });

  // Mirror of the forward case: a backward drag first creates the popover from
  // the last character, so a stale snapshot would be the selection's last
  // letter.
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

      // The selection grows backward on the same line; the popover stays open.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'backward',
        },
      ]);

      expect(() => findSelectionActionPopover(content)).not.toThrow();
      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');
    } finally {
      cleanup();
    }
  });

  // The popover only exists while a range is selected; collapsing the selection
  // (clicking elsewhere, arrowing away) tears it down.
  test('collapsing the selection removes the popover', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);
      expect(() => findSelectionActionPopover(content)).not.toThrow();

      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);
      const root = content.getRootNode() as ShadowRoot;
      expect(root.querySelector('[data-selection-action-popover]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  // Without `enabledSelectionAction`, a ranged selection renders nothing and the
  // consumer's callback is never invoked.
  test('renders no popover when the feature is disabled', async () => {
    let rendered = false;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        renderSelectionAction() {
          rendered = true;
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);
      const root = content.getRootNode() as ShadowRoot;
      expect(root.querySelector('[data-selection-action-popover]')).toBeNull();
      expect(rendered).toBe(false);
    } finally {
      cleanup();
    }
  });
});
