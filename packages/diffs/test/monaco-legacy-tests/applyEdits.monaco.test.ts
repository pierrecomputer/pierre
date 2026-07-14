import { describe, expect, test } from 'bun:test';

import { DirectionNone } from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, TextEdit } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function edit(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    newText,
  };
}

function select(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionNone,
  };
}

// True when `text` contains a high surrogate without its low half (or vice
// versa) — the corruption signature these tests guard against.
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // well-formed pair
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('applyEdits: surrogate pair boundaries', () => {
  // The document starts with 📚, a two-UTF-16-unit astral character occupying
  // characters 0 and 1 of line 0. Character 1 therefore sits strictly between
  // the high and low surrogate — an invalid caller position that vscode's
  // model auto-corrects so the pair is never split.

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "high-low surrogates 1"
  // KNOWN BUG: an insert position strictly inside a surrogate pair is not
  // snapped to the pair boundary; the inserted text lands between the two
  // units and getText() returns lone surrogates.
  test.failing(
    'insert strictly inside a surrogate pair snaps to before the pair',
    () => {
      const d = doc('📚plans\nfor the\nweekend');
      d.applyEdits([edit(0, 1, 0, 1, 'a')]);
      expect(hasLoneSurrogate(d.getText())).toBe(false);
      expect(d.getLineText(0)).toBe('a📚plans');
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "high-low surrogates 2"
  // KNOWN BUG: a replace range starting strictly inside a surrogate pair is
  // not widened to the pair start; the high surrogate is left behind alone.
  test.failing(
    'replace starting inside a surrogate pair widens to cover the whole pair',
    () => {
      const d = doc('📚plans\nfor the\nweekend');
      d.applyEdits([edit(0, 1, 0, 2, 'a')]);
      expect(hasLoneSurrogate(d.getText())).toBe(false);
      expect(d.getLineText(0)).toBe('aplans');
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "high-low surrogates 3"
  // KNOWN BUG: a replace range ending strictly inside a surrogate pair is not
  // widened to the pair end; the low surrogate is left behind alone.
  test.failing(
    'replace ending inside a surrogate pair widens to cover the whole pair',
    () => {
      const d = doc('📚plans\nfor the\nweekend');
      d.applyEdits([edit(0, 0, 0, 1, 'a')]);
      expect(hasLoneSurrogate(d.getText())).toBe(false);
      expect(d.getLineText(0)).toBe('aplans');
    }
  );

  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "high-low surrogates 4"
  test('replace spanning exactly the whole surrogate pair replaces it cleanly', () => {
    const d = doc('📚plans\nfor the\nweekend');
    d.applyEdits([edit(0, 0, 0, 2, 'a')]);
    expect(d.getLineText(0)).toBe('aplans');
    expect(d.getText()).toBe('aplans\nfor the\nweekend');
  });
});

describe('applyEdits: touching edits', () => {
  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "touching edits: two inserts at the same position"
  test('two zero-width inserts at the identical position apply in input order', () => {
    const d = doc('mole');
    d.applyEdits([edit(0, 1, 0, 1, 'a'), edit(0, 1, 0, 1, 'b')]);
    expect(d.getText()).toBe('mabole');

    // Swapping the input order swaps the output order: ordering comes from
    // the caller's array, not from any property of the edits themselves.
    const d2 = doc('mole');
    d2.applyEdits([edit(0, 1, 0, 1, 'b'), edit(0, 1, 0, 1, 'a')]);
    expect(d2.getText()).toBe('mbaole');
  });
});

describe('applyEdits: compound multi-cursor batches and undo', () => {
  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "issue #48741: Broken undo stack with move lines up with multiple cursors"
  test('undo exactly restores the original text after a compound batch of touching edits', () => {
    // Simulates a two-cursor move-line-up: one edit deletes a line body,
    // another deletes an adjacent line including its break, and two
    // zero-width inserts re-create the moved lines — all ranges touching at
    // their endpoints, applied as one history transaction.
    const original = 'alpha\nbravo\ncharlie\n';
    const d = doc(original);
    d.applyEdits(
      [
        edit(3, 0, 3, 0, 'charlie'),
        edit(2, 0, 2, 7, ''),
        edit(1, 0, 2, 0, ''),
        edit(2, 7, 2, 7, '\nbravo'),
      ],
      true
    );
    expect(d.getText()).toBe('alpha\n\nbravo\ncharlie');

    expect(d.canUndo).toBe(true);
    d.undo();
    expect(d.getText()).toBe(original);

    // The transaction stays reversible in both directions.
    d.redo();
    expect(d.getText()).toBe('alpha\n\nbravo\ncharlie');
    d.undo();
    expect(d.getText()).toBe(original);
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #93585: Undo multi cursor edit corrupts document"
  test('undo restores a batch that replaced two equal-size selections with shorter text', () => {
    const original = 'green apples\ngreen apples';
    const d = doc(original);
    // Both cursors have "apples" selected (given bottom-first, as an editor
    // would after adding a selection above) and type the shorter "figs".
    const selectionsBefore = [select(1, 6, 1, 12), select(0, 6, 0, 12)];
    d.applyEdits(
      [edit(1, 6, 1, 12, 'figs'), edit(0, 6, 0, 12, 'figs')],
      true,
      selectionsBefore,
      [select(1, 10, 1, 10), select(0, 10, 0, 10)]
    );
    expect(d.getText()).toBe('green figs\ngreen figs');

    const undone = d.undo();
    expect(d.getText()).toBe(original);
    expect(undone?.[1]).toEqual(selectionsBefore);
  });
});

describe('applyEdits: astral characters and undo history', () => {
  // monaco-legacy: src/vs/editor/test/common/model/editableTextModel.test.ts — "issue #47733: Undo mangles unicode characters"
  test('manually applied inverse edits round-trip inserts on both sides of an astral character', () => {
    const original = 'x👁y';
    const d = doc(original);

    // Two separate applyEdits calls: one insert immediately before the
    // surrogate pair, one immediately after it (positions in UTF-16 units).
    d.applyEdits([edit(0, 1, 0, 1, '(')]);
    d.applyEdits([edit(0, 4, 0, 4, ')')]);
    expect(d.getText()).toBe('x(👁)y');

    // Ranges near the pair still resolve correctly after the inserts.
    expect(
      d.getText({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
      })
    ).toBe('👁');
    expect(
      d.getText({
        start: { line: 0, character: 4 },
        end: { line: 0, character: 5 },
      })
    ).toBe(')');

    // The exact inverse of both inserts, applied as one batch.
    d.applyEdits([edit(0, 1, 0, 2, ''), edit(0, 4, 0, 5, '')]);
    expect(d.getText()).toBe(original);
    expect(hasLoneSurrogate(d.getText())).toBe(false);
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "issue #47733: Undo mangles unicode characters"
  test('undo and redo round-trip a history entry whose edits touch a surrogate pair', () => {
    // Auto-surround of the leading quote in '👁' with %: two zero-width
    // inserts in one transaction, the second landing immediately before the
    // surrogate pair.
    const original = "'👁'";
    const d = doc(original);
    d.applyEdits([edit(0, 0, 0, 0, '%'), edit(0, 1, 0, 1, '%')], true, [
      select(0, 0, 0, 1),
    ]);
    expect(d.getText()).toBe("%'%👁'");

    d.undo();
    expect(d.getText()).toBe(original);
    expect(hasLoneSurrogate(d.getText())).toBe(false);

    d.redo();
    expect(d.getText()).toBe("%'%👁'");
    expect(hasLoneSurrogate(d.getText())).toBe(false);

    d.undo();
    expect(d.getText()).toBe(original);
  });
});
