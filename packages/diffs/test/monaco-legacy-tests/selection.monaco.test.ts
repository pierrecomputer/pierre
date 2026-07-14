import { describe, expect, test } from 'bun:test';

import {
  applyDeleteCharacterToSelections,
  applyTextChangeToSelections,
  applyTextReplaceToSelections,
  DirectionForward,
  DirectionNone,
  findNexMatch,
  getAutoSurroundReplacementTexts,
  mergeOverlappingSelections,
  resolveDeleteCharacterRange,
} from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, SelectionDirection } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return { start: position, end: position, direction: DirectionNone };
}

function sel(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionForward
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction,
  };
}

// Runs one Backspace at the given selections and returns the selections that
// result, mutating `d` in place.
function backspace(d: ReturnType<typeof doc>, selections: EditorSelection[]) {
  return applyDeleteCharacterToSelections(d, selections, false).nextSelections;
}

describe('backward delete over grapheme clusters (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace (ZWJ sequence)"
  test('backspace removes a whole ZWJ family emoji without splitting the cluster', () => {
    // DIVERGENCE: vscode peels one ZWJ component off the end per keystroke
    // (family → couple → single person → empty, one Backspace each). pierre-fe
    // steps by Intl.Segmenter grapheme clusters, so the entire family emoji is
    // one unit and a single Backspace removes it all. Both policies agree on
    // the invariant the vscode regression was about: no keystroke may split a
    // surrogate pair or strand a lone ZWJ/modifier in the buffer.
    const family = '\u{1F469}‍\u{1F469}‍\u{1F466}‍\u{1F466}'; // 👩‍👩‍👦‍👦
    expect(family.length).toBe(11); // 4 surrogate pairs + 3 ZWJs

    const d = doc(`hi${family}!`);
    // Caret between the family emoji and the trailing '!'.
    const range = resolveDeleteCharacterRange(d, caret(0, 13), false);
    expect(range).toEqual([
      { line: 0, character: 2 },
      { line: 0, character: 13 },
    ]);

    const next = backspace(d, [caret(0, 13)]);
    expect(d.getText()).toBe('hi!');
    expect(next).toEqual([caret(0, 2)]);
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #99629: Emoji modifiers in text treated separately when using backspace"
  test('backspace removes base emoji and skin-tone modifier as one unit', () => {
    const thumbs = '\u{1F44D}\u{1F3FD}'; // 👍🏽 = base + Fitzpatrick modifier
    expect(thumbs.length).toBe(4);

    const d = doc(`ok ${thumbs}`);
    const range = resolveDeleteCharacterRange(d, caret(0, 7), false);
    expect(range).toEqual([
      { line: 0, character: 3 },
      { line: 0, character: 7 },
    ]);

    const next = backspace(d, [caret(0, 7)]);
    // One keystroke removes the modifier together with its base — the buffer
    // never holds a bare modifier or half a surrogate pair.
    expect(d.getText()).toBe('ok ');
    expect(next).toEqual([caret(0, 3)]);
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #84897: Left delete behavior in some languages is changed" / "issue #122914: Left delete behavior in some languages is changed (useTabStops: false)"
  test('backspace steps over Thai combining marks one grapheme cluster at a time', () => {
    // DIVERGENCE: vscode deliberately deletes one UTF-16 code unit per
    // Backspace in combining-mark scripts (issues #84897/#122914 were filed by
    // Thai users who expect to erase a tone/vowel mark without losing the base
    // consonant; vscode's fixture needs six keystrokes for six code units).
    // pierre-fe deletes whole Intl.Segmenter grapheme clusters everywhere, so
    // a base consonant and its attached marks always leave together. Never
    // splitting a cluster also means no keystroke can strand a combining mark.
    const thai = 'น้ำใจ'; // น + ◌้ + ◌ำ (one cluster), ใ, จ
    expect(thai.length).toBe(5);

    const d = doc(thai);
    let selections = [caret(0, 5)];

    // จ is a single-unit cluster.
    expect(resolveDeleteCharacterRange(d, selections[0], false)).toEqual([
      { line: 0, character: 4 },
      { line: 0, character: 5 },
    ]);
    selections = backspace(d, selections);
    expect(d.getText()).toBe('น้ำใ');

    selections = backspace(d, selections);
    expect(d.getText()).toBe('น้ำ');

    // The remaining three code units are one cluster: base consonant plus two
    // combining marks are removed by a single keystroke.
    expect(resolveDeleteCharacterRange(d, selections[0], false)).toEqual([
      { line: 0, character: 0 },
      { line: 0, character: 3 },
    ]);
    selections = backspace(d, selections);
    expect(d.getText()).toBe('');
    expect(selections).toEqual([caret(0, 0)]);
  });
});

describe('select next occurrence with touching matches (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/contrib/multicursor/test/browser/multicursor.test.ts — "issue #6661: AddSelectionToNextFindMatchAction can work with touching ranges"
  test('finds a repeat that touches the current selection with zero gap', () => {
    const d = doc('abcabc');
    const first = sel(0, 0, 0, 3);

    // The second "abc" starts exactly where the selected one ends. It must be
    // returned as the next match, not skipped as overlapping.
    const next = findNexMatch(d, [first]);
    expect(next).toEqual([first, sel(0, 3, 0, 6)]);

    // Both occurrences are now held; nothing is left to add.
    expect(findNexMatch(d, next!)).toBeUndefined();
  });

  // monaco-legacy: src/vs/editor/contrib/multicursor/test/browser/multicursor.test.ts — "issue #6661: AddSelectionToNextFindMatchAction can work with touching ranges"
  test('repeated next-occurrence walks through touching matches across lines', () => {
    const d = doc('rowrow\nrow\nrowrow');
    let selections: EditorSelection[] | undefined = [sel(0, 0, 0, 3)];

    const expected = [
      sel(0, 3, 0, 6), // touching repeat on the same line
      sel(1, 0, 1, 3),
      sel(2, 0, 2, 3),
      sel(2, 3, 2, 6), // touching repeat on the last line
    ];
    for (const added of expected) {
      selections = findNexMatch(d, selections!);
      expect(selections![selections!.length - 1]).toEqual(added);
    }
    expect(selections!.length).toBe(5);

    // All five occurrences selected — the next request finds nothing new.
    expect(findNexMatch(d, selections!)).toBeUndefined();
  });
});

describe('carets converging through a delete (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #37967: problem replacing consecutive characters"
  test('carets that converge via backspace merge and type the next character once', () => {
    // vscode's regression test runs with multiCursorMergeOverlapping:false to
    // reproduce the double-insert users saw; with its default (merging on,
    // like pierre-fe's always-on mergeOverlappingSelections) the two converged
    // carets collapse to one and the typed character is inserted once.
    const d = doc('name = ""');
    // One caret after each quote.
    const afterDelete = backspace(d, [caret(0, 8), caret(0, 9)]);

    // Each caret deleted its own quote; both land on the same position.
    expect(d.getText()).toBe('name = ');
    expect(afterDelete).toEqual([caret(0, 7), caret(0, 7)]);

    const merged = mergeOverlappingSelections(afterDelete);
    expect(merged).toEqual([caret(0, 7)]);

    // Type a single quote at the merged caret: it must appear exactly once.
    const { nextSelections } = applyTextChangeToSelections(d, merged, {
      start: 7,
      end: 7,
      text: "'",
    });
    expect(d.getText()).toBe("name = '");
    expect(nextSelections).toEqual([caret(0, 8)]);
  });
});

describe('auto-surround next to an astral character (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #47733: Undo mangles unicode characters"
  test('surrounding a selection just before an emoji survives undo intact', () => {
    // The owl is a surrogate pair at characters 1-2; the wrapped selection is
    // the double quote at character 0, so the inserted closing quote lands
    // immediately before the high surrogate.
    const d = doc('"🦉"');
    const selections = [sel(0, 0, 0, 1)];

    const texts = getAutoSurroundReplacementTexts(d, selections, "'");
    expect(texts).toEqual(["'\"'"]);

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts!
    );
    expect(d.getText()).toBe('\'"\'🦉"');
    // The originally selected text stays selected inside the new pair.
    expect(nextSelections).toEqual([sel(0, 1, 0, 2)]);

    // Undo must restore the buffer byte-for-byte — the emoji is not mangled.
    expect(d.canUndo).toBe(true);
    d.undo();
    expect(d.getText()).toBe('"🦉"');

    // And the round trip keeps working in both directions.
    d.redo();
    expect(d.getText()).toBe('\'"\'🦉"');
    d.undo();
    expect(d.getText()).toBe('"🦉"');
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #47733: Undo mangles unicode characters"
  test('surrounding a selection just after an emoji survives undo intact', () => {
    // Mirror case: the wrapped selection is the closing quote at character 3,
    // so the inserted opening bracket lands immediately after the low
    // surrogate.
    const d = doc('"🦉"');
    const selections = [sel(0, 3, 0, 4)];

    const texts = getAutoSurroundReplacementTexts(d, selections, '(');
    expect(texts).toEqual(['(")']);

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts!
    );
    expect(d.getText()).toBe('"🦉(")');
    expect(nextSelections).toEqual([sel(0, 4, 0, 5)]);

    d.undo();
    expect(d.getText()).toBe('"🦉"');
  });
});
