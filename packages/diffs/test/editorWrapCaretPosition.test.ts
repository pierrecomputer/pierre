import { afterAll, describe, expect, test } from 'bun:test';

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

interface EditorTestWindow extends Window {
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
}

// Height the test uses for a single visual row. Deliberately not the editor's
// default 20px line height: the caret's y must come from the measured line
// offsetTop, so a distinct value proves it is not coincidentally matching a
// fixed lineHeight multiple.
const ROW = 23;

function rect(left: number, top: number, width = 1, height = 1): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

// jsdom performs no layout, so every element.offsetTop is 0 and the wrap-induced
// vertical shift this test exercises would be invisible. Install a getter that
// reports each rendered row's top from a layout map the test controls, keyed by
// the 1-based data-line attribute the editor stamps on each line element.
// Elements without a mapped data-line (e.g. the content wrapper) keep offsetTop
// 0, matching their jsdom default.
function installLineLayout(): {
  setLineTop(lineIndex: number, top: number): void;
  restore(): void;
} {
  const tops = new Map<string, number>();
  // installDom() has already pointed the global HTMLElement at this jsdom
  // window, so patching the global prototype patches the rendered line elements.
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement): number {
      const dataLine = this.getAttribute?.('data-line');
      if (dataLine != null && tops.has(dataLine)) {
        return tops.get(dataLine)!;
      }
      return 0;
    },
  });
  return {
    setLineTop(lineIndex: number, top: number): void {
      tops.set(String(lineIndex + 1), top);
    },
    restore(): void {
      if (original !== undefined) {
        Object.defineProperty(proto, 'offsetTop', original);
      } else {
        Object.defineProperty(proto, 'offsetTop', {
          configurable: true,
          get: () => 0,
        });
      }
    },
  };
}

function restorePrototypeProperty(
  proto: object,
  property: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor !== undefined) {
    Object.defineProperty(proto, property, descriptor);
  } else {
    Reflect.deleteProperty(proto, property);
  }
}

// #wrapLineText detects visual row starts by checking when a Range's top moves
// downward. jsdom does not measure ranges, so this harness reports a new top
// every `columns` UTF-16 offsets, making wrap offsets deterministic.
function installWrapMeasurement(columns: number): { restore(): void } {
  const rangeProto = Object.getPrototypeOf(document.createRange()) as object;
  const elementProto = HTMLElement.prototype;
  const originalRangeRect = Object.getOwnPropertyDescriptor(
    rangeProto,
    'getBoundingClientRect'
  );
  const originalElementRect = Object.getOwnPropertyDescriptor(
    elementProto,
    'getBoundingClientRect'
  );

  Object.defineProperty(rangeProto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      const offset = this.startOffset;
      return rect((offset % columns) * 8, Math.floor(offset / columns) * ROW);
    },
  });
  Object.defineProperty(elementProto, 'getBoundingClientRect', {
    configurable: true,
    value(): DOMRect {
      return rect(0, 0, columns * 8, ROW);
    },
  });

  return {
    restore(): void {
      restorePrototypeProperty(
        rangeProto,
        'getBoundingClientRect',
        originalRangeRect
      );
      restorePrototypeProperty(
        elementProto,
        'getBoundingClientRect',
        originalElementRect
      );
    },
  };
}

function caretTranslateY(container: HTMLElement): number {
  const caret = container.shadowRoot?.querySelector('[data-caret]');
  if (!(caret instanceof HTMLElement)) {
    throw new Error('no caret element rendered');
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(caret.style.transform);
  if (match === null) {
    throw new Error(`caret has no translateY: ${caret.style.transform}`);
  }
  return parseFloat(match[1]);
}

function caretAt(line: number) {
  return [
    {
      start: { line, character: 0 },
      end: { line, character: 0 },
      direction: 'none' as const,
    },
  ];
}

async function createWrapEditor(
  contents: string,
  wrapColumns: number
): Promise<{
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  fileContainer: HTMLElement;
  window: EditorTestWindow;
}> {
  const dom = installDom();
  const wrapMeasurement = installWrapMeasurement(wrapColumns);
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    overflow: 'wrap',
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = {
    name: 'wrap.ts',
    contents,
  };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);
  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup(): void {
      wrapMeasurement.restore();
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    editor,
    fileContainer,
    window: dom.window as unknown as EditorTestWindow,
  };
}

function dispatchMovementKey(
  window: EditorTestWindow,
  content: HTMLElement,
  init: KeyboardEventInit & { key: string }
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  content.dispatchEvent(event);
  return event;
}

function setCaret(editor: Editor<undefined>, line: number, character: number) {
  editor.setSelections([
    {
      start: { line, character },
      end: { line, character },
      direction: 'none',
    },
  ]);
}

function expectCaret(
  editor: Editor<undefined>,
  line: number,
  character: number
): void {
  const selection = editor.getState().selections?.at(-1);
  expect(selection?.start).toEqual({ line, character });
  expect(selection?.end).toEqual({ line, character });
}

// Reads back the current caret position rather than asserting it, for tests
// that need to inspect the actual landing spot (e.g. surrogate-pair checks).
function caretState(editor: Editor<undefined>): {
  line: number;
  character: number;
} {
  const selection = editor.getState().selections?.at(-1);
  if (selection === undefined) {
    throw new Error('no selection in editor state');
  }
  expect(selection.start).toEqual(selection.end);
  return { line: selection.start.line, character: selection.start.character };
}

function parseTranslate(transform: string): { x: number; y: number } {
  const match = /translateX\((-?[\d.]+)px\) translateY\((-?[\d.]+)px\)/.exec(
    transform
  );
  if (match === null) {
    throw new Error(`unparseable transform: ${transform}`);
  }
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

// The rendered caret's overlay position. Exactly one caret is expected.
function caretXY(container: HTMLElement): { x: number; y: number } {
  const carets = container.shadowRoot?.querySelectorAll('[data-caret]');
  expect(carets?.length).toBe(1);
  return parseTranslate((carets![0] as HTMLElement).style.transform);
}

// Selection rects painted on the overlay, in render order. Rounded-corner mask
// elements (same data attribute, but wrapping a [data-selection-corner] child)
// are cosmetic and excluded.
function selectionRects(
  container: HTMLElement
): { x: number; y: number; width: number }[] {
  const rects: { x: number; y: number; width: number }[] = [];
  container.shadowRoot
    ?.querySelectorAll('[data-selection-range]')
    .forEach((el) => {
      const rangeEl = el as HTMLElement;
      if (rangeEl.querySelector('[data-selection-corner]') !== null) {
        return;
      }
      const { x, y } = parseTranslate(rangeEl.style.transform);
      rects.push({ x, y, width: parseFloat(rangeEl.style.width) });
    });
  return rects;
}

// Geometry constants for the caret/selection assertions below. The stubbed
// canvas measures every ASCII char at 8px (so ch = 8), jsdom computed style
// leaves lineHeight at its 20px default, the gutter has no measured width, and
// content starts after a 1ch pad — so a caret at segment-relative column c on
// visual row r renders at translateX(8 + c*8 - 1) translateY(r*20).
const CH = 8;
const ROW_H = 20;
const CONTENT_X = CH; // gutter (0) + 1ch inline padding

// Expected caret translateX for segment-relative column `col` (caret draws
// 1px left of the character edge).
function colX(col: number): number {
  return CONTENT_X + col * CH - 1;
}

const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function sitsInsideSurrogatePair(lineText: string, character: number): boolean {
  const unit = lineText.charCodeAt(character);
  return unit >= LOW_SURROGATE_MIN && unit <= LOW_SURROGATE_MAX;
}

describe('editor wrap caret position', () => {
  test('arrow keys move through wrapped visual rows before changing logical lines', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      '012345678901234567890123456789\nshort',
      10
    );

    try {
      setCaret(editor, 0, 15);

      const downWithinLine = dispatchMovementKey(window, content, {
        key: 'ArrowDown',
      });
      expect(downWithinLine.defaultPrevented).toBe(true);
      expectCaret(editor, 0, 25);

      dispatchMovementKey(window, content, { key: 'ArrowUp' });
      expectCaret(editor, 0, 15);

      setCaret(editor, 0, 25);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 1, 5);
    } finally {
      cleanup();
    }
  });

  test('line-boundary shortcuts use wrapped visual row boundaries', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      '  abcdefghij  klmnop',
      12
    );

    try {
      setCaret(editor, 0, 16);

      const commandLeft = dispatchMovementKey(window, content, {
        key: 'ArrowLeft',
        metaKey: true,
      });
      expect(commandLeft.defaultPrevented).toBe(true);
      expectCaret(editor, 0, 14);

      dispatchMovementKey(window, content, {
        key: 'ArrowLeft',
        metaKey: true,
      });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, {
        key: 'ArrowRight',
        metaKey: true,
      });
      expectCaret(editor, 0, 20);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'a', ctrlKey: true });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'e', ctrlKey: true });
      expectCaret(editor, 0, 20);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, 20);
    } finally {
      cleanup();
    }
  });

  test('wrap navigation keeps NFD combining marks with their base character', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      'e\u0301x',
      1
    );

    try {
      setCaret(editor, 0, 0);

      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 2);
    } finally {
      cleanup();
    }
  });

  // When word wrap is on, growing a line until it wraps onto a second visual
  // row keeps the logical line count unchanged (change.lineDelta === 0) but
  // pushes every following line down by a row. The cached line-Y positions of
  // those downstream lines must be invalidated so the caret/selection overlays
  // stay aligned; otherwise they render a row too high, on the wrapped line's
  // continuation row.
  test('re-measures downstream line Y after a wrap-height-changing edit', async () => {
    const dom = installDom();
    const layout = installLineLayout();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);

    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      overflow: 'wrap',
    });
    const editor = new Editor<undefined>();
    const initialFile: FileContents = {
      name: 'wrap.ts',
      contents: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;',
    };

    file.render({ file: initialFile, fileContainer, forceRender: true });
    editor.edit(file);
    await waitForEditableContent(fileContainer);

    try {
      // Initial layout: each logical line occupies exactly one visual row.
      for (let i = 0; i < 4; i++) {
        layout.setLineTop(i, i * ROW);
      }

      // Cache line 2's Y while line 0 is still a single row.
      editor.setSelections(caretAt(2));
      const beforeY = caretTranslateY(fileContainer);

      // Line 0 grows long enough to wrap onto a second visual row, pushing
      // lines 1..3 down by one row. Reflect that in the layout map, then apply
      // the edit so #applyChange runs with lineDelta === 0 (no new logical
      // line) — the case the stale-cache bug missed.
      for (let i = 1; i < 4; i++) {
        layout.setLineTop(i, i * ROW + ROW);
      }
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 12 },
          },
          newText: ' // padded out until this line wraps onto a second row',
        },
      ]);
      await wait(0);

      // Re-render the caret on line 2 and read its new Y.
      editor.setSelections(caretAt(2));
      const afterY = caretTranslateY(fileContainer);

      // Line 2 dropped exactly one row when line 0 wrapped, so the caret must
      // follow. Before the fix the stale #lineYCache left afterY === beforeY.
      expect(afterY - beforeY).toBe(ROW);
    } finally {
      layout.restore();
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    }
  });
});

describe('caret affinity at a wrap boundary', () => {
  // A 20-char line wrapped every 10 columns. Character 10 is the offset shared
  // by end-of-visual-row-0 and start-of-visual-row-1; such positions could be
  // disambiguated with an explicit clip-direction flag, but pierre resolves
  // them with a fixed backward affinity (the earlier row wins) in both
  // #getCharX and getSoftLineInfo.
  const TWO_ROW_LINE = 'q0w1e2r3t4y5u6i7o8p9';

  test('a caret on the shared wrap offset draws at the end of the earlier visual row', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      `${TWO_ROW_LINE}\nnext`,
      10
    );
    try {
      // Calibration: a mid-segment caret proves the wrap branch is live —
      // column 15 is segment-relative column 5 on visual row 1.
      setCaret(editor, 0, 15);
      expect(caretXY(fileContainer)).toEqual({ x: colX(5), y: ROW_H });

      // One past the boundary belongs to the continuation row.
      setCaret(editor, 0, 11);
      expect(caretXY(fileContainer)).toEqual({ x: colX(1), y: ROW_H });

      // The boundary itself renders on row 0 at the segment's right edge
      // (backward affinity), not at column 0 of row 1.
      setCaret(editor, 0, 10);
      expect(caretXY(fileContainer)).toEqual({ x: colX(10), y: 0 });
    } finally {
      cleanup();
    }
  });

  test('Home and End treat a boundary caret as belonging to the row that ends there', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      `${TWO_ROW_LINE}\nnext`,
      10
    );
    try {
      // Home goes to the start of visual row 0; forward affinity would have
      // kept the caret at 10 (already at row 1's start).
      setCaret(editor, 0, 10);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, 0);

      // End is a no-op: the caret already sits at row 0's end; forward
      // affinity would have jumped to the line end at 20.
      setCaret(editor, 0, 10);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, 10);
    } finally {
      cleanup();
    }
  });

  test('ArrowDown carries a boundary caret from wrap offset to wrap offset', async () => {
    // Three visual rows: [0,10) [10,20) [20,30).
    const { cleanup, content, editor, window } = await createWrapEditor(
      'wrap_me_at_ten_columns_please!\nnext',
      10
    );
    try {
      setCaret(editor, 0, 10);

      // The boundary caret counts as visual column 10 of row 0, so each step
      // down lands on the next boundary (clamped to the segment end), keeping
      // the caret on row ends all the way to the line end.
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 20);

      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 30);
    } finally {
      cleanup();
    }
  });
});

describe('vertical motion between wrapped rows and grapheme integrity', () => {
  // KNOWN BUG: moveBySoftLine computes the landing spot as target-segment
  // start + visual column in raw UTF-16 units with no grapheme/surrogate
  // snapping, so ArrowDown here parks the caret at character 7 — between the
  // halves of the second astral character. A subsequent insert at that caret
  // splits the pair into lone surrogates (verified against TextDocument:
  // inserting "x" at (0,7) leaves \ud83d x \ude00 in the buffer).
  test.failing(
    'ArrowDown into a continuation row never lands inside a surrogate pair',
    async () => {
      const astralRow = '\u{1F680}\u{1F98A}'; // 2 astral chars = 4 UTF-16 units
      const lineText = `wxyz${astralRow}`;
      // Visual rows: [0,4) 'wxyz' and [4,8) with both astral characters.
      const { cleanup, content, editor, window } = await createWrapEditor(
        lineText,
        4
      );
      try {
        setCaret(editor, 0, 3);
        dispatchMovementKey(window, content, { key: 'ArrowDown' });

        const { line, character } = caretState(editor);
        expect(line).toBe(0);
        expect(sitsInsideSurrogatePair(lineText, character)).toBe(false);
      } finally {
        cleanup();
      }
    }
  );

  // KNOWN BUG: same raw-column arithmetic on the upward path. Crossing the
  // logical-line boundary lands on the wrapped line's last visual row at
  // segment start + 1 = character 5, the low-surrogate half of the trailing
  // astral character.
  test.failing(
    'ArrowUp across a logical-line boundary never lands inside a surrogate pair',
    async () => {
      const lineText = '\u{1F680}mn\u{1F98A}'; // rows: [0,4) '🚀mn', [4,6) '🦊'
      const { cleanup, content, editor, window } = await createWrapEditor(
        `${lineText}\nabc`,
        4
      );
      try {
        setCaret(editor, 1, 1);
        dispatchMovementKey(window, content, { key: 'ArrowUp' });

        const { line, character } = caretState(editor);
        expect(line).toBe(0);
        expect(sitsInsideSurrogatePair(lineText, character)).toBe(false);
      } finally {
        cleanup();
      }
    }
  );

  test('ArrowUp from the line below lands on the last visual row of the wrapped line', async () => {
    // Line 0 wraps into 'the_quick_' / 'brown_fox_' / 'jumps'.
    const { cleanup, content, editor, fileContainer, window } =
      await createWrapEditor('the_quick_brown_fox_jumps\ngoal', 10);
    try {
      setCaret(editor, 1, 3);
      dispatchMovementKey(window, content, { key: 'ArrowUp' });

      // Segment-relative column 3 of the FINAL visual row: 20 + 3 = 23. A
      // logical-column interpretation would have produced character 3.
      expectCaret(editor, 0, 23);
      // And the caret element really renders on the third visual row.
      expect(caretXY(fileContainer)).toEqual({ x: colX(3), y: 2 * ROW_H });
    } finally {
      cleanup();
    }
  });

  test('ArrowUp into a shorter final row keeps the visual column as an overshoot', async () => {
    // DIVERGENCE: the conventional behavior clips a screen position past a
    // row's end back to the row boundary, so moving up into a shorter last
    // segment lands at that segment's end (character 25 here). pierre
    // deliberately skips the clamp on the final segment: the selection holds
    // 20 + 8 = 28, three past the line's 25 characters. The overshoot behaves
    // like an implicit goal column — rendering clamps it to the line end,
    // edits would clamp through normalizePosition, and moving back down
    // restores the original column — so it is coherent policy, not
    // corruption.
    const { cleanup, content, editor, fileContainer, window } =
      await createWrapEditor('the_quick_brown_fox_jumps\nreturn 0;', 10);
    try {
      setCaret(editor, 1, 8);
      dispatchMovementKey(window, content, { key: 'ArrowUp' });
      expectCaret(editor, 0, 28);

      // The caret element draws clamped to the line end on the last row.
      expect(caretXY(fileContainer)).toEqual({ x: colX(5), y: 2 * ROW_H });

      // Round trip: the overshoot column survives the trip back down.
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 1, 8);
    } finally {
      cleanup();
    }
  });
});

describe('hard tabs re-expand from each continuation row start', () => {
  // 'zzzzz' fills visual row 0 exactly (wrap column 5, odd on purpose); the
  // continuation row is 'f\tgh'. With tabSize 2 the tab's stop depends on
  // which left edge tab expansion starts from: from the segment start the tab
  // sits at segment column 1 and advances 1 column (to the stop at 2); from
  // the logical line start it would sit at column 6 and advance 2 (to the
  // stop at 8). The two schemes disagree on every x after the tab.
  const TABBED_LINE = 'zzzzzf\tgh';

  test('caret x after a tab on a continuation row uses tab stops from the segment edge', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      TABBED_LINE,
      5
    );
    try {
      // Caret right after the tab: segment prefix 'f\t' spans 2 columns
      // (logical-line expansion would make it 3).
      setCaret(editor, 0, 7);
      expect(caretXY(fileContainer)).toEqual({ x: colX(2), y: ROW_H });

      // Caret after 'g': 3 segment columns (logical-line expansion: 4).
      setCaret(editor, 0, 8);
      expect(caretXY(fileContainer)).toEqual({ x: colX(3), y: ROW_H });
    } finally {
      cleanup();
    }
  });

  test('selection width over a tab on a continuation row matches segment tab stops', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      TABBED_LINE,
      5
    );
    try {
      // Select 'f\tg' — the continuation row from its first character.
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 8 },
          direction: 'forward',
        },
      ]);

      // One rect on visual row 1, starting at the content edge, 3 columns
      // wide (tab expanded from the segment start).
      expect(selectionRects(fileContainer)).toEqual([
        { x: CONTENT_X, y: ROW_H, width: 3 * CH },
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('selection endpoints on wrap offsets', () => {
  // Scope note: rect painting is asserted through the overlay divs' inline
  // width/transform — the geometry the editor computes — rather than painted
  // pixels, which jsdom cannot produce.
  const TWO_ROW_LINE = 'q0w1e2r3t4y5u6i7o8p9';

  test('a selection ending exactly on the wrap offset paints flush to the row edge with no sliver below', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      `${TWO_ROW_LINE}\nnext`,
      10
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 10 },
          direction: 'forward',
        },
      ]);

      // Exactly one rect: columns 2..10 of visual row 0. The zero-width slice
      // the segment loop computes at the start of row 1 must be dropped, not
      // painted as a sliver.
      const rects = selectionRects(fileContainer);
      expect(rects).toEqual([{ x: CONTENT_X + 2 * CH, y: 0, width: 8 * CH }]);
      // Right edge lands exactly on the wrap boundary's x.
      expect(rects[0].x + rects[0].width).toBe(CONTENT_X + 10 * CH);
    } finally {
      cleanup();
    }
  });

  test('a selection starting exactly on the wrap offset paints only on the continuation row', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      `${TWO_ROW_LINE}\nnext`,
      10
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 14 },
          direction: 'forward',
        },
      ]);

      // No zero-width rect at the end of row 0; the selection begins at the
      // continuation row's left content edge.
      expect(selectionRects(fileContainer)).toEqual([
        { x: CONTENT_X, y: ROW_H, width: 4 * CH },
      ]);
    } finally {
      cleanup();
    }
  });

  test('a boundary-spanning selection paints exactly one rect per visual row', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      `${TWO_ROW_LINE}\nnext`,
      10
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 15 },
          direction: 'forward',
        },
      ]);

      // Row 0 carries columns 2..10 flush to the wrap edge (no end padding on
      // an intermediate segment); row 1 carries columns 0..5 from the content
      // edge. No third rect and no zero-width boundary artifacts.
      expect(selectionRects(fileContainer)).toEqual([
        { x: CONTENT_X + 2 * CH, y: 0, width: 8 * CH },
        { x: CONTENT_X, y: ROW_H, width: 5 * CH },
      ]);
    } finally {
      cleanup();
    }
  });
});
