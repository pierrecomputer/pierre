import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { FileDiff, type FileDiffOptions } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { DirectionForward } from '../src/editor/selection';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, SelectedLineRange } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// In a split diff the deletions column carries `data-deletions` and the
// additions column does not; a unified diff renders a single column with
// neither attribute.
function findCodeColumns(container: HTMLElement): {
  additions?: HTMLElement;
  deletions?: HTMLElement;
} {
  const shadow = container.shadowRoot;
  const columns: { additions?: HTMLElement; deletions?: HTMLElement } = {};
  if (shadow == null) {
    return columns;
  }
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    if (code.dataset.deletions !== undefined) {
      columns.deletions = code;
    } else {
      columns.additions = code;
    }
  }
  return columns;
}

// The 1-based data-line numbers of content rows in one column that carry the
// explicit selected-lines background.
function highlightedLineNumbers(code: HTMLElement | undefined): number[] {
  if (code == null) {
    return [];
  }
  return [
    ...code.querySelectorAll(
      '[data-content] > [data-line][data-selected-line]'
    ),
  ]
    .map((el) => Number(el.getAttribute('data-line')))
    .sort((a, b) => a - b);
}

// The gutter line numbers carrying the explicit selected-lines background.
function highlightedGutterNumbers(code: HTMLElement | undefined): number[] {
  if (code == null) {
    return [];
  }
  return [...code.querySelectorAll('[data-column-number][data-selected-line]')]
    .map((el) => Number(el.getAttribute('data-column-number')))
    .sort((a, b) => a - b);
}

function editorActiveLineNumbers(code: HTMLElement | undefined): number[] {
  if (code == null) {
    return [];
  }
  return [
    ...code.querySelectorAll(
      '[data-content] > [data-line][data-editor-active-line]'
    ),
  ]
    .map((el) => Number(el.getAttribute('data-line')))
    .sort((a, b) => a - b);
}

function editorActiveGutterNumbers(code: HTMLElement | undefined): number[] {
  if (code == null) {
    return [];
  }
  return [
    ...code.querySelectorAll('[data-column-number][data-editor-active-line]'),
  ]
    .map((el) => Number(el.getAttribute('data-column-number')))
    .sort((a, b) => a - b);
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// Dispatch a copy event with a clipboardData spy and return the writes, the
// same approach as editorClipboard.test.ts.
function dispatchCopy(
  target: HTMLElement
): Array<[type: string, text: string]> {
  const writes: Array<[type: string, text: string]> = [];
  const event = new window.Event('copy', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData(type: string, text: string) {
        writes.push([type, text]);
      },
    },
  });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return writes;
}

interface DiffEditorFixture {
  container: HTMLElement;
  editor: Editor<undefined>;
  fileDiff: FileDiff<undefined>;
  setElementFromPoint(x: number, y: number, element: Element): void;
  cleanup(): Promise<void>;
}

async function createDiffEditorFixture(
  diffStyle: 'split' | 'unified',
  oldContents: string,
  newContents: string,
  options: Partial<FileDiffOptions<undefined>> = {}
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle,
    ...options,
  });
  const editor = new Editor<undefined>();
  const oldFile: FileContents = { name: 'edit.ts', contents: oldContents };
  const newFile: FileContents = { name: 'edit.ts', contents: newContents };

  fileDiff.render({
    oldFile,
    newFile,
    fileContainer: container,
    forceRender: true,
  });
  editor.edit(fileDiff);
  // The content rows are rendered synchronously by fileDiff.render() (the diff
  // hunks renderer can produce rows from a cache or a plain-text fallback), but
  // the editor's text document is only created later, inside the async
  // initializeHighlighter().then(editor.__syncRenderView) callback in
  // FileDiff.syncRenderViewToEditor(). Until that callback runs, setSelections
  // throws "Text document is not initialized". So polling for rows alone can
  // win the race before the document exists when the highlighter load is slow.
  //
  // __syncRenderView sets contentEditable = 'true' on the [data-content]
  // element (editor.ts) in the same synchronous block that assigns
  // this.#textDocument, and the first sync always takes both gates, so the
  // content element becoming contenteditable is a direct, reliable proxy for
  // "the text document is initialized and setSelections is safe". (jsdom does
  // not reflect the contentEditable IDL property to the attribute, so read the
  // property rather than matching a [contenteditable] selector.) Poll on that
  // (with rows present) rather than on rows alone.
  await waitFor(() => {
    const content =
      container.shadowRoot?.querySelector<HTMLElement>('[data-content]');
    return (
      content?.contentEditable === 'true' &&
      content.querySelectorAll('[data-line]').length > 0
    );
  });

  return {
    container,
    editor,
    fileDiff,
    setElementFromPoint: dom.setElementFromPoint,
    async cleanup() {
      await wait(10);
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    },
  };
}

describe('editor active-line highlight on a diff', () => {
  // A modified first line gives the additions caret row a paired deletion row
  // on the left, which is exactly where the highlight used to leak.
  const OLD = 'import a\nimport b\nimport c\n';
  const NEW = 'import x\nimport b\nimport c\n';

  test('split: a caret highlights only the additions column', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);

      const { additions, deletions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveLineNumbers(additions).length > 0);
      // The changed addition line ("import x", index 0) renders as data-line 1.
      expect(editorActiveLineNumbers(additions)).toEqual([1]);
      // The read-only deletions column must not be highlighted.
      expect(editorActiveLineNumbers(deletions)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: refresh defers editor active lines and selected lines independently', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      fixture.fileDiff.updateRenderCache(new Map(), 'light', true);
      fixture.fileDiff.setSelectedLines({ start: 2, end: 2 });
      fixture.fileDiff.setEditorActiveLine(1);

      const { additions, deletions } = findCodeColumns(fixture.container);
      await wait(175);
      await waitFor(() =>
        arraysEqual(highlightedGutterNumbers(additions), [2])
      );

      expect(highlightedGutterNumbers(additions)).toEqual([2]);
      expect(highlightedGutterNumbers(deletions)).toEqual([2]);
      expect(editorActiveGutterNumbers(additions)).toEqual([1]);
      expect(editorActiveGutterNumbers(deletions)).toEqual([]);
      expect(editorActiveLineNumbers(additions)).toEqual([1]);

      fixture.fileDiff.setSelectedLines(null);
      await waitFor(() => highlightedGutterNumbers(additions).length === 0);
      expect(highlightedGutterNumbers(additions)).toEqual([]);
      expect(highlightedGutterNumbers(deletions)).toEqual([]);
      expect(editorActiveGutterNumbers(additions)).toEqual([1]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: a selected line and editor active line can share one row', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      fixture.fileDiff.setSelectedLines({ start: 2, end: 2 });
      fixture.fileDiff.setEditorActiveLine(2);

      const { additions, deletions } = findCodeColumns(fixture.container);
      const additionRow = additions?.querySelector<HTMLElement>(
        '[data-content] > [data-line="2"]'
      );
      const deletionRow = deletions?.querySelector<HTMLElement>(
        '[data-content] > [data-line="2"]'
      );

      expect(additionRow?.hasAttribute('data-selected-line')).toBe(true);
      expect(additionRow?.hasAttribute('data-editor-active-line')).toBe(true);
      expect(deletionRow?.hasAttribute('data-selected-line')).toBe(true);
      expect(deletionRow?.hasAttribute('data-editor-active-line')).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: a deletion gutter utility does not change editor text selection', async () => {
    const clickedRanges: SelectedLineRange[] = [];
    const fixture = await createDiffEditorFixture('split', OLD, NEW, {
      enableGutterUtility: true,
      enableLineSelection: false,
      lineHoverHighlight: 'both',
      onGutterUtilityClick: (range) => clickedRanges.push(range),
    });
    let getSelectionStub: { mockRestore(): void } | undefined;
    try {
      // Let the editor's setup and focus frames settle before establishing the
      // selection this gesture must preserve.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      const { additions, deletions } = findCodeColumns(fixture.container);
      const content = additions?.querySelector<HTMLElement>('[data-content]');
      const firstLine = content?.querySelector('[data-line="1"]');
      if (content == null || firstLine == null) {
        throw new Error('missing editor content');
      }
      fixture.editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
          direction: 'forward',
        },
      ]);
      content.dispatchEvent(new Event('focus'));
      const selectionBefore = fixture.editor.getState().selections;
      getSelectionStub = spyOn(document, 'getSelection').mockReturnValue({
        getComposedRanges: () => [
          {
            startContainer: firstLine,
            startOffset: 0,
            endContainer: firstLine,
            endOffset: 0,
          },
        ],
      } as unknown as Selection);
      const deletedGutter = deletions?.querySelector<HTMLElement>(
        "[data-gutter] > [data-column-number][data-line-type='change-deletion']"
      );
      expect(deletedGutter).not.toBeNull();

      deletedGutter?.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );
      await waitFor(
        () => deletedGutter?.querySelector('[data-utility-button]') != null
      );
      const utility = deletedGutter?.querySelector<HTMLElement>(
        '[data-utility-button]'
      );
      expect(utility).not.toBeNull();

      utility?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          cancelable: true,
          composed: true,
          pointerId: 21,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual(selectionBefore);

      utility?.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 21,
          pointerType: 'mouse',
        })
      );
      // Native selection changes can arrive after pointerup, so the editor
      // selection must remain protected until the next content interaction.
      document.dispatchEvent(new Event('selectionchange'));

      expect(clickedRanges).toEqual([{ start: 1, end: 1, side: 'deletions' }]);
      expect(fixture.editor.getState().selections).toEqual(selectionBefore);
      expect(editorActiveGutterNumbers(additions)).toEqual([2]);
      expect(
        fixture.container.shadowRoot
          ?.querySelector('pre')
          ?.hasAttribute('data-deleted-text-selection')
      ).toBe(false);
    } finally {
      getSelectionStub?.mockRestore();
      await fixture.cleanup();
    }
  });

  test('split: selected lines and deleted-line focus render independently', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      fixture.fileDiff.setSelectedLines({ start: 2, end: 2 });
      const { additions, deletions } = findCodeColumns(fixture.container);
      expect(highlightedGutterNumbers(additions)).toEqual([2]);
      expect(highlightedGutterNumbers(deletions)).toEqual([2]);
      expect(editorActiveGutterNumbers(additions)).toEqual([]);
      expect(editorActiveGutterNumbers(deletions)).toEqual([]);
      expect(highlightedLineNumbers(additions)).toEqual([2]);
      expect(highlightedLineNumbers(deletions)).toEqual([2]);

      const deletedGutter = deletions?.querySelector<HTMLElement>(
        "[data-gutter] > [data-column-number][data-line-type='change-deletion']"
      );
      expect(deletedGutter).not.toBeNull();
      deletedGutter?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );

      expect(highlightedGutterNumbers(additions)).toEqual([2]);
      expect(highlightedGutterNumbers(deletions)).toEqual([2]);
      expect(editorActiveGutterNumbers(additions)).toEqual([]);
      expect(editorActiveGutterNumbers(deletions)).toEqual([1]);
      expect(
        fixture.container.shadowRoot
          ?.querySelector('pre')
          ?.hasAttribute('data-deleted-text-selection')
      ).toBe(true);

      fixture.fileDiff.setSelectedLines(null);
      expect(highlightedGutterNumbers(additions)).toEqual([]);
      expect(highlightedGutterNumbers(deletions)).toEqual([]);
      expect(editorActiveGutterNumbers(deletions)).toEqual([1]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: starting a selection in the deletions column clears the additions selection', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);

      const { additions, deletions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveLineNumbers(additions).length > 0);
      expect(editorActiveLineNumbers(additions)).toEqual([1]);

      // A pointerdown in the read-only deletions column hands the selection to
      // that column (painted natively), so the editor drops its additions-side
      // selection — only one column is selected at a time.
      deletions?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
      await waitFor(() => editorActiveLineNumbers(additions).length === 0);
      expect(editorActiveLineNumbers(additions)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: a text selection keeps the caret line number but drops the background', async () => {
    const fixture = await createDiffEditorFixture('split', OLD, NEW);
    try {
      // Select "import" from the very start of the line (no leading
      // whitespace), the exact case from the bug report.
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
          direction: 'forward',
        },
      ]);

      const { additions, deletions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveGutterNumbers(additions).length > 0);
      // No line background on either column: the selected text is the
      // line-level highlight instead.
      expect(highlightedLineNumbers(additions)).toEqual([]);
      expect(highlightedLineNumbers(deletions)).toEqual([]);
      // The caret line's gutter number stays highlighted on the additions side.
      expect(editorActiveGutterNumbers(additions)).toEqual([1]);
      expect(editorActiveGutterNumbers(deletions)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: a caret still highlights its line', async () => {
    const fixture = await createDiffEditorFixture('unified', OLD, NEW);
    try {
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);

      // A unified diff has a single column, so the additions-only restriction
      // must not suppress the highlight there.
      const { additions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveLineNumbers(additions).length > 0);
      expect(editorActiveLineNumbers(additions)).toEqual([1]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: selecting a deleted line clears the editor selection and toggles the deleted-text marker', async () => {
    const fixture = await createDiffEditorFixture('unified', OLD, NEW);
    try {
      const shadow = fixture.container.shadowRoot;
      const pre = shadow?.querySelector('pre');
      const deletedLine = shadow?.querySelector(
        "[data-content] > [data-line][data-line-type='change-deletion']"
      );
      const editableLine = shadow?.querySelector(
        "[data-content] > [data-line]:not([data-line-type='change-deletion'])"
      );
      expect(deletedLine).not.toBeNull();
      expect(editableLine).not.toBeNull();

      // A caret on an editable line highlights it.
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      const { additions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveGutterNumbers(additions).length > 0);
      expect(editorActiveGutterNumbers(additions).length).toBeGreaterThan(0);

      // Pointerdown on the deleted line hands selection to that line: the
      // editor drops its own selection and the deleted-text marker turns on.
      deletedLine?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(additions).length === 0);
      expect(editorActiveGutterNumbers(additions)).toEqual([]);
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);

      // Pointerdown back on an editable line turns the marker off, so a normal
      // selection no longer reveals deleted-text selection.
      editableLine?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () => pre?.hasAttribute('data-deleted-text-selection') === false
      );
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: clicking a deleted line number selects the line and clears the editor selection', async () => {
    const fixture = await createDiffEditorFixture('unified', OLD, NEW);
    try {
      const shadow = fixture.container.shadowRoot;
      const pre = shadow?.querySelector('pre');
      const deletedGutterNumber = shadow?.querySelector(
        "[data-gutter] [data-column-number][data-line-type='change-deletion']"
      );
      expect(deletedGutterNumber).not.toBeNull();

      // A caret on an editable line highlights it.
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      const { additions } = findCodeColumns(fixture.container);
      await waitFor(() => editorActiveGutterNumbers(additions).length > 0);
      expect(editorActiveGutterNumbers(additions).length).toBeGreaterThan(0);

      // Clicking the deleted line's gutter number hands selection to that
      // (read-only) line: the editor drops its own selection, the deleted line's
      // own gutter number becomes highlighted (matching an addition click), and
      // the deleted-text marker turns on.
      deletedGutterNumber?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () =>
          deletedGutterNumber?.hasAttribute('data-editor-active-line') === true
      );
      expect(deletedGutterNumber?.hasAttribute('data-editor-active-line')).toBe(
        true
      );
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: selecting a second deleted line clears the first one’s gutter highlight', async () => {
    // Two consecutive deletions so a selection can move from one to the other.
    const fixture = await createDiffEditorFixture(
      'unified',
      'keep0\ndelA\ndelB\nkeep1\n',
      'keep0\nkeep1\n'
    );
    try {
      const shadow = fixture.container.shadowRoot;
      const deletedGutterNumbers = [
        ...(shadow?.querySelectorAll(
          "[data-gutter] [data-column-number][data-line-type='change-deletion']"
        ) ?? []),
      ];
      expect(deletedGutterNumbers.length).toBeGreaterThanOrEqual(2);
      const [first, second] = deletedGutterNumbers;

      // Selecting the first deleted line highlights its gutter number.
      first?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () => first?.hasAttribute('data-editor-active-line') === true
      );
      expect(first?.hasAttribute('data-editor-active-line')).toBe(true);

      // Selecting a different deleted line must drop the first one's highlight
      // rather than leave it stale. A deletion selection never changes the
      // editor's own selection range, which is what normally clears these, so
      // the highlight has to be cleared explicitly when the next one starts.
      second?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () => second?.hasAttribute('data-editor-active-line') === true
      );
      expect(second?.hasAttribute('data-editor-active-line')).toBe(true);
      expect(first?.hasAttribute('data-editor-active-line')).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: dragging across deletion line numbers highlights only the end line', async () => {
    // Four consecutive deletions so a drag spans several lines.
    const fixture = await createDiffEditorFixture(
      'split',
      'a\nb\nc\nd\nkeep\n',
      'keep\n'
    );
    try {
      const { deletions } = findCodeColumns(fixture.container);
      const gutterRows = [
        ...(deletions?.querySelectorAll(
          '[data-gutter] > [data-column-number]'
        ) ?? []),
      ];
      // Old-file lines a..d are the deletions, numbered 1..4.
      const anchor = gutterRows.find(
        (g) => g.getAttribute('data-column-number') === '1'
      );
      const focus = gutterRows.find(
        (g) => g.getAttribute('data-column-number') === '4'
      );
      expect(anchor).toBeDefined();
      expect(focus).toBeDefined();

      // Press the first line's number, then drag the pointer onto the fourth.
      anchor?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(deletions).length > 0);
      focus?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(deletions).includes(4));

      // Only the line the drag ended on is highlighted — the same as an
      // addition selection, which highlights just its caret line — not every
      // line in the dragged range.
      expect(editorActiveGutterNumbers(deletions)).toEqual([4]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split: line selection owns deletion gutter drags without replacing the editor selection', async () => {
    const selectedRanges: (SelectedLineRange | null)[] = [];
    const fixture = await createDiffEditorFixture(
      'split',
      'a\nb\nc\nd\nkeep\n',
      'keep\n',
      {
        enableLineSelection: true,
        onLineSelected: (range) => selectedRanges.push(range),
      }
    );
    let getSelectionStub: { mockRestore(): void } | undefined;
    try {
      // Let editor setup and focus frames settle before establishing the
      // selection this gesture must preserve.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      const { additions, deletions } = findCodeColumns(fixture.container);
      const content = additions?.querySelector<HTMLElement>('[data-content]');
      const firstLine = content?.querySelector('[data-line="1"]');
      if (content == null || firstLine == null) {
        throw new Error('missing editor content');
      }
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
      ]);
      content.dispatchEvent(new Event('focus'));
      const editorSelection = fixture.editor.getState().selections;
      getSelectionStub = spyOn(document, 'getSelection').mockReturnValue({
        getComposedRanges: () => [
          {
            startContainer: firstLine,
            startOffset: 0,
            endContainer: firstLine,
            endOffset: 0,
          },
        ],
      } as unknown as Selection);
      const gutterRows = [
        ...(deletions?.querySelectorAll(
          '[data-gutter] > [data-column-number]'
        ) ?? []),
      ];
      const first = gutterRows.find(
        (row) => row.getAttribute('data-column-number') === '1'
      );
      const fourth = gutterRows.find(
        (row) => row.getAttribute('data-column-number') === '4'
      );
      if (!(first instanceof HTMLElement) || !(fourth instanceof HTMLElement)) {
        throw new Error('missing deletion gutter rows');
      }
      fixture.setElementFromPoint(8, 80, fourth);

      first.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 8,
          clientY: 20,
          composed: true,
          pointerId: 31,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual(editorSelection);

      fourth.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 8,
          clientY: 80,
          composed: true,
          pointerId: 31,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual(editorSelection);

      fourth.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: 8,
          clientY: 80,
          composed: true,
          pointerId: 31,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));

      expect(selectedRanges).toEqual([{ start: 1, end: 4, side: 'deletions' }]);
      expect(fixture.editor.getState().selections).toEqual(editorSelection);
      expect(
        fixture.container.shadowRoot
          ?.querySelector('pre')
          ?.hasAttribute('data-deleted-text-selection')
      ).toBe(false);
    } finally {
      getSelectionStub?.mockRestore();
      await fixture.cleanup();
    }
  });

  test('unified: dragging across deletion line numbers highlights only the end line', async () => {
    // Four consecutive deletions so a drag spans several lines.
    const fixture = await createDiffEditorFixture(
      'unified',
      'a\nb\nc\nd\nkeep\n',
      'keep\n'
    );
    try {
      const shadow = fixture.container.shadowRoot;
      const pre = shadow?.querySelector('pre');
      const gutterRows = [
        ...(shadow?.querySelectorAll(
          "[data-gutter] [data-column-number][data-line-type='change-deletion']"
        ) ?? []),
      ];
      // Old-file lines a..d are the deletions, numbered 1..4.
      const anchor = gutterRows.find(
        (g) => g.getAttribute('data-column-number') === '1'
      );
      const focus = gutterRows.find(
        (g) => g.getAttribute('data-column-number') === '4'
      );
      expect(anchor).toBeDefined();
      expect(focus).toBeDefined();

      // Press the first line's number, then drag the pointer onto the fourth —
      // the same gesture the split deletions column already supports.
      anchor?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () => anchor?.hasAttribute('data-editor-active-line') === true
      );
      focus?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await waitFor(
        () => focus?.hasAttribute('data-editor-active-line') === true
      );

      // Only the line the drag ended on stays highlighted (not the anchor, and
      // not every line in the range), and the deleted-text marker reveals the
      // native selection.
      expect(focus?.hasAttribute('data-editor-active-line')).toBe(true);
      expect(anchor?.hasAttribute('data-editor-active-line')).toBe(false);
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: tapping a deleted line number selects it on touch', async () => {
    const fixture = await createDiffEditorFixture('unified', OLD, NEW);
    try {
      const shadow = fixture.container.shadowRoot;
      const pre = shadow?.querySelector('pre');
      const deletedGutterNumber = shadow?.querySelector(
        "[data-gutter] [data-column-number][data-line-type='change-deletion']"
      );
      expect(deletedGutterNumber).not.toBeNull();

      // A touch tap selects the deleted line the same as a mouse click. The
      // mouse-only gate guards the editable gutter drag (which would strand
      // listener state on touch), not a deletion tap, which registers nothing.
      deletedGutterNumber?.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          pointerType: 'touch',
        })
      );
      await waitFor(
        () =>
          deletedGutterNumber?.hasAttribute('data-editor-active-line') === true
      );
      expect(deletedGutterNumber?.hasAttribute('data-editor-active-line')).toBe(
        true
      );
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('line selection owns addition gutter drags while editing', async () => {
    const changedRanges: (SelectedLineRange | null)[] = [];
    const selectedRanges: (SelectedLineRange | null)[] = [];
    const fixture = await createDiffEditorFixture(
      'split',
      'l1\nl2\nl3\nl4\nl5\n',
      'l1\nl2\nl3\nl4\nl5\nl6\n',
      {
        enableLineSelection: true,
        onLineSelected: (range) => selectedRanges.push(range),
        onLineSelectionChange: (range) => changedRanges.push(range),
      }
    );
    let getSelectionStub: { mockRestore(): void } | undefined;
    try {
      // Let the editor's setup and focus frames settle before establishing the
      // selection this gesture must preserve.
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      const { additions } = findCodeColumns(fixture.container);
      const content = additions?.querySelector<HTMLElement>('[data-content]');
      const firstLine = content?.querySelector('[data-line="1"]');
      if (content == null || firstLine == null) {
        throw new Error('missing editor content');
      }
      fixture.editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      content.dispatchEvent(new Event('focus'));
      const editorSelection = fixture.editor.getState().selections;
      getSelectionStub = spyOn(document, 'getSelection').mockReturnValue({
        getComposedRanges: () => [
          {
            startContainer: firstLine,
            startOffset: 0,
            endContainer: firstLine,
            endOffset: 0,
          },
        ],
      } as unknown as Selection);
      const gutterRows = [
        ...(additions?.querySelectorAll(
          '[data-gutter] > [data-column-number]'
        ) ?? []),
      ];
      const second = gutterRows.find(
        (row) => row.getAttribute('data-column-number') === '2'
      );
      const fourth = gutterRows.find(
        (row) => row.getAttribute('data-column-number') === '4'
      );
      if (
        !(second instanceof HTMLElement) ||
        !(fourth instanceof HTMLElement)
      ) {
        throw new Error('missing addition gutter rows');
      }
      fixture.setElementFromPoint(8, 80, fourth);

      second.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 8,
          clientY: 40,
          composed: true,
          pointerId: 32,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual(editorSelection);

      fourth.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 8,
          clientY: 80,
          composed: true,
          pointerId: 32,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      const selectedRange: SelectedLineRange = {
        start: 2,
        end: 4,
        side: 'additions',
      };
      expect(changedRanges.at(-1)).toEqual(selectedRange);
      expect(fixture.editor.getState().selections).toEqual(editorSelection);
      await waitFor(() =>
        arraysEqual(highlightedLineNumbers(additions), [2, 3, 4])
      );
      expect(editorActiveLineNumbers(additions)).toEqual([1]);

      fourth.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: 8,
          clientY: 80,
          composed: true,
          pointerId: 32,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));

      expect(selectedRanges).toEqual([selectedRange]);
      expect(fixture.editor.getState().selections).toEqual(editorSelection);
      expect(highlightedLineNumbers(additions)).toEqual([2, 3, 4]);
      expect(editorActiveLineNumbers(additions)).toEqual([1]);

      // A direct editor interaction ends the protection and allows native
      // selection changes to update the editor again.
      content.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          composed: true,
          pointerType: 'mouse',
        })
      );
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      getSelectionStub?.mockRestore();
      await fixture.cleanup();
    }
  });

  test('line selection does not suppress native sync without an editor selection', async () => {
    const fixture = await createDiffEditorFixture(
      'split',
      'l1\nl2\nl3\n',
      'l1\nl2\nl3\nl4\n',
      { enableLineSelection: true }
    );
    let getSelectionStub: { mockRestore(): void } | undefined;
    try {
      for (let i = 0; i < 5; i++) {
        await wait(0);
      }
      const { additions } = findCodeColumns(fixture.container);
      const content = additions?.querySelector<HTMLElement>('[data-content]');
      const firstLine = content?.querySelector('[data-line="1"]');
      const secondGutter = additions?.querySelector<HTMLElement>(
        '[data-gutter] > [data-column-number="2"]'
      );
      if (content == null || firstLine == null || secondGutter == null) {
        throw new Error('missing editor rows');
      }
      expect(fixture.editor.getState().selections).toBeUndefined();

      getSelectionStub = spyOn(document, 'getSelection').mockReturnValue({
        getComposedRanges: () => [
          {
            startContainer: firstLine,
            startOffset: 0,
            endContainer: firstLine,
            endOffset: 0,
          },
        ],
      } as unknown as Selection);

      content.dispatchEvent(new Event('blur'));
      secondGutter.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          composed: true,
          pointerId: 33,
          pointerType: 'mouse',
        })
      );
      secondGutter.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          composed: true,
          pointerId: 33,
          pointerType: 'mouse',
        })
      );

      content.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('selectionchange'));
      expect(fixture.editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 0,
        },
      ]);
    } finally {
      getSelectionStub?.mockRestore();
      await fixture.cleanup();
    }
  });

  test('editor gutter selection spans addition lines when line selection is disabled', async () => {
    // Five context lines plus one addition give several editable rows whose
    // gutter numbers a drag can span.
    const fixture = await createDiffEditorFixture(
      'split',
      'l1\nl2\nl3\nl4\nl5\n',
      'l1\nl2\nl3\nl4\nl5\nl6\n',
      { enableLineSelection: false }
    );
    try {
      const { additions } = findCodeColumns(fixture.container);
      const gutterRows = [
        ...(additions?.querySelectorAll(
          '[data-gutter] > [data-column-number]'
        ) ?? []),
      ];
      const rowFor = (n: string) =>
        gutterRows.find((g) => g.getAttribute('data-column-number') === n);
      const line2 = rowFor('2');
      const line4 = rowFor('4');
      expect(line2).toBeDefined();
      expect(line4).toBeDefined();

      // Forward drag (line 2 -> line 4): the caret follows the drag end, so the
      // focus line (4) keeps the highlighted gutter number.
      line2?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(additions).length > 0);
      line4?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(additions).includes(4));
      expect(fixture.editor.getState().selections).toEqual([
        {
          start: { line: 1, character: 0 },
          end: { line: 3, character: 2 },
          direction: DirectionForward,
        },
      ]);
      document.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, composed: true })
      );
      await waitFor(() =>
        arraysEqual(editorActiveGutterNumbers(additions), [4])
      );
      expect(editorActiveGutterNumbers(additions)).toEqual([4]);

      // Backward drag (line 4 -> line 2): the anchor line stays selected and the
      // focus line (2) becomes the caret, so its number is the highlighted one.
      line4?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(additions).includes(4));
      line2?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await waitFor(() => editorActiveGutterNumbers(additions).includes(2));
      document.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, composed: true })
      );
      await waitFor(() =>
        arraysEqual(editorActiveGutterNumbers(additions), [2])
      );
      expect(editorActiveGutterNumbers(additions)).toEqual([2]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: copying a selected deleted line writes the deleted text', async () => {
    const fixture = await createDiffEditorFixture('unified', OLD, NEW);
    try {
      const shadow = fixture.container.shadowRoot;
      const deletedGutterNumber = shadow?.querySelector<HTMLElement>(
        "[data-gutter] [data-column-number][data-line-type='change-deletion']"
      );
      const content = shadow?.querySelector<HTMLElement>('[data-content]');
      expect(deletedGutterNumber).not.toBeNull();
      if (content == null) {
        throw new Error('missing content element');
      }

      // Select the deleted line via its gutter number.
      deletedGutterNumber?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () =>
          deletedGutterNumber?.hasAttribute('data-editor-active-line') === true
      );

      // The deleted row lives inside the editor's contentEl (unified view), so a
      // copy event reaches the editor's copy handler. The deleted text isn't in
      // the editor's document, so the handler must copy the selected deleted
      // line's text rather than the empty document selection.
      const writes = dispatchCopy(content);
      const copied = writes.find(([type]) => type === 'text')?.[1] ?? '';
      expect(copied).toBe('import a');
    } finally {
      await fixture.cleanup();
    }
  });

  test('unified: copying a multi-line deletion selection writes every line', async () => {
    // A block of consecutive deletions, so a gutter drag spans several lines.
    const fixture = await createDiffEditorFixture(
      'unified',
      'a\nb\nc\nkeep\n',
      'keep\n'
    );
    try {
      const shadow = fixture.container.shadowRoot;
      const deletedGutterNumbers = [
        ...(shadow?.querySelectorAll<HTMLElement>(
          "[data-gutter] [data-column-number][data-line-type='change-deletion']"
        ) ?? []),
      ];
      const content = shadow?.querySelector<HTMLElement>('[data-content]');
      expect(deletedGutterNumbers.length).toBeGreaterThanOrEqual(3);
      if (content == null) {
        throw new Error('missing content element');
      }
      const first = deletedGutterNumbers[0];
      const last = deletedGutterNumbers[deletedGutterNumbers.length - 1];

      // Drag from the first deleted line number to the last.
      first?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await waitFor(
        () => first?.hasAttribute('data-editor-active-line') === true
      );
      last?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await waitFor(
        () => last?.hasAttribute('data-editor-active-line') === true
      );

      // Each deleted line is a separate read-only host, so the browser's native
      // selection clamps to the first line; the copy must still carry every
      // selected deleted line.
      const writes = dispatchCopy(content);
      const copied = writes.find(([type]) => type === 'text')?.[1] ?? '';
      expect(copied).toBe('a\nb\nc');
    } finally {
      await fixture.cleanup();
    }
  });
});
