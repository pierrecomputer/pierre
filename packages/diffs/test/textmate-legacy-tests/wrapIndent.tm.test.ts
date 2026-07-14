// textmate-legacy-tests — block indent over blank lines, soft-break placement
// around whitespace runs, and double-width CJK wrap arithmetic.
//
// See ./README.md for provenance and licensing: scenarios were re-expressed
// from plain-language audit notes; every fixture and assertion here is
// original and pins @pierre/diffs' own behavior.
//
// The wrap tests drive the real Editor through the jsdom harness. pierre-fe
// delegates soft-break *placement* to CSS (`white-space: pre-wrap;
// word-break: break-word` on the measurement div in editor.ts #wrapLineText)
// and only *detects* where the browser broke each line by watching Range
// tops. jsdom performs no layout, so `installLayoutWrapMeasurement` emulates
// the browser's greedy word wrap — trailing spaces hang past the wrap column
// instead of opening a new row, and words longer than a row break mid-word —
// with a per-character width function (1 column for ASCII, 2 for CJK). What
// the tests then assert is pierre-fe's own downstream arithmetic: wrap-offset
// detection, visual-row/x caret placement (#getCharX), and soft-line
// Home/End/ArrowDown mapping (selection.ts getSoftLineInfo/moveBySoftLine).

import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../../src/components/File';
import { DEFAULT_THEMES } from '../../src/constants';
import { Editor } from '../../src/editor/editor';
import {
  DirectionForward,
  resolveIndentEdits,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import { disposeHighlighter } from '../../src/highlighter/shared_highlighter';
import type { EditorSelection, FileContents } from '../../src/types';
import { installDom, wait } from '../domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function sel(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionForward,
  };
}

// Runs one indent/outdent the way the Editor's 'indentMore'/'indentLess'
// dispatch does: resolve the edits for the selection, apply them as a single
// batch, and return the remapped selection.
function runIndent(
  d: ReturnType<typeof doc>,
  selection: EditorSelection,
  tabSize: number,
  outdent: boolean
): EditorSelection {
  const [edits, nextSelection] = resolveIndentEdits(
    d,
    selection,
    tabSize,
    outdent
  );
  d.applyEdits(edits, true, [selection]);
  return nextSelection;
}

describe('block indent over blank and whitespace-only lines (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/editor/src/transform.cc — shifting a
  // multi-line block right adds the indent unit only to lines that have
  // non-whitespace content; empty and whitespace-only lines inside the block
  // stay byte-identical.
  //
  // KNOWN BUG: resolveIndentEdits inserts the indent unit on every line of
  // the block, including the empty line and the whitespace-only line. A
  // single block indent therefore injects trailing whitespace on lines the
  // user never touched — exactly the noise linters, `git diff` whitespace
  // checks, and pre-commit hooks flag — and the caret gains nothing from it
  // because those lines have no content to align. Judged bug rather than
  // divergence: silently dirtying untouched lines is a data-hygiene defect,
  // not an alternative convention.
  test.failing(
    'indent adds the unit only to content lines, leaving blank and whitespace-only lines byte-identical',
    () => {
      const d = doc('alpha\n\n  \nbravo');
      const selection = sel(0, 0, 3, 5);

      const next = runIndent(d, selection, 4, false);

      // Content lines gain one 4-space unit; line 1 (empty) and line 2 (two
      // spaces only) must come back byte-identical.
      expect(d.getText()).toBe('    alpha\n\n  \n    bravo');
      expect(d.getLineText(1)).toBe('');
      expect(d.getLineText(2)).toBe('  ');

      // The selection still tracks the indented content lines.
      expect(next.start).toEqual({ line: 0, character: 4 });
      expect(next.end).toEqual({ line: 3, character: 9 });
    }
  );

  // textmate-legacy: Frameworks/editor/src/transform.cc — outdent across the
  // same content/empty/whitespace-only mix. The scenario only constrains the
  // indent direction, so this pins pierre-fe's actual outdent behavior: one
  // unit is removed from every line that has leading whitespace — including
  // the whitespace-only line, which moves it *toward* cleanliness — and the
  // truly empty line produces no edit at all.
  test('outdent trims content and whitespace-only lines by one unit and skips the empty line', () => {
    const d = doc('    alpha\n\n      \n    bravo');
    const selection = sel(0, 0, 3, 9);

    const [edits, next] = resolveIndentEdits(d, selection, 4, true);

    // No edit targets line 1: outdent never touches a line with nothing to
    // remove (no zero-length churn edits).
    expect(edits.map((edit) => edit.range.start.line)).toEqual([0, 2, 3]);

    d.applyEdits(edits, true, [selection]);
    expect(d.getText()).toBe('alpha\n\n  \nbravo');
    expect(next.start).toEqual({ line: 0, character: 0 });
    expect(next.end).toEqual({ line: 3, character: 5 });
  });

  // textmate-legacy: Frameworks/editor/src/transform.cc — indent followed by
  // outdent over the same block restores the original bytes. This bounds the
  // blast radius of the known bug above: the whitespace injected on blank
  // lines by a single indent is removed again by the matching outdent, so
  // only a net indent leaves stray trailing whitespace behind.
  test('indent then outdent round-trips the mixed block back to identical text', () => {
    const original = 'alpha\n\n  \nbravo';
    const d = doc(original);
    const selection = sel(0, 0, 3, 5);

    const afterIndent = runIndent(d, selection, 4, false);
    const afterOutdent = runIndent(d, afterIndent, 4, true);

    expect(d.getText()).toBe(original);
    expect(afterOutdent.start).toEqual({ line: 0, character: 0 });
    expect(afterOutdent.end).toEqual({ line: 3, character: 5 });
  });
});

// ---------------------------------------------------------------------------
// Soft-wrap harness (see file header). Modeled on editorWrapCaretPosition's
// createWrapEditor, with the fixed-columns Range stub replaced by a
// width-aware layout emulating hanging trailing spaces.
// ---------------------------------------------------------------------------

// Vertical distance the Range stub reports between visual rows. Deliberately
// not the editor's 20px lineHeight: #wrapLineText only compares tops for
// "moved down", so caret translateY asserted below must come from
// wrapRow * lineHeight, not from this stub value leaking through.
const STUB_ROW_TOP = 100;

// Width the default domHarness canvas stub gives every ASCII character, and
// therefore Metrics.ch ('0' measures 8px).
const CH = 8;
const CJK_CH = 2 * CH;

const isCjkCodePoint = (codePoint: number) =>
  codePoint >= 0x4e00 && codePoint <= 0x9fff;

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

interface OffsetLayout {
  cols: number[];
  rows: number[];
}

// CSS-like greedy word wrap in column units. Spaces never open a new row:
// a run of spaces after a word hangs past the wrap column (the pre-wrap
// hanging-whitespace rule), so the next row always starts at a non-space
// character. A word that fits on a row but not after the current column
// wraps whole; a word wider than a full row breaks mid-word (break-word).
function layoutText(
  text: string,
  columns: number,
  widthOf: (codePoint: number) => number
): OffsetLayout {
  const rows: number[] = new Array<number>(text.length);
  const cols: number[] = new Array<number>(text.length);
  let row = 0;
  let col = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === ' ') {
      rows[i] = row;
      cols[i] = col;
      col += 1;
      i++;
      continue;
    }
    let j = i;
    let wordWidth = 0;
    while (j < text.length && text[j] !== ' ') {
      wordWidth += widthOf(text.codePointAt(j)!);
      j++;
    }
    if (col > 0 && col + wordWidth > columns && wordWidth <= columns) {
      row++;
      col = 0;
    }
    for (let k = i; k < j; k++) {
      const charWidth = widthOf(text.codePointAt(k)!);
      if (col > 0 && col + charWidth > columns) {
        row++;
        col = 0;
      }
      rows[k] = row;
      cols[k] = col;
      col += charWidth;
    }
    i = j;
  }
  return { cols, rows };
}

// #wrapLineText detects visual row starts by watching a Range's top move
// downward. Report each offset's (row, col) from the layout above; the text
// under measurement is read straight off the Range's Text node.
function installLayoutWrapMeasurement(
  columns: number,
  widthOf: (codePoint: number) => number
): { restore(): void } {
  const rangeProto = Object.getPrototypeOf(document.createRange()) as object;
  const original = Object.getOwnPropertyDescriptor(
    rangeProto,
    'getBoundingClientRect'
  );
  const layouts = new Map<string, OffsetLayout>();
  const layoutFor = (text: string): OffsetLayout => {
    let layout = layouts.get(text);
    if (layout === undefined) {
      layout = layoutText(text, columns, widthOf);
      layouts.set(text, layout);
    }
    return layout;
  };

  Object.defineProperty(rangeProto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      const text = this.startContainer.textContent ?? '';
      const offset = this.startOffset;
      if (text.length === 0 || offset >= text.length) {
        return rect(0, 0);
      }
      const layout = layoutFor(text);
      return rect(
        layout.cols[offset] * CH,
        layout.rows[offset] * STUB_ROW_TOP
      );
    },
  });

  return {
    restore(): void {
      if (original !== undefined) {
        Object.defineProperty(rangeProto, 'getBoundingClientRect', original);
      } else {
        Reflect.deleteProperty(rangeProto, 'getBoundingClientRect');
      }
    },
  };
}

// Canvas measurement matching the layout widths: ASCII 1ch, CJK 2ch. Drives
// Metrics.measureTextWidth, which #getCharX uses for caret x on CJK rows.
function stubCjkCanvasTextWidth(): void {
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: (contextId: string) =>
      contextId === '2d'
        ? {
            font: '',
            measureText: (text: string) => {
              let width = 0;
              for (const char of text) {
                width += isCjkCodePoint(char.codePointAt(0)!) ? CJK_CH : CH;
              }
              return { width };
            },
          }
        : null,
  });
}

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

async function createWrapEditor(
  contents: string,
  wrapColumns: number,
  options: { cjkWidths?: boolean } = {}
): Promise<{
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  fileContainer: HTMLElement;
  window: EditorTestWindow;
}> {
  const dom = installDom();
  if (options.cjkWidths === true) {
    // Must be installed before the first render: Metrics.init grabs the 2d
    // context (and measures ch) when the editor attaches.
    stubCjkCanvasTextWidth();
  }
  const wrapMeasurement = installLayoutWrapMeasurement(
    wrapColumns,
    (codePoint) => (isCjkCodePoint(codePoint) ? 2 : 1)
  );
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    overflow: 'wrap',
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = {
    name: 'wrap.txt',
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
): void {
  content.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    })
  );
}

function setCaret(editor: Editor<undefined>, line: number, character: number) {
  // Editor.setSelections takes the string-direction selection shape, unlike
  // the numeric SelectionDirection used by selection.ts helpers above.
  editor.setSelections([
    {
      start: { line, character },
      end: { line, character },
      direction: 'none' as const,
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

// The rendered caret's transform encodes the visual row (translateY =
// lineTop + wrapRow * lineHeight; jsdom lineTop is 0) and the x position
// (#getCharX's segment-local width, offset by the gutter).
function caretXY(container: HTMLElement): { x: number; y: number } {
  const caret = container.shadowRoot?.querySelector('[data-caret]');
  if (!(caret instanceof HTMLElement)) {
    throw new Error('no caret element rendered');
  }
  const match = /translateX\(([-\d.]+)px\) translateY\(([-\d.]+)px\)/.exec(
    caret.style.transform
  );
  if (match === null) {
    throw new Error(`caret transform not parseable: ${caret.style.transform}`);
  }
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

// Caret x at (line, character) relative to the caret at (line, 0), removing
// the gutter/padding offset so assertions read in text pixels.
function caretXFromLineStart(
  editor: Editor<undefined>,
  container: HTMLElement,
  line: number,
  character: number
): { x: number; y: number } {
  setCaret(editor, line, 0);
  const base = caretXY(container);
  setCaret(editor, line, character);
  const at = caretXY(container);
  return { x: at.x - base.x, y: at.y };
}

// The editor's default line height (Metrics fallback; jsdom computes none).
const LINE_HEIGHT = 20;

describe('soft-break placement around a whitespace run (textmate-legacy)', () => {
  // Fixture: 'lorem' + six spaces + 'ipsum', wrapped at 8 columns of 8px.
  // The break opportunity is after the whole space run: visual row 0 is
  // offsets 0-10 ('lorem' plus all six spaces, the last two hanging past the
  // wrap column), and row 1 starts at offset 11, the 'i' of 'ipsum'.
  const FIXTURE = 'lorem      ipsum';
  const WRAP_COLUMNS = 8;
  const BREAK = 11; // offset of 'i', the first non-space after the run

  // textmate-legacy: Frameworks/text/tests/t_wrap.cc — spaces following a
  // word hang at the end of the wrapped row rather than being pushed to the
  // next row, and the following visual row starts at a non-space character.
  test('trailing spaces hang past the wrap column and the next row starts at the first non-space', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      FIXTURE,
      WRAP_COLUMNS
    );
    try {
      // A caret inside the hanging part of the space run (column 9, past
      // the 8-column wrap budget of 64px) still renders on visual row 0,
      // at an x beyond the wrap column: the spaces hang.
      expect(caretXFromLineStart(editor, fileContainer, 0, 9)).toEqual({
        x: 9 * CH,
        y: 0,
      }); // 72px > 64px budget

      // The caret exactly at the break offset also renders at the end of
      // row 0 (boundary carets belong to the earlier visual row) ...
      expect(caretXFromLineStart(editor, fileContainer, 0, BREAK)).toEqual({
        x: BREAK * CH,
        y: 0,
      });

      // ... while one character further sits on row 1, one character in,
      // proving row 1 begins at 'i' and carries no leading spaces.
      expect(caretXFromLineStart(editor, fileContainer, 0, BREAK + 1)).toEqual({
        x: 1 * CH,
        y: LINE_HEIGHT,
      });
    } finally {
      cleanup();
    }
  }, 15000);

  // textmate-legacy: Frameworks/text/tests/t_wrap.cc — caret mapping on rows
  // split inside a multi-space run: ArrowDown lands on the non-space row
  // start, and Home/End use the after-the-spaces break offset as the row
  // edge, with the boundary caret belonging to the earlier row.
  test('ArrowDown and Home/End treat the after-spaces break offset as the row boundary', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      FIXTURE,
      WRAP_COLUMNS
    );
    try {
      // Down from the line start lands on the first non-space of row 1.
      setCaret(editor, 0, 0);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, BREAK);

      // End from inside the space run — both before and past the wrap
      // column — goes to the break offset, i.e. *after* the hanging spaces.
      setCaret(editor, 0, 7);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, BREAK);
      setCaret(editor, 0, 9);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, BREAK);

      // Home from inside the hanging run goes to the logical row start.
      setCaret(editor, 0, 9);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, 0);

      // The boundary caret belongs to row 0: Home crosses back to 0, the
      // same affinity its rendered position showed above.
      setCaret(editor, 0, BREAK);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, 0);

      // One character into row 1, Home/End bound exactly that row.
      setCaret(editor, 0, BREAK + 1);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, BREAK);
      setCaret(editor, 0, BREAK + 1);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, FIXTURE.length);
    } finally {
      cleanup();
    }
  }, 15000);
});

describe('double-width CJK wrap arithmetic (textmate-legacy)', () => {
  // Line 0: twenty CJK characters, each 2 columns / 16px wide.
  // Line 1: twenty ASCII characters, each 1 column / 8px wide.
  // Wrapped at 10 columns, the CJK line fits 5 characters per visual row
  // (4 rows) while the equal-count ASCII line fits 10 (2 rows).
  const CJK_LINE = '一二三四五六七八九十'.repeat(2);
  const ASCII_LINE = 'abcdefghijklmnopqrst';
  const CONTENTS = `${CJK_LINE}\n${ASCII_LINE}`;
  const WRAP_COLUMNS = 10;

  // textmate-legacy: Frameworks/text/tests/t_ctype.cc — a line of
  // double-width East Asian glyphs wraps after half as many characters as an
  // ASCII line of equal character count.
  test('a CJK line wraps after half as many characters as an equal-count ASCII line', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      CONTENTS,
      WRAP_COLUMNS,
      { cjkWidths: true }
    );
    try {
      // End on the first visual row: 5 CJK characters vs 10 ASCII.
      setCaret(editor, 0, 0);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, 5);
      setCaret(editor, 1, 0);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 1, 10);

      // Walking down the CJK line advances 5 characters per visual row and
      // needs four rows for 20 characters (the ASCII line needs two),
      // preserving the caret's row-local character offset at each step.
      setCaret(editor, 0, 2);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 7);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 12);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 0, 17);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 1, 2); // fourth row was the last; next stop is line 1
    } finally {
      cleanup();
    }
  }, 15000);

  // textmate-legacy: Frameworks/text/tests/t_ctype.cc — caret x and visual
  // row at wrapped-row boundaries are computed from measured double-width
  // glyph advances, so 5 CJK characters and 10 ASCII characters reach the
  // same 80px row edge.
  test('caret placement at wrapped-row boundaries uses measured double-width advances', async () => {
    const { cleanup, editor, fileContainer } = await createWrapEditor(
      CONTENTS,
      WRAP_COLUMNS,
      { cjkWidths: true }
    );
    try {
      const rowWidth = 5 * CJK_CH; // 80px

      // The caret at the first CJK row boundary renders at the end of row
      // 0; the next character renders one double-width glyph into row 1.
      expect(caretXFromLineStart(editor, fileContainer, 0, 5)).toEqual({
        x: rowWidth,
        y: 0,
      });
      expect(caretXFromLineStart(editor, fileContainer, 0, 6)).toEqual({
        x: CJK_CH,
        y: LINE_HEIGHT,
      });

      // Later boundaries: same row-edge x, one lineHeight per wrap row.
      expect(caretXFromLineStart(editor, fileContainer, 0, 10)).toEqual({
        x: rowWidth,
        y: LINE_HEIGHT,
      });
      expect(caretXFromLineStart(editor, fileContainer, 0, 20)).toEqual({
        x: rowWidth,
        y: 3 * LINE_HEIGHT,
      });

      // The ASCII line reaches the same 80px row edge with twice the
      // characters — the double-width arithmetic, seen from the other side.
      expect(caretXFromLineStart(editor, fileContainer, 1, 10)).toEqual({
        x: 10 * CH,
        y: 0,
      });
    } finally {
      cleanup();
    }
  }, 15000);
});
