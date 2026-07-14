import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../../src/components/File';
import { DEFAULT_THEMES } from '../../src/constants';
import { Editor } from '../../src/editor/editor';
import { disposeHighlighter } from '../../src/highlighter/shared_highlighter';
import type { FileContents } from '../../src/types';
import { installDom, wait } from '../domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// Soft-wrap boundary semantics from Atom's display-layer suite, re-expressed
// against pierre-fe's wrap pipeline. Wrap segmentation is driven by the same
// Range-measurement stub editorWrapCaretPosition.test.ts uses: a visual row
// break is reported every `columns` UTF-16 offsets, making #wrapLineText's
// offsets deterministic. Everything the tests observe is real editor output:
// selection state via editor.getState() and overlay geometry via the inline
// width/transform the editor stamps on [data-caret] / [data-selection-range].
//
// Geometry constants under the harness: the stubbed canvas measures every
// ASCII char at 8px (so ch = 8), jsdom computed style leaves lineHeight at its
// 20px default, the gutter has no measured width, and content starts after a
// 1ch pad — so a caret at segment-relative column c on visual row r renders at
// translateX(8 + c*8 - 1) translateY(r*20).
const CH = 8;
const ROW_H = 20;
const CONTENT_X = CH; // gutter (0) + 1ch inline padding
// Vertical step the measurement stub reports between visual rows. Any positive
// value works; #wrapLineText only compares tops for "moved down".
const STUB_ROW_STEP = 16;

function stubRect(left: number, top: number): DOMRect {
  return {
    bottom: top + 1,
    height: 1,
    left,
    right: left + 1,
    top,
    width: 1,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function putBackPrototypeProperty(
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

// Make every logical line wrap after `columns` UTF-16 code units by stubbing
// the two rect sources #wrapLineText reads (jsdom measures nothing itself).
function stubWrapEveryNColumns(columns: number): { restore(): void } {
  const rangeProto = Object.getPrototypeOf(document.createRange()) as object;
  const elementProto = HTMLElement.prototype;
  const savedRangeRect = Object.getOwnPropertyDescriptor(
    rangeProto,
    'getBoundingClientRect'
  );
  const savedElementRect = Object.getOwnPropertyDescriptor(
    elementProto,
    'getBoundingClientRect'
  );

  Object.defineProperty(rangeProto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      const offset = this.startOffset;
      return stubRect(
        (offset % columns) * CH,
        Math.floor(offset / columns) * STUB_ROW_STEP
      );
    },
  });
  Object.defineProperty(elementProto, 'getBoundingClientRect', {
    configurable: true,
    value(): DOMRect {
      return stubRect(0, 0);
    },
  });

  return {
    restore(): void {
      putBackPrototypeProperty(
        rangeProto,
        'getBoundingClientRect',
        savedRangeRect
      );
      putBackPrototypeProperty(
        elementProto,
        'getBoundingClientRect',
        savedElementRect
      );
    },
  };
}

interface WrapHarnessWindow extends Window {
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
}

interface WrapHarness {
  editor: Editor<undefined>;
  root: HTMLElement;
  content: HTMLElement;
  win: WrapHarnessWindow;
  done(): void;
}

async function openWrapped(
  contents: string,
  columns: number
): Promise<WrapHarness> {
  const dom = installDom();
  const wrapStub = stubWrapEveryNColumns(columns);
  const root = document.createElement('div');
  document.body.appendChild(root);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    overflow: 'wrap',
  });
  const editor = new Editor<undefined>();
  const fileContents: FileContents = { name: 'wrapped.ts', contents };

  file.render({ file: fileContents, fileContainer: root, forceRender: true });
  editor.edit(file);

  let content: HTMLElement | undefined;
  for (let attempt = 0; attempt < 20 && content === undefined; attempt++) {
    const candidate = root.shadowRoot?.querySelector('[data-content]');
    if (
      candidate instanceof HTMLElement &&
      (candidate.contentEditable === 'true' ||
        candidate.getAttribute('contenteditable') === 'true')
    ) {
      content = candidate;
    } else {
      await wait(0);
    }
  }
  if (content === undefined) {
    throw new Error('wrap harness: content never became editable');
  }

  return {
    editor,
    root,
    content,
    win: dom.window as unknown as WrapHarnessWindow,
    done(): void {
      wrapStub.restore();
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
  };
}

function placeCaret(h: WrapHarness, line: number, character: number): void {
  h.editor.setSelections([
    {
      start: { line, character },
      end: { line, character },
      direction: 'none',
    },
  ]);
}

function press(h: WrapHarness, key: string): void {
  h.content.dispatchEvent(
    new h.win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key,
    })
  );
}

function caretState(h: WrapHarness): { line: number; character: number } {
  const selection = h.editor.getState().selections?.at(-1);
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
function caretXY(h: WrapHarness): { x: number; y: number } {
  const carets = h.root.shadowRoot?.querySelectorAll('[data-caret]');
  expect(carets?.length).toBe(1);
  return parseTranslate((carets![0] as HTMLElement).style.transform);
}

// Selection rects painted on the overlay, in render order. Rounded-corner mask
// elements (same data attribute, but wrapping a [data-selection-corner] child)
// are cosmetic and excluded.
function selectionRects(
  h: WrapHarness
): { x: number; y: number; width: number }[] {
  const rects: { x: number; y: number; width: number }[] = [];
  h.root.shadowRoot
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

describe('caret affinity at a wrap boundary (atom-legacy)', () => {
  // A 20-char line wrapped every 10 columns. Character 10 is the offset shared
  // by end-of-visual-row-0 and start-of-visual-row-1; Atom disambiguates such
  // positions with an explicit clipDirection, pierre resolves them with a
  // fixed backward affinity (the earlier row wins) in both #getCharX and
  // getSoftLineInfo.
  const TWO_ROW_LINE = 'q0w1e2r3t4y5u6i7o8p9';

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('a caret on the shared wrap offset draws at the end of the earlier visual row', async () => {
    const h = await openWrapped(`${TWO_ROW_LINE}\nnext`, 10);
    try {
      // Calibration: a mid-segment caret proves the wrap branch is live —
      // column 15 is segment-relative column 5 on visual row 1.
      placeCaret(h, 0, 15);
      expect(caretXY(h)).toEqual({ x: colX(5), y: ROW_H });

      // One past the boundary belongs to the continuation row.
      placeCaret(h, 0, 11);
      expect(caretXY(h)).toEqual({ x: colX(1), y: ROW_H });

      // The boundary itself renders on row 0 at the segment's right edge
      // (backward affinity), not at column 0 of row 1.
      placeCaret(h, 0, 10);
      expect(caretXY(h)).toEqual({ x: colX(10), y: 0 });
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('Home and End treat a boundary caret as belonging to the row that ends there', async () => {
    const h = await openWrapped(`${TWO_ROW_LINE}\nnext`, 10);
    try {
      // Home goes to the start of visual row 0; forward affinity would have
      // kept the caret at 10 (already at row 1's start).
      placeCaret(h, 0, 10);
      press(h, 'Home');
      expect(caretState(h)).toEqual({ line: 0, character: 0 });

      // End is a no-op: the caret already sits at row 0's end; forward
      // affinity would have jumped to the line end at 20.
      placeCaret(h, 0, 10);
      press(h, 'End');
      expect(caretState(h)).toEqual({ line: 0, character: 10 });
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('ArrowDown carries a boundary caret from wrap offset to wrap offset', async () => {
    // Three visual rows: [0,10) [10,20) [20,30).
    const h = await openWrapped('wrap_me_at_ten_columns_please!\nnext', 10);
    try {
      placeCaret(h, 0, 10);

      // The boundary caret counts as visual column 10 of row 0, so each step
      // down lands on the next boundary (clamped to the segment end), keeping
      // the caret on row ends all the way to the line end.
      press(h, 'ArrowDown');
      expect(caretState(h)).toEqual({ line: 0, character: 20 });

      press(h, 'ArrowDown');
      expect(caretState(h)).toEqual({ line: 0, character: 30 });
    } finally {
      h.done();
    }
  });
});

describe('vertical motion between wrapped rows and grapheme integrity (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "treats paired characters as atomic units"
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
      const h = await openWrapped(lineText, 4);
      try {
        placeCaret(h, 0, 3);
        press(h, 'ArrowDown');

        const { line, character } = caretState(h);
        expect(line).toBe(0);
        expect(sitsInsideSurrogatePair(lineText, character)).toBe(false);
      } finally {
        h.done();
      }
    }
  );

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "treats paired characters as atomic units"
  // KNOWN BUG: same raw-column arithmetic on the upward path. Crossing the
  // logical-line boundary lands on the wrapped line's last visual row at
  // segment start + 1 = character 5, the low-surrogate half of the trailing
  // astral character.
  test.failing(
    'ArrowUp across a logical-line boundary never lands inside a surrogate pair',
    async () => {
      const lineText = '\u{1F680}mn\u{1F98A}'; // rows: [0,4) '🚀mn', [4,6) '🦊'
      const h = await openWrapped(`${lineText}\nabc`, 4);
      try {
        placeCaret(h, 1, 1);
        press(h, 'ArrowUp');

        const { line, character } = caretState(h);
        expect(line).toBe(0);
        expect(sitsInsideSurrogatePair(lineText, character)).toBe(false);
      } finally {
        h.done();
      }
    }
  );

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('ArrowUp from the line below lands on the last visual row of the wrapped line', async () => {
    // Line 0 wraps into 'the_quick_' / 'brown_fox_' / 'jumps'.
    const h = await openWrapped('the_quick_brown_fox_jumps\ngoal', 10);
    try {
      placeCaret(h, 1, 3);
      press(h, 'ArrowUp');

      // Segment-relative column 3 of the FINAL visual row: 20 + 3 = 23. A
      // logical-column interpretation would have produced character 3.
      expect(caretState(h)).toEqual({ line: 0, character: 23 });
      // And the caret element really renders on the third visual row.
      expect(caretXY(h)).toEqual({ x: colX(3), y: 2 * ROW_H });
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('ArrowUp into a shorter final row keeps the visual column as an overshoot', async () => {
    // DIVERGENCE: Atom clips a screen position past a row's end back to the
    // row boundary, so moving up into a shorter last segment lands at that
    // segment's end (character 25 here). pierre deliberately skips the clamp
    // on the final segment: the selection holds 20 + 8 = 28, three past the
    // line's 25 characters. The overshoot behaves like an implicit goal
    // column — rendering clamps it to the line end, edits would clamp through
    // normalizePosition, and moving back down restores the original column —
    // so it is coherent policy, not corruption.
    const h = await openWrapped('the_quick_brown_fox_jumps\nreturn 0;', 10);
    try {
      placeCaret(h, 1, 8);
      press(h, 'ArrowUp');
      expect(caretState(h)).toEqual({ line: 0, character: 28 });

      // The caret element draws clamped to the line end on the last row.
      expect(caretXY(h)).toEqual({ x: colX(5), y: 2 * ROW_H });

      // Round trip: the overshoot column survives the trip back down.
      press(h, 'ArrowDown');
      expect(caretState(h)).toEqual({ line: 1, character: 8 });
    } finally {
      h.done();
    }
  });
});

describe('hard tabs re-expand from each continuation row start (atom-legacy)', () => {
  // 'zzzzz' fills visual row 0 exactly (wrap column 5, odd on purpose); the
  // continuation row is 'f\tgh'. With tabSize 2 the tab's stop depends on
  // which left edge tab expansion starts from: from the segment start the tab
  // sits at segment column 1 and advances 1 column (to the stop at 2); from
  // the logical line start it would sit at column 6 and advance 2 (to the
  // stop at 8). The two schemes disagree on every x after the tab.
  const TABBED_LINE = 'zzzzzf\tgh';

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "re-expands tabs on soft-wrapped lines"
  test('caret x after a tab on a continuation row uses tab stops from the segment edge', async () => {
    const h = await openWrapped(TABBED_LINE, 5);
    try {
      // Caret right after the tab: segment prefix 'f\t' spans 2 columns
      // (logical-line expansion would make it 3).
      placeCaret(h, 0, 7);
      expect(caretXY(h)).toEqual({ x: colX(2), y: ROW_H });

      // Caret after 'g': 3 segment columns (logical-line expansion: 4).
      placeCaret(h, 0, 8);
      expect(caretXY(h)).toEqual({ x: colX(3), y: ROW_H });
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "expands hard tabs on soft-wrapped line segments"
  test('selection width over a tab on a continuation row matches segment tab stops', async () => {
    const h = await openWrapped(TABBED_LINE, 5);
    try {
      // Select 'f\tg' — the continuation row from its first character.
      h.editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 8 },
          direction: 'forward',
        },
      ]);

      // One rect on visual row 1, starting at the content edge, 3 columns
      // wide (tab expanded from the segment start).
      expect(selectionRects(h)).toEqual([
        { x: CONTENT_X, y: ROW_H, width: 3 * CH },
      ]);
    } finally {
      h.done();
    }
  });
});

describe('selection endpoints on wrap offsets (atom-legacy)', () => {
  // Scope note: rect painting is asserted through the overlay divs' inline
  // width/transform — the geometry the editor computes — rather than painted
  // pixels, which jsdom cannot produce.
  const TWO_ROW_LINE = 'q0w1e2r3t4y5u6i7o8p9';

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('a selection ending exactly on the wrap offset paints flush to the row edge with no sliver below', async () => {
    const h = await openWrapped(`${TWO_ROW_LINE}\nnext`, 10);
    try {
      h.editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 10 },
          direction: 'forward',
        },
      ]);

      // Exactly one rect: columns 2..10 of visual row 0. The zero-width slice
      // the segment loop computes at the start of row 1 must be dropped, not
      // painted as a sliver.
      const rects = selectionRects(h);
      expect(rects).toEqual([{ x: CONTENT_X + 2 * CH, y: 0, width: 8 * CH }]);
      // Right edge lands exactly on the wrap boundary's x.
      expect(rects[0].x + rects[0].width).toBe(CONTENT_X + 10 * CH);
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('a selection starting exactly on the wrap offset paints only on the continuation row', async () => {
    const h = await openWrapped(`${TWO_ROW_LINE}\nnext`, 10);
    try {
      h.editor.setSelections([
        {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 14 },
          direction: 'forward',
        },
      ]);

      // No zero-width rect at the end of row 0; the selection begins at the
      // continuation row's left content edge.
      expect(selectionRects(h)).toEqual([
        { x: CONTENT_X, y: ROW_H, width: 4 * CH },
      ]);
    } finally {
      h.done();
    }
  });

  // atom-legacy: atom-text-buffer/spec/display-layer-spec.js — "translates points correctly on soft-wrapped lines"
  test('a boundary-spanning selection paints exactly one rect per visual row', async () => {
    const h = await openWrapped(`${TWO_ROW_LINE}\nnext`, 10);
    try {
      h.editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 15 },
          direction: 'forward',
        },
      ]);

      // Row 0 carries columns 2..10 flush to the wrap edge (no end padding on
      // an intermediate segment); row 1 carries columns 0..5 from the content
      // edge. No third rect and no zero-width boundary artifacts.
      expect(selectionRects(h)).toEqual([
        { x: CONTENT_X + 2 * CH, y: 0, width: 8 * CH },
        { x: CONTENT_X, y: ROW_H, width: 5 * CH },
      ]);
    } finally {
      h.done();
    }
  });
});
