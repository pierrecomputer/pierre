import { describe, expect, test } from 'bun:test';

import {
  applyDeleteWordBackwardToSelections,
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
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

// Word-granularity segments the runtime's ICU reports as word-like for a
// fixture. Used to gate segmenter-side pins: isWordLike classification
// varies across ICU builds (dictionary-based CJK segmentation especially),
// so each pin runs only where the runtime agrees with the segmentation our
// dev and CI environments ship, and skips visibly elsewhere.
function wordLikeSegments(text: string): string[] {
  return [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
  ]
    .filter((seg) => seg.isWordLike === true)
    .map((seg) => seg.segment);
}

// Explicit escapes so source normalization (NFC/NFD) can never change the
// fixture: a ZWJ family sequence (7 code points, 11 UTF-16 units) and a
// baby emoji with a Fitzpatrick skin-tone modifier (2 code points, 4 units).
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'; // 👨‍👩‍👧‍👦
const TONED_BABY = '\u{1F476}\u{1F3FE}'; // 👶🏾

describe('word delete vs word select on CJK and mixed-script runs', () => {
  // Both halves of this describe block pin an internal inconsistency on
  // purpose: deleteWordBackward's classifier groups every contiguous
  // \p{Alphabetic} grapheme into ONE run (Han/Hiragana/Katakana are all
  // Alphabetic), while double-click word expansion uses Intl.Segmenter and
  // splits the very same text into words. The tests make the inconsistency
  // visible; they do not pick a winner.

  test('delete word backward swallows an unbroken Chinese run in one stroke', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Does not recognize words"
    // DIVERGENCE: vscode segments CJK per-word only when wordSegmenterLocales
    // is configured (and then Ctrl+Backspace removes one segment at a time);
    // pierre-fe's delete-word classifier treats the whole Alphabetic run as
    // one word, so a single stroke deletes the entire sentence — and this
    // disagrees with pierre-fe's own double-click segmentation below.
    const d = doc('你好世界');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 4),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterSplitsChineseRun =
    wordLikeSegments('你好世界').join('|') === '你好|世界';

  test.skipIf(!segmenterSplitsChineseRun)(
    'double-click word expansion splits the same Chinese run into segments',
    () => {
      // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Recognize words"
      // DIVERGENCE: vscode's default (no wordSegmenterLocales) selects the whole
      // CJK run on double-click; pierre-fe always runs Intl.Segmenter, so the
      // exact text deleteWordBackward treats as one word splits in two here.
      const d = doc('你好世界');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 4))).toEqual({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward swallows a whole Japanese sentence in one stroke', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Does not recognize words"
    // DIVERGENCE: Hiragana and Han are both \p{Alphabetic}, so the classifier
    // sees one uninterrupted word run across the whole sentence. vscode with
    // segmentation enabled stops at each particle/word boundary.
    const d = doc('私は猫が好き');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 6),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterIsolatesTheNoun =
    wordLikeSegments('私は猫が好き').includes('猫');

  test.skipIf(!segmenterIsolatesTheNoun)(
    'double-click word expansion segments the same Japanese sentence',
    () => {
      // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Recognize words"
      // DIVERGENCE: Intl.Segmenter (dictionary-based, engine/ICU dependent)
      // isolates 猫 as its own word here, while deleteWordBackward above erases
      // the entire sentence as a single unit.
      const d = doc('私は猫が好き');
      expect(expandCollapsedSelectionToWord(d, caret(0, 3))).toEqual({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward swallows a mixed Latin-Katakana run in one stroke', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Does not recognize words"
    // DIVERGENCE: Latin letters and Katakana are both \p{Alphabetic}, so the
    // script boundary inside "helloワールド" is invisible to the delete-word
    // classifier and one stroke removes both halves.
    const d = doc('helloワールド');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterSplitsKatakanaRun =
    wordLikeSegments('helloワールド').join('|') === 'hello|ワールド';

  test.skipIf(!segmenterSplitsKatakanaRun)(
    'double-click word expansion splits the mixed run at the script boundary',
    () => {
      // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Recognize words"
      // DIVERGENCE: Intl.Segmenter breaks "helloワールド" at the Latin/Katakana
      // boundary, so double-click selects only one script's half while
      // deleteWordBackward above removes both in a single stroke.
      const d = doc('helloワールド');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 7))).toEqual({
        start: { line: 0, character: 5 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward treats Latin, Han, and digits as one run', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Does not recognize words"
    // DIVERGENCE: the classifier lumps \p{Alphabetic}, \p{Number}, and _ into
    // the same class, so accented Latin + Han + digits form one deletable run.
    const d = doc('na\u00EFve東京42'); // "naïve東京42", 9 UTF-16 units
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  // Intl.Segmenter's isWordLike classification varies across ICU builds
  // (whether bare digit runs and Han segments count as word-like differs
  // between engines and platforms). Gate the segmenter-side pin on the
  // runtime agreeing with the segmentation our dev and CI environments ship,
  // so a divergent ICU skips visibly instead of going red.
  const segmenterSplitsMixedRun =
    wordLikeSegments('naïve東京42').join('|') === 'naïve|東京|42';

  test.skipIf(!segmenterSplitsMixedRun)(
    'double-click word expansion splits Latin, Han, and digits into three words',
    () => {
      // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "cursorWordLeft - Recognize words"
      // DIVERGENCE: the same string that deleteWordBackward erases whole yields
      // three distinct double-click words (Latin, Han, digits).
      const d = doc('na\u00EFve東京42');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 6))).toEqual({
        start: { line: 0, character: 5 },
        end: { line: 0, character: 7 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 8))).toEqual({
        start: { line: 0, character: 7 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      });
    }
  );
});

describe('word delete around emoji and grapheme clusters', () => {
  // Probed against the current implementation: every case below removes whole
  // grapheme clusters — no surrogate halves, orphan ZWJs, lone modifiers, or
  // stranded combining marks are ever left behind — so these pin the coherent
  // current behavior rather than flagging bugs.

  test('deletes a lone emoji as its own run without splitting the surrogate pair', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "deleteWordLeft for cursor at end of whitespace" (emoji-at-boundary convention)
    const d = doc('word🎉');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 6),
    ]);
    expect(d.getText()).toBe('word');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('stops a word delete at an adjacent emoji and leaves it intact', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "deleteWordLeft for cursor at end of whitespace" (emoji-at-boundary convention)
    const d = doc('x 🎉party');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('x 🎉');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('deletes a ZWJ family emoji as one grapheme cluster', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace (ZWJ sequence)"
    const d = doc(`crew ${FAMILY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 5 + FAMILY.length),
    ]);
    expect(d.getText()).toBe('crew ');
    expect(nextSelections).toEqual([caret(0, 5)]);
  });

  test('deletes only the ZWJ cluster when it directly follows a word', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace (ZWJ sequence)"
    const d = doc(`name${FAMILY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 4 + FAMILY.length),
    ]);
    expect(d.getText()).toBe('name');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('deletes a word without disturbing a preceding ZWJ cluster', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace (ZWJ sequence)"
    const d = doc(`${FAMILY}crew`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, FAMILY.length + 4),
    ]);
    expect(d.getText()).toBe(FAMILY);
    expect(nextSelections).toEqual([caret(0, FAMILY.length)]);
  });

  test('deletes a skin-tone modified emoji together with its base', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace"
    const d = doc(`hug${TONED_BABY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 3 + TONED_BABY.length),
    ]);
    expect(d.getText()).toBe('hug');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('removes a word containing a combining mark without leaving an orphan mark', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #84897: Left delete behavior in some languages is changed"
    // "mañana" in decomposed form: the ñ is n + U+0303 combining tilde.
    const d = doc('man\u0303ana');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  test('removes a word ending in a combining-mark cluster in one piece', () => {
    // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #122914: Left delete behavior in some languages is changed (useTabStops: false)"
    // "go piña" in decomposed form; the final cluster is n + U+0303 + a.
    const d = doc('go pin\u0303a');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 8),
    ]);
    expect(d.getText()).toBe('go ');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });
});

describe('multi-cursor word delete across shifting line numbers', () => {
  test('joins lines at one caret while remapping a second caret on a lower line', () => {
    // monaco-legacy: src/vs/editor/contrib/linesOperations/test/browser/linesOperations.test.ts — "should keep deleting lines in multi cursor mode"
    // Caret 1 sits at column 0 of line 1, so its delete consumes the newline
    // after "alpha"; caret 2 deletes the word on line 2, which becomes line 1.
    const d = doc('alpha\nbravo\ncharlie');
    const { nextSelections, change } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
      caret(2, 7),
    ]);
    expect(change).toBeDefined();
    expect(d.getText()).toBe('alphabravo\n');
    expect(nextSelections).toEqual([caret(0, 5), caret(1, 0)]);
  });

  test('word delete on a shifted line lands mid-line after an upstream join', () => {
    // monaco-legacy: src/vs/editor/contrib/linesOperations/test/browser/linesOperations.test.ts — "should work in multi cursor mode"
    // The second caret deletes only the trailing word, so its remapped caret
    // must land mid-line on the renumbered line, not at column 0.
    const d = doc('first\nsecond\nthird word');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
      caret(2, 10),
    ]);
    expect(d.getText()).toBe('firstsecond\nthird ');
    expect(nextSelections).toEqual([caret(0, 5), caret(1, 6)]);
  });
});

describe('word delete at column zero preserves whitespace byte-for-byte', () => {
  test('keeps the joined line leading spaces intact', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "deleteWordLeft - issue #3882 (2): Ctrl+Delete removing entire line when used at the end of line"
    // Joining must remove exactly the newline: the four leading spaces on the
    // second line survive untouched, with no collapse to a single space.
    const d = doc('first line stops.\n    indented next');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('first line stops.    indented next');
    expect(nextSelections).toEqual([caret(0, 17)]);
  });

  test('keeps leading tabs intact when joining', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "deleteWordLeft - issue #3882 (2): Ctrl+Delete removing entire line when used at the end of line"
    const d = doc('top\n\t\tkeep tabs');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('top\t\tkeep tabs');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('keeps trailing spaces on the surviving line intact when joining', () => {
    // monaco-legacy: src/vs/editor/contrib/wordOperations/test/browser/wordOperations.test.ts — "deleteWordLeft - issue #3882 (2): Ctrl+Delete removing entire line when used at the end of line"
    const d = doc('padded out   \nnext');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('padded out   next');
    expect(nextSelections).toEqual([caret(0, 13)]);
  });
});
