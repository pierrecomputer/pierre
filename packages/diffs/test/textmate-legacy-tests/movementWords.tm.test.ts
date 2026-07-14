import { describe, expect, test } from 'bun:test';

import {
  applyDeleteCharacterToSelections,
  DirectionBackward,
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
  mapCursorMove,
  mapSelectionShift,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import {
  getExpandedAsciiTextColumns,
  getUnicodeMeasurementOffsets,
  needsDomTextMeasurement,
  snapTextOffsetToUnicodeBoundary,
} from '../../src/editor/textMeasure';
import type { EditorSelection } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

// Single 'textStart' (smart-home) press on a collapsed caret.
function home(
  d: TextDocument<unknown>,
  line: number,
  character: number
): { line: number; character: number } {
  const [moved] = mapCursorMove(d, [caret(line, character)], 'textStart');
  return moved.start;
}

// Explicit escapes so no tooling can "repair" the malformed fixture: a lone
// high surrogate and a lone low surrogate that do NOT pair with anything.
const LONE_HI = '\uD83D';
const LONE_LO = '\uDC00';
// Well-formed astral pair (2 UTF-16 units) for adjacency tests.
const EMOJI = '\u{1F600}';

describe('smart-home (textStart) around leading whitespace', () => {
  // pierre-fe's rule (probed): every press moves to the first non-blank
  // column UNLESS the caret already sits exactly there, in which case it
  // moves to column 0. TextMate's rule differs only for a caret strictly
  // inside the leading whitespace: TextMate sends it to column 0 first.

  test('caret strictly inside the indentation jumps forward to the first non-blank', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home with the caret between column 0 and the first non-blank character
    // DIVERGENCE: TextMate/classic macOS sends a caret inside the leading
    // whitespace to column 0; pierre-fe follows the VS Code policy and moves
    // it (rightward!) to the first non-blank column instead.
    const d = doc('    code here');
    expect(home(d, 0, 1)).toEqual({ line: 0, character: 4 });
    expect(home(d, 0, 2)).toEqual({ line: 0, character: 4 });
    expect(home(d, 0, 3)).toEqual({ line: 0, character: 4 });
  });

  test('caret at column 0 jumps to the first non-blank', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home pressed with the caret already at column 0 of an indented line
    const d = doc('    code here');
    expect(home(d, 0, 0)).toEqual({ line: 0, character: 4 });
  });

  test('caret exactly at the first non-blank toggles to column 0', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home pressed with the caret sitting on the first non-blank character
    const d = doc('    code here');
    expect(home(d, 0, 4)).toEqual({ line: 0, character: 0 });
  });

  test('repeated presses toggle indent <-> column 0 and never settle', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — repeated smart-home presses cycling between the two home positions
    // DIVERGENCE: pierre-fe's cycle from inside the indentation is
    // indent -> 0 -> indent -> 0 ...; TextMate's is 0 -> indent -> 0 ...
    // (same two stops, opposite first hop).
    const d = doc('    code here');
    let sels = [caret(0, 2)];
    const stops: number[] = [];
    for (let press = 0; press < 4; press++) {
      sels = mapCursorMove(d, sels, 'textStart');
      stops.push(sels[0].start.character);
    }
    expect(stops).toEqual([4, 0, 4, 0]);
  });

  test('tabs count as leading whitespace for the indent stop', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home over tab-indented lines
    const d = doc('\t\tx');
    expect(home(d, 0, 0)).toEqual({ line: 0, character: 2 });
    expect(home(d, 0, 1)).toEqual({ line: 0, character: 2 });
    expect(home(d, 0, 2)).toEqual({ line: 0, character: 0 });
  });

  test('all-whitespace line: the "first non-blank" stop is the line end', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home on a line containing only blanks
    // DIVERGENCE: on a whitespace-only line the entire line is "indentation",
    // so pierre-fe's first stop is the line END — Home moves the caret
    // rightward. TextMate/macOS Home never moves right; it goes to column 0.
    const d = doc('      '); // six spaces, no content
    expect(home(d, 0, 0)).toEqual({ line: 0, character: 6 });
    expect(home(d, 0, 2)).toEqual({ line: 0, character: 6 });
    expect(home(d, 0, 6)).toEqual({ line: 0, character: 0 });
  });

  test('unindented line: every press lands on column 0 and stays there', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — smart-home on a line with no leading whitespace
    // With indent == 0 the two stops coincide, so the toggle has a fixed
    // point: mid-line goes to 0 and a caret at 0 stays at 0.
    const d = doc('plain');
    expect(home(d, 0, 3)).toEqual({ line: 0, character: 0 });
    expect(home(d, 0, 0)).toEqual({ line: 0, character: 0 });
  });

  test('shift+home keeps the anchor and toggles the focus indent <-> column 0', () => {
    // textmate-legacy: Frameworks/selection/tests/t_indent_movement.cc — shift-extension variant of the smart-home toggle
    // DIVERGENCE: the focus visits the same two stops as the plain move but
    // in pierre-fe's order (indent first); TextMate's shift-home from inside
    // the indentation extends to column 0 first.
    const d = doc('    code');
    let sels: EditorSelection[] = [caret(0, 6)];

    sels = mapSelectionShift(d, sels, 'textStart');
    expect(sels).toEqual([
      {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 6 },
        direction: DirectionBackward,
      },
    ]);

    sels = mapSelectionShift(d, sels, 'textStart');
    expect(sels).toEqual([
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 6 },
        direction: DirectionBackward,
      },
    ]);

    sels = mapSelectionShift(d, sels, 'textStart');
    expect(sels).toEqual([
      {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 6 },
        direction: DirectionBackward,
      },
    ]);
  });
});

describe('double-click word expansion: Unicode word-category facts', () => {
  // expandCollapsedSelectionToWord runs Intl.Segmenter (word granularity) and
  // returns the first word-like segment whose span contains or touches the
  // caret. CJK/script-boundary segmentation facts are already pinned in
  // monaco-legacy-tests/wordOperations.monaco.test.ts and are deliberately
  // NOT repeated here; this block pins the ASCII joiner-character facts.

  test('underscore-joined identifier expands as ONE word', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — underscore-joined identifier selected as a single word unit
    // UAX #29 treats "_" as ExtendNumLet, which glues letter runs together —
    // the same convention TextMate uses for identifiers.
    const d = doc('let snake_case_name = 1;');
    for (const ch of [4, 9, 10, 15, 19]) {
      expect(expandCollapsedSelectionToWord(d, caret(0, ch))).toEqual({
        start: { line: 0, character: 4 },
        end: { line: 0, character: 19 },
        direction: DirectionForward,
      });
    }
  });

  test('hyphen-joined pair splits into two words at the hyphen', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — hyphenated compound splitting into its two halves on word selection
    const d = doc('well-known pair');
    // Inside the first half (and touching its right edge at the hyphen).
    for (const ch of [2, 4]) {
      expect(expandCollapsedSelectionToWord(d, caret(0, ch))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 },
        direction: DirectionForward,
      });
    }
    // From the second half's left edge onward the second word wins.
    for (const ch of [5, 7]) {
      expect(expandCollapsedSelectionToWord(d, caret(0, ch))).toEqual({
        start: { line: 0, character: 5 },
        end: { line: 0, character: 10 },
        direction: DirectionForward,
      });
    }
  });

  test('apostrophe contraction expands as ONE word including the apostrophe', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — apostrophe-containing contraction kept whole by word selection
    // U+0027 between letters is a mid-word character in UAX #29, so the
    // selection covers all five units of "don't" — never "don" or "t" alone.
    const d = doc("don't stop");
    for (const ch of [1, 3, 4, 5]) {
      expect(expandCollapsedSelectionToWord(d, caret(0, ch))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
    }
  });

  test('digit-mixed identifiers expand as ONE word across letter/digit seams', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — identifiers mixing digits and letters treated as one word unit
    const d = doc('id42x rest');
    for (const ch of [0, 2, 4, 5]) {
      expect(expandCollapsedSelectionToWord(d, caret(0, ch))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
    }
    // Digits + underscore + letters all fuse too.
    const d2 = doc('v2_final mix');
    for (const ch of [0, 1, 2, 4, 8]) {
      expect(expandCollapsedSelectionToWord(d2, caret(0, ch))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 8 },
        direction: DirectionForward,
      });
    }
  });
});

describe('unpaired-surrogate robustness (malformed initial content)', () => {
  // A document whose INITIAL content contains a lone high surrogate at
  // offset 2 and a lone low surrogate at offset 5. Probed: every path below
  // treats each lone surrogate as one caret unit without pairing it with a
  // neighbor, corrupting adjacent characters, crashing, or hanging.
  const MALFORMED = `ab${LONE_HI}cd${LONE_LO}ef`; // 8 UTF-16 units, 1 line

  test('construction and getText round-trip the lone surrogates verbatim', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed input survives storage without repair or corruption
    const d = doc(MALFORMED);
    expect(d.getText()).toBe(MALFORMED);
    expect(d.getText().length).toBe(8);
    expect(d.lineCount).toBe(1);
    expect(d.getLineLength(0)).toBe(8);
    expect(d.getLineText(0)).toBe(MALFORMED);
  });

  test('positionAt/offsetAt are exact inverses at every offset, surrogates included', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — offset arithmetic over malformed input stays unit-exact
    // Offsets 2 and 5 (the lone surrogates) map like any other UTF-16 unit —
    // no snapping, no crash.
    const d = doc(MALFORMED);
    for (let offset = 0; offset <= 8; offset++) {
      const position = d.positionAt(offset);
      expect(position).toEqual({ line: 0, character: offset });
      expect(d.offsetAt(position)).toBe(offset);
    }
  });

  test('caret arrows step over each lone surrogate as exactly one unit', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — caret movement across malformed sequences advances one unit at a time without sticking
    const d = doc(MALFORMED);
    // Bounded loops: if movement ever stopped advancing this would fail fast
    // rather than hang.
    let sels = [caret(0, 0)];
    const rightStops: number[] = [];
    for (let i = 0; i < 8; i++) {
      sels = mapCursorMove(d, sels, 'right');
      rightStops.push(sels[0].start.character);
    }
    expect(rightStops).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    sels = [caret(0, 8)];
    const leftStops: number[] = [];
    for (let i = 0; i < 8; i++) {
      sels = mapCursorMove(d, sels, 'left');
      leftStops.push(sels[0].start.character);
    }
    expect(leftStops).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });

  test('backspace after the lone high surrogate removes exactly that one unit', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — deleting a malformed unit removes only it, leaving neighbors intact
    const d = doc(MALFORMED);
    const { nextSelections } = applyDeleteCharacterToSelections(
      d,
      [caret(0, 3)],
      false
    );
    expect(d.getText()).toBe(`abcd${LONE_LO}ef`);
    expect(nextSelections).toEqual([caret(0, 2)]);
  });

  test('forward delete at the lone high surrogate removes exactly that one unit', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — forward deletion of a malformed unit is symmetric with backspace
    const d = doc(MALFORMED);
    const { nextSelections } = applyDeleteCharacterToSelections(
      d,
      [caret(0, 2)],
      true
    );
    expect(d.getText()).toBe(`abcd${LONE_LO}ef`);
    expect(nextSelections).toEqual([caret(0, 2)]);
  });

  test('backspace after the lone low surrogate removes exactly that one unit', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — deleting a malformed unit removes only it, leaving neighbors intact
    const d = doc(MALFORMED);
    const { nextSelections } = applyDeleteCharacterToSelections(
      d,
      [caret(0, 6)],
      false
    );
    expect(d.getText()).toBe(`ab${LONE_HI}cdef`);
    expect(nextSelections).toEqual([caret(0, 5)]);
  });

  test('deleting a normal character between the surrogates leaves both untouched', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — edits adjacent to malformed units never widen into them
    const d = doc(MALFORMED);
    const { nextSelections } = applyDeleteCharacterToSelections(
      d,
      [caret(0, 4)], // backspace deletes the 'c' right after the lone high
      false
    );
    expect(d.getText()).toBe(`ab${LONE_HI}d${LONE_LO}ef`);
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('a lone high surrogate directly before a real astral pair never fuses with it', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed unit adjacent to a well-formed sequence keeps its own boundary
    // Layout: a(0) LONE_HI(1) EMOJI(2-3) b(4). The lone high must be one
    // caret stop and the well-formed pair another — not one three-unit blob.
    const content = `a${LONE_HI}${EMOJI}b`;
    const d = doc(content);
    expect(d.getText()).toBe(content);

    let sels = [caret(0, 0)];
    const stops: number[] = [];
    for (let i = 0; i < 4; i++) {
      sels = mapCursorMove(d, sels, 'right');
      stops.push(sels[0].start.character);
    }
    expect(stops).toEqual([1, 2, 4, 5]);

    // Backspace at the end of the pair deletes the WHOLE pair and nothing
    // else; the lone high survives.
    const { nextSelections } = applyDeleteCharacterToSelections(
      d,
      [caret(0, 4)],
      false
    );
    expect(d.getText()).toBe(`a${LONE_HI}b`);
    expect(nextSelections).toEqual([caret(0, 2)]);
  });

  test('an edit replacing the span containing both lone surrogates applies cleanly', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — replacing a malformed span with well-formed text yields a clean document
    const d = doc(MALFORMED);
    const change = d.applyEdits([
      {
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 6 },
        },
        newText: 'XY',
      },
    ]);
    expect(change).toBeDefined();
    expect(d.getText()).toBe('abXYef');
    expect(d.lineCount).toBe(1);
  });

  test('an edit replacing only the lone high surrogate with a real emoji applies cleanly', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — single-unit replacement of a malformed unit does not disturb the other one
    const d = doc(MALFORMED);
    d.applyEdits([
      {
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 3 },
        },
        newText: EMOJI,
      },
    ]);
    expect(d.getText()).toBe(`ab${EMOJI}cd${LONE_LO}ef`);
    expect(d.getLineText(0)).toBe(`ab${EMOJI}cd${LONE_LO}ef`);
  });

  test('lone surrogates flanking a newline keep exact line boundaries', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed units at line edges do not confuse line splitting
    const d = doc(`x${LONE_HI}\n${LONE_LO}y`);
    expect(d.lineCount).toBe(2);
    expect(d.getLineText(0)).toBe(`x${LONE_HI}`);
    expect(d.getLineText(1)).toBe(`${LONE_LO}y`);
    expect(d.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(d.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(d.offsetAt({ line: 1, character: 0 })).toBe(3);
  });
});

// A word carrying a combining mark, written in explicit NFD escapes so no
// tooling can normalize it to precomposed form: c a f e U+0301 s.
const NFD_WORD = 'cafés';
// An astral LETTER (word-like under UAX #29, unlike emoji), one surrogate pair.
const MATH_A = '\u{1D400}';

function expandAt(text: string, character: number): [number, number] {
  const selection = expandCollapsedSelectionToWord(
    doc(text),
    caret(0, character)
  );
  return [selection.start.character, selection.end.character];
}

// Runs fn with Intl.Segmenter removed so word expansion takes its degraded
// regex path. createSegmenter (src/editor/utils.ts) re-checks Intl.Segmenter
// on every call, so the stub reliably reroutes expandCollapsedSelectionToWord.
// The grapheme segmenter, by contrast, is cached at module level after first
// use, so the grapheme fallback cannot be reached deterministically from a
// shared test process — only the word-granularity fallback is pinned here.
function withoutSegmenter<T>(fn: () => T): T {
  const saved = Intl.Segmenter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Intl as any).Segmenter = undefined;
  try {
    return fn();
  } finally {
    (Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = saved;
  }
}

describe('double-click word expansion around grapheme clusters', () => {
  test('a combining mark stays attached to its word', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — word units never split a base letter from its combining mark
    // 'xx cafés yy' with NFD accent: word spans offsets 3..9 including U+0301.
    expect(expandAt(`xx ${NFD_WORD} yy`, 5)).toEqual([3, 9]);
    // Caret directly between the base letter and its combining mark still
    // selects the whole word, mark included.
    expect(expandAt(`xx ${NFD_WORD} yy`, 7)).toEqual([3, 9]);
  });

  test('an astral letter bounded by punctuation expands to both surrogate halves', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — a one-character word between delimiters selects exactly that character
    // '“𝐀”': the letter occupies offsets 1..3 (one surrogate pair).
    expect(expandAt(`“${MATH_A}”`, 2)).toEqual([1, 3]);
    expect(expandAt(`“${MATH_A}”`, 1)).toEqual([1, 3]);
    expect(expandAt(`“${MATH_A}”`, 3)).toEqual([1, 3]);
  });
});

describe('word expansion fallback without Intl.Segmenter', () => {
  test('ascii identifiers expand identically to the segmenter path', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — underscore and digits belong to the word unit
    const fixture = 'foo bar_baz1 qux';
    const withSegmenter = expandAt(fixture, 6);
    const fallback = withoutSegmenter(() => expandAt(fixture, 6));
    expect(withSegmenter).toEqual([4, 12]);
    expect(fallback).toEqual([4, 12]);
  });

  test('the fallback clips a word at a combining mark', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — word units never split a base letter from its combining mark
    // DIVERGENCE: the degraded \p{Alphabetic}\p{Number}_ regex run stops at
    // U+0301 (not Alphabetic), so the expansion ends between the base letter
    // and its mark — [3,7] instead of the segmenter's [3,9]. Deleting that
    // selection would orphan the accent. Acceptable for the no-Segmenter
    // fallback; revisit if any supported engine actually lacks Segmenter.
    expect(withoutSegmenter(() => expandAt(`xx ${NFD_WORD} yy`, 5))).toEqual([
      3, 7,
    ]);
  });

  test('the fallback keeps astral letters whole', () => {
    // textmate-legacy: Frameworks/selection/tests/t_all_words.cc — a one-character word between delimiters selects exactly that character
    // The /u regex matches whole code points, so the pair never splits.
    expect(withoutSegmenter(() => expandAt(`“${MATH_A}”`, 2))).toEqual([1, 3]);
  });

  test('a lone surrogate acts as a word separator in the fallback', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed units are not word characters
    // 'ab<LONE_HI>cd': the run after the separator spans offsets 3..5.
    expect(withoutSegmenter(() => expandAt(`ab${LONE_HI}cd`, 3))).toEqual([
      3, 5,
    ]);
  });

  test('the stub restores the segmenter for later tests', () => {
    // Guard against cross-file pollution from the withoutSegmenter helper.
    expect(typeof Intl.Segmenter).toBe('function');
    expect(expandAt(`xx ${NFD_WORD} yy`, 5)).toEqual([3, 9]);
  });
});

describe('text measurement with lone surrogates', () => {
  test('a lone surrogate routes the text to DOM measurement', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed units are detected rather than assumed renderable
    expect(needsDomTextMeasurement(`ab${LONE_HI}cd`)).toBe(true);
    expect(needsDomTextMeasurement(`ab${LONE_LO}cd`)).toBe(true);
    expect(needsDomTextMeasurement('abcd')).toBe(false);
  });

  test('boundary snapping is the identity around a lone surrogate and terminates', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed units are their own single-unit segment
    // 'ab<LONE_HI>cd': the lone half is one segment, so no offset needs
    // snapping; out-of-range offsets clamp to the ends.
    const text = `ab${LONE_HI}cd`;
    for (let offset = 0; offset <= text.length; offset++) {
      expect(snapTextOffsetToUnicodeBoundary(text, offset)).toBe(offset);
    }
    expect(snapTextOffsetToUnicodeBoundary(text, 99)).toBe(text.length);
    expect(snapTextOffsetToUnicodeBoundary(text, -5)).toBe(0);
  });

  test('an adjacent high and low half fuse into a real pair and snap as one', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — two stray halves in the right order form a valid character
    // 'a' + HI + LO + 'b': the middle two units are a well-formed pair, so an
    // offset inside it snaps forward to the pair's end.
    const text = `a${LONE_HI}${LONE_LO}b`;
    expect(snapTextOffsetToUnicodeBoundary(text, 2)).toBe(3);
    expect(snapTextOffsetToUnicodeBoundary(text, 1)).toBe(1);
    expect(snapTextOffsetToUnicodeBoundary(text, 3)).toBe(3);
  });

  test('measurement offsets enumerate lone halves per unit and pairs as one', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — segment enumeration over malformed input covers every unit exactly once
    expect(getUnicodeMeasurementOffsets(`ab${LONE_HI}cd`)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(getUnicodeMeasurementOffsets(`a${LONE_HI}${LONE_LO}b`)).toEqual([
      0, 1, 3, 4,
    ]);
    // Pure-ascii text skips per-grapheme measurement entirely.
    expect(getUnicodeMeasurementOffsets('ab')).toBeUndefined();
  });

  test('ascii column counting rejects text containing a lone surrogate', () => {
    // textmate-legacy: Frameworks/text/tests/t_utf8.cc — malformed input falls off the ascii fast path
    expect(getExpandedAsciiTextColumns(`ab${LONE_HI}cd`, 4)).toBe(-1);
    expect(getExpandedAsciiTextColumns('ab\tcd', 4)).toBe(6);
  });
});
