import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { DirectionBackward, getCaretPosition } from '../src/editor/selection';
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

  // A bottom-up (backward) selection has its head at the top, so the popover
  // must sit above the selection (shifted up by its own height) instead of
  // covering its first line. The shift is expressed via --popover-y-shift.
  test('backward selection places the popover above the selection', async () => {
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
          direction: 'backward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      cleanup();
    }
  });

  // A top-down (forward) selection has its head at the bottom, so the popover
  // keeps the original below-placement with no self-shift.
  test('forward selection places the popover below the selection', async () => {
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

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      cleanup();
    }
  });

  // getComposedRanges only reports an ordered, direction-less range, so the
  // selectionchange a refocus fires (after tabbing away and back) would flip a
  // backward selection to DirectionNone and snap the caret/popover to the
  // bottom. With the bounds unchanged the prior direction must be preserved.
  test('refocus keeps a backward selection backward', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello\nworld',
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    const originalGetSelection = document.getSelection.bind(document);
    try {
      // Focus before selecting so #contentHasFocus is set without the focus
      // handler re-syncing a not-yet-existing selection.
      content.dispatchEvent(new Event('focus'));

      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'backward',
        },
      ]);
      expect(editor.getState().selections?.[0]?.direction).toBe(
        DirectionBackward
      );

      const lineElements = Array.from(
        content.querySelectorAll<HTMLElement>('[data-line]')
      );
      const lineElement0 = lineElements.find((el) => el.dataset.line === '1')!;
      const lineElement1 = lineElements.find((el) => el.dataset.line === '2')!;
      // A direction-less, bounds-identical range, mirroring what a refocus
      // selectionchange reports through getComposedRanges.
      const refocusRange = {
        startContainer: lineElement0,
        startOffset: 0,
        endContainer: lineElement1,
        endOffset: 0,
      } as unknown as StaticRange;
      document.getSelection = (() => ({
        getComposedRanges: () => [refocusRange],
      })) as unknown as typeof document.getSelection;

      document.dispatchEvent(new Event('selectionchange'));

      const primarySelection = editor.getState().selections?.at(-1);
      expect(primarySelection?.direction).toBe(DirectionBackward);
      expect(getCaretPosition(primarySelection!)).toEqual({
        line: 0,
        character: 0,
      });
    } finally {
      document.getSelection = originalGetSelection;
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
