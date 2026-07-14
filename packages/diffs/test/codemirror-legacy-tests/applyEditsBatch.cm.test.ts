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

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return { start: position, end: position, direction: DirectionNone };
}

// Deterministic pseudo-random source (32-bit LCG) so the randomized round-trip
// test replays the exact same edit sequence on every run.
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('applyEdits batch: insert at a deletion boundary', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "can create change sets"
  test('an insert listed before a delete starting at the same offset applies, keeping the insertion', () => {
    // Zero-width insert at offset 5 plus delete of [5,7): the inserted text
    // survives in front of the deleted span, like CodeMirror's deterministic
    // handling of an insertion at a deletion's start boundary.
    const d = doc('grapevines');
    d.applyEdits([edit(0, 5, 0, 5, 'XY'), edit(0, 5, 0, 7, '')]);
    expect(d.getText()).toBe('grapeXYnes');
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "can create change sets"
  // KNOWN BUG: acceptance of the batch {delete [5,7), insert at 5} depends on
  // the caller's array order. Validation stable-sorts by start offset and
  // rejects any pair where prev.end > next.start, so with the delete listed
  // first the (5,7) delete stays ahead of the (5,5) insert and the same
  // logical batch throws 'Overlapping text edits are not supported', while
  // the insert-first order succeeds. CodeMirror's ChangeSet.of accepts the
  // batch deterministically regardless of input order.
  test.failing(
    'the same logical batch with the delete listed first behaves identically',
    () => {
      const d = doc('grapevines');
      d.applyEdits([edit(0, 5, 0, 7, ''), edit(0, 5, 0, 5, 'XY')]);
      expect(d.getText()).toBe('grapeXYnes');
    }
  );
});

describe('applyEdits: randomized single-edit invert round-trip', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "survives random sequences of changes"
  test('50 random history edits undo to the byte-identical original and redo to the final text', () => {
    const insertAlphabet = 'twilight harbor\nquiet mooring\n';
    for (const seed of [11, 29, 173]) {
      const rand = makeRandom(seed);
      const original = 'signal flags\nover the pier\n';
      const d = doc(original);
      let mirror = original;

      for (let step = 0; step < 50; step++) {
        const length = mirror.length;
        const from = Math.floor(rand() * (length + 1));
        const to = Math.min(length, from + Math.floor(rand() * 6));
        let insert = '';
        const insertLength = Math.floor(rand() * 5);
        for (let k = 0; k < insertLength; k++) {
          insert += insertAlphabet[Math.floor(rand() * insertAlphabet.length)];
        }
        if (from === to && insert === '') {
          insert = '+'; // keep every step a real edit
        }
        // Each edit records its own history entry: undoBoundary=true defeats
        // typing/backspace coalescing so the undo stack holds all 50 steps.
        d.applyEdits(
          [
            {
              range: { start: d.positionAt(from), end: d.positionAt(to) },
              newText: insert,
            },
          ],
          true,
          undefined,
          undefined,
          true
        );
        mirror = mirror.slice(0, from) + insert + mirror.slice(to);
        expect(d.getText()).toBe(mirror);
      }

      expect(d.version).toBe(50);
      let undoCount = 0;
      while (d.canUndo) {
        d.undo();
        undoCount++;
      }
      expect(undoCount).toBe(50);
      expect(d.getText()).toBe(original);
      expect(d.version).toBe(0);

      let redoCount = 0;
      while (d.canRedo) {
        d.redo();
        redoCount++;
      }
      expect(redoCount).toBe(50);
      expect(d.getText()).toBe(mirror);
      expect(d.version).toBe(50);
    }
  });
});

describe('applyEdits batch: changed line ranges across line-count changes', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "can be iterated"
  test('a line-adding first edit shifts the second edit into post-edit line numbers', () => {
    // Edit 1 splits line 0 in two (+1 line); edit 2 rewrites old line 3, which
    // is line 4 after the split. The reported ranges must be ascending and in
    // post-edit coordinates, one range per disjoint edit.
    const d = doc('ada\nbabbage\ncurie\ndarwin');
    const change = d.applyEdits([
      edit(0, 3, 0, 3, '\nhopper'),
      edit(3, 0, 3, 6, 'lovelace'),
    ]);
    expect(d.getText()).toBe('ada\nhopper\nbabbage\ncurie\nlovelace');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 3,
      endCharacter: 6,
      endLine: 4,
      endedAtDocumentEnd: true,
      previousLineCount: 4,
      lineCount: 5,
      lineDelta: 1,
      changedLineRanges: [
        [0, 1],
        [4, 4],
      ],
      changedLineChanges: [
        [0, 1, 1, 3, 3, false],
        [4, 4, 0, 0, 6, true],
      ],
    });
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "can be iterated"
  test('a line-removing first edit shifts the second edit down in post-edit line numbers', () => {
    // Edit 1 joins lines 0 and 1 (-1 line); edit 2 rewrites old line 3, which
    // is line 2 after the join.
    const d = doc('ada\nbabbage\ncurie\ndarwin');
    const change = d.applyEdits([
      edit(0, 3, 1, 0, ' '),
      edit(3, 0, 3, 6, 'lovelace'),
    ]);
    expect(d.getText()).toBe('ada babbage\ncurie\nlovelace');
    expect(change).toEqual({
      startLine: 0,
      startCharacter: 3,
      endCharacter: 6,
      endLine: 2,
      endedAtDocumentEnd: true,
      previousLineCount: 4,
      lineCount: 3,
      lineDelta: -1,
      changedLineRanges: [
        [0, 0],
        [2, 2],
      ],
      changedLineChanges: [
        [0, 0, -1, 3, 0, false],
        [2, 2, 0, 0, 6, true],
      ],
    });
  });
});

describe('applyEdits: no-op edits recorded in history', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "can handle empty sets"
  test('a zero-width empty edit bumps the version and its history entry undoes/redoes harmlessly', () => {
    const d = doc('anchor');
    const change = d.applyEdits([edit(0, 3, 0, 3, '')], true, [caret(0, 3)]);

    // The degenerate edit still produces a change record and a version bump,
    // but the buffer is untouched.
    expect(change?.lineDelta).toBe(0);
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);

    // Undoing the identity entry is a real history step that changes nothing.
    const undone = d.undo();
    expect(undone).toBeDefined();
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(0);
    expect(d.canRedo).toBe(true);

    const redone = d.redo();
    expect(redone).toBeDefined();
    expect(d.getText()).toBe('anchor');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "can handle empty sets"
  test('a no-op entry does not coalesce with real typing on either side', () => {
    const d = doc('');
    d.applyEdits([edit(0, 0, 0, 0, 'a')], true, [caret(0, 0)]);
    d.applyEdits([edit(0, 1, 0, 1, '')], true, [caret(0, 1)]); // no-op
    d.applyEdits([edit(0, 1, 0, 1, 'b')], true, [caret(0, 1)]);
    expect(d.getText()).toBe('ab');

    // Three separate undo steps: the identity entry neither merges into the
    // preceding keystroke nor lets the following keystroke merge across it.
    d.undo();
    expect(d.getText()).toBe('a');
    d.undo();
    expect(d.getText()).toBe('a');
    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    d.redo();
    d.redo();
    d.redo();
    expect(d.getText()).toBe('ab');
    expect(d.canRedo).toBe(false);
  });
});

describe('applyEdits: out-of-bounds edit ranges clamp instead of throwing', () => {
  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  // DIVERGENCE: CodeMirror rejects a change with from: -1 outright; pierre
  // normalizes every edit position through normalizePosition, so a negative
  // character (or negative line) clamps to the document start and the edit
  // applies to the clamped range.
  test('negative coordinates clamp to the document start', () => {
    const d = doc('kelp');
    d.applyEdits([edit(0, -1, 0, 1, '')]);
    expect(d.getText()).toBe('elp'); // delete resolved as [0,1)

    const d2 = doc('ab\ncd');
    d2.applyEdits([edit(-5, -5, -5, -5, '!')]);
    expect(d2.getText()).toBe('!ab\ncd'); // insert resolved at offset 0
  });

  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  // DIVERGENCE: CodeMirror rejects to: 10 on a 4-char document; pierre clamps
  // the end character to the line length, so the replacement absorbs exactly
  // the real tail of the line.
  test('an end character past the line length clamps to the line end', () => {
    const d = doc('kelp');
    d.applyEdits([edit(0, 2, 0, 10, 'x')]);
    expect(d.getText()).toBe('kex'); // range resolved as [2,4)
  });

  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  // DIVERGENCE: CodeMirror throws for any position beyond the document;
  // pierre clamps the line to the last line but keeps a character that is
  // still in range on that line — an edit addressed to line 9 lands mid-way
  // through the final line, not at the document end.
  test('a line beyond EOF clamps to the last line, preserving an in-range character', () => {
    const d = doc('ab\ncd');
    d.applyEdits([edit(9, 1, 9, 1, '!')]);
    expect(d.getText()).toBe('ab\nc!d'); // resolved to (line 1, character 1)

    // Only when the character also overshoots does the edit land at doc end.
    const d2 = doc('ab\ncd');
    d2.applyEdits([edit(9, 99, 9, 99, '!')]);
    expect(d2.getText()).toBe('ab\ncd!');
  });

  // codemirror-legacy: cm-state/test/test-state.ts — "throws when a change's bounds are invalid"
  // DIVERGENCE: CodeMirror throws; pierre clamps a range end whose line
  // overshoots to (last line, in-range character), so the replacement runs
  // from the start position to that clamped point rather than to EOF.
  test('a range end on a line beyond EOF clamps into the last line', () => {
    const d = doc('ab\ncd');
    d.applyEdits([edit(0, 1, 7, 7, 'Z')]);
    // End (7,7) clamps to (line 1, character 2) — the document end — so the
    // replacement covers [1, 5).
    expect(d.getText()).toBe('aZ');
  });
});
