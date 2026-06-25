import { afterAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

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

// The 1-based data-line numbers of the content rows in one column that carry
// the active-line highlight (the `data-selected-line` attribute).
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

// The gutter line numbers (data-column-number) carrying the active-line
// highlight. While text is selected only the caret line's number stays
// highlighted; the line background gives way to the selection.
function highlightedGutterNumbers(code: HTMLElement | undefined): number[] {
  if (code == null) {
    return [];
  }
  return [...code.querySelectorAll('[data-column-number][data-selected-line]')]
    .map((el) => Number(el.getAttribute('data-column-number')))
    .sort((a, b) => a - b);
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
  cleanup(): Promise<void>;
}

async function createDiffEditorFixture(
  diffStyle: 'split' | 'unified',
  oldContents: string,
  newContents: string
): Promise<DiffEditorFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const fileDiff = new FileDiff<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    diffStyle,
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
  await wait(10);

  return {
    container,
    editor,
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
      await wait(10);

      const { additions, deletions } = findCodeColumns(fixture.container);
      // The changed addition line ("import x", index 0) renders as data-line 1.
      expect(highlightedLineNumbers(additions)).toEqual([1]);
      // The read-only deletions column must not be highlighted.
      expect(highlightedLineNumbers(deletions)).toEqual([]);
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
      await wait(10);

      const { additions, deletions } = findCodeColumns(fixture.container);
      expect(highlightedLineNumbers(additions)).toEqual([1]);

      // A pointerdown in the read-only deletions column hands the selection to
      // that column (painted natively), so the editor drops its additions-side
      // selection — only one column is selected at a time.
      deletions?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      );
      await wait(10);
      expect(highlightedLineNumbers(additions)).toEqual([]);
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
      await wait(10);

      const { additions, deletions } = findCodeColumns(fixture.container);
      // No line background on either column: the selected text is the
      // line-level highlight instead.
      expect(highlightedLineNumbers(additions)).toEqual([]);
      expect(highlightedLineNumbers(deletions)).toEqual([]);
      // The caret line's gutter number stays highlighted on the additions side.
      expect(highlightedGutterNumbers(additions)).toEqual([1]);
      expect(highlightedGutterNumbers(deletions)).toEqual([]);
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
      await wait(10);

      // A unified diff has a single column, so the additions-only restriction
      // must not suppress the highlight there.
      const { additions } = findCodeColumns(fixture.container);
      expect(highlightedLineNumbers(additions)).toEqual([1]);
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
      await wait(10);
      const { additions } = findCodeColumns(fixture.container);
      expect(highlightedGutterNumbers(additions).length).toBeGreaterThan(0);

      // Pointerdown on the deleted line hands selection to that line: the
      // editor drops its own selection and the deleted-text marker turns on.
      deletedLine?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await wait(10);
      expect(highlightedGutterNumbers(additions)).toEqual([]);
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);

      // Pointerdown back on an editable line turns the marker off, so a normal
      // selection no longer reveals deleted-text selection.
      editableLine?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await wait(10);
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
      await wait(10);
      const { additions } = findCodeColumns(fixture.container);
      expect(highlightedGutterNumbers(additions).length).toBeGreaterThan(0);

      // Clicking the deleted line's gutter number hands selection to that
      // (read-only) line: the editor drops its own selection, the deleted line's
      // own gutter number becomes highlighted (matching an addition click), and
      // the deleted-text marker turns on.
      deletedGutterNumber?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await wait(10);
      expect(deletedGutterNumber?.hasAttribute('data-selected-line')).toBe(
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
      await wait(10);
      expect(first?.hasAttribute('data-selected-line')).toBe(true);

      // Selecting a different deleted line must drop the first one's highlight
      // rather than leave it stale. A deletion selection never changes the
      // editor's own selection range, which is what normally clears these, so
      // the highlight has to be cleared explicitly when the next one starts.
      second?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await wait(10);
      expect(second?.hasAttribute('data-selected-line')).toBe(true);
      expect(first?.hasAttribute('data-selected-line')).toBe(false);
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
      await wait(10);
      focus?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await wait(10);

      // Only the line the drag ended on is highlighted — the same as an
      // addition selection, which highlights just its caret line — not every
      // line in the dragged range.
      expect(highlightedGutterNumbers(deletions)).toEqual([4]);
    } finally {
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
      await wait(10);
      focus?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await wait(10);

      // Only the line the drag ended on stays highlighted (not the anchor, and
      // not every line in the range), and the deleted-text marker reveals the
      // native selection.
      expect(focus?.hasAttribute('data-selected-line')).toBe(true);
      expect(anchor?.hasAttribute('data-selected-line')).toBe(false);
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
      await wait(10);
      expect(deletedGutterNumber?.hasAttribute('data-selected-line')).toBe(
        true
      );
      expect(pre?.hasAttribute('data-deleted-text-selection')).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('dragging across addition line numbers highlights the line the drag ends on', async () => {
    // Five context lines plus one addition give several editable rows whose
    // gutter numbers a drag can span.
    const fixture = await createDiffEditorFixture(
      'split',
      'l1\nl2\nl3\nl4\nl5\n',
      'l1\nl2\nl3\nl4\nl5\nl6\n'
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
      await wait(10);
      line4?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await wait(10);
      document.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, composed: true })
      );
      await wait(10);
      expect(highlightedGutterNumbers(additions)).toEqual([4]);

      // Backward drag (line 4 -> line 2): the anchor line stays selected and the
      // focus line (2) becomes the caret, so its number is the highlighted one.
      line4?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
      await wait(10);
      line2?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await wait(10);
      document.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, composed: true })
      );
      await wait(10);
      expect(highlightedGutterNumbers(additions)).toEqual([2]);
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
      await wait(10);

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
      await wait(10);
      last?.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, composed: true })
      );
      await wait(10);

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
