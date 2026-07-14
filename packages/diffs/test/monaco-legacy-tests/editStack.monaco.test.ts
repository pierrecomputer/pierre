// Undo/redo coalescing scenarios ported from Monaco/vscode. See README.md in
// this directory for suite conventions. The three test.failing entries here are
// the P0 known bugs: coalescing is decided purely by comparing edit geometry
// against whatever entry sits on top of the undo stack, with no state reset
// after undo()/redo() and no sticky typing-mode tracking.
import { describe, expect, test } from 'bun:test';

import { DirectionNone } from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number) {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

// Inserts `text` at the caret with history recording enabled, like a single
// keystroke (or a paste when `undoBoundary` is set).
function typeAt(
  d: ReturnType<typeof doc>,
  line: number,
  character: number,
  text: string,
  undoBoundary = false
) {
  d.applyEdits(
    [
      {
        range: {
          start: { line, character },
          end: { line, character },
        },
        newText: text,
      },
    ],
    true,
    [caret(line, character)],
    undefined,
    undoBoundary
  );
}

// Deletes the character before the caret, like a single Backspace keystroke.
// The caret sits at the right edge of the deleted range.
function backspaceAt(
  d: ReturnType<typeof doc>,
  line: number,
  caretChar: number
) {
  d.applyEdits(
    [
      {
        range: {
          start: { line, character: caretChar - 1 },
          end: { line, character: caretChar },
        },
        newText: '',
      },
    ],
    true,
    [caret(line, caretChar)]
  );
}

// Deletes the character after the caret, like a single forward Delete
// keystroke. The caret sits at the left edge of the deleted range.
function forwardDeleteAt(
  d: ReturnType<typeof doc>,
  line: number,
  caretChar: number
) {
  d.applyEdits(
    [
      {
        range: {
          start: { line, character: caretChar },
          end: { line, character: caretChar + 1 },
        },
        newText: '',
      },
    ],
    true,
    [caret(line, caretChar)]
  );
}

describe('EditStack coalescing across undo/redo (monaco-legacy)', () => {
  // monaco-legacy: src/vs/editor/common/cursor/cursor.ts — "onModelContentChanged resets _prevEditOperationType, forcing an undo stop after every undo/redo"
  // KNOWN BUG: after undo() pops the top entry, new typing that happens to sit
  // adjacent to the newly exposed entry coalesces into it, so one undo wipes out
  // committed pre-undo history along with the fresh keystroke.
  test.failing(
    'typing after an undo never merges into pre-undo history',
    () => {
      const d = doc('hello\nworld');
      typeAt(d, 0, 0, 'a'); // entry 1: "ahello\nworld"
      typeAt(d, 1, 0, 'Z'); // entry 2 (different line, no coalesce): "ahello\nZworld"
      d.undo(); // pops entry 2, entry 1 is now on top
      expect(d.getText()).toBe('ahello\nworld');

      typeAt(d, 0, 1, 'b'); // brand-new keystroke, adjacent to entry 1's insert
      expect(d.getText()).toBe('abhello\nworld');

      // One undo must remove only the new 'b', not entry 1's 'a' with it.
      d.undo();
      expect(d.getText()).toBe('ahello\nworld');

      // Redo direction: the 'b' keystroke comes back on its own.
      d.redo();
      expect(d.getText()).toBe('abhello\nworld');

      // The full history unwinds one keystroke at a time.
      d.undo();
      d.undo();
      expect(d.getText()).toBe('hello\nworld');
      expect(d.canUndo).toBe(false);
    }
  );

  // monaco-legacy: src/vs/editor/common/cursor/cursorTypeOperations.ts — "paste pushes an undo stop before and after; the stop is durable, not consumed by undo"
  // KNOWN BUG: an undoBoundary entry blocks merging only while it sits on the
  // undo stack; once it is undone, the entry beneath it is exposed and new
  // typing merges straight through into it as if the boundary never existed.
  test.failing(
    'an undone boundary entry still shields the entry beneath it from coalescing',
    () => {
      const d = doc('hello');
      typeAt(d, 0, 0, 'a'); // entry 1: "ahello"
      typeAt(d, 0, 1, 'XYZ', true); // paste with boundary: "aXYZhello"
      d.undo(); // pops the paste, entry 1 is on top again
      expect(d.getText()).toBe('ahello');

      typeAt(d, 0, 1, 'b'); // ordinary keystroke adjacent to entry 1's insert
      expect(d.getText()).toBe('abhello');

      // One undo must remove only 'b'; 'a' predates the paste boundary.
      d.undo();
      expect(d.getText()).toBe('ahello');

      // Redo direction: only the 'b' keystroke replays.
      d.redo();
      expect(d.getText()).toBe('abhello');

      d.undo();
      d.undo();
      expect(d.getText()).toBe('hello');
      expect(d.canUndo).toBe(false);
    }
  );

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "there is an undo stop between deleting left and deleting right"
  // KNOWN BUG: a Backspace followed by a forward Delete at the same pivot
  // coalesces into one undo step; the pivot offset maps ambiguously onto the end
  // of the just-deleted range, so the pair passes the 'delete'-mode check.
  test.failing(
    'switching from backspace to forward delete creates a new undo stop',
    () => {
      const d = doc('abc');
      backspaceAt(d, 0, 2); // removes 'b' -> "ac", caret lands at (0,1)
      forwardDeleteAt(d, 0, 1); // removes 'c' -> "a"
      expect(d.getText()).toBe('a');

      // First undo restores only the forward-deleted character.
      d.undo();
      expect(d.getText()).toBe('ac');

      // Second undo restores the backspaced character.
      d.undo();
      expect(d.getText()).toBe('abc');
      expect(d.canUndo).toBe(false);

      // Redo direction: the two deletes replay as separate steps.
      d.redo();
      expect(d.getText()).toBe('ac');
      d.redo();
      expect(d.getText()).toBe('a');
      expect(d.canRedo).toBe(false);
    }
  );

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "there is no undo stop after a single whitespace"
  // DIVERGENCE: vscode breaks typed runs at whitespace (a lone space merges with
  // the word before it, but typing after the space starts a new undo stop), so
  // typing "ab cd" yields 2 undo steps ("ab cd" -> "ab" -> ""). Pierre's
  // coalescing is purely adjacency-based with no character-content awareness,
  // so the whole typed sentence collapses into a single undo step. Pinned as a
  // design choice; vscode's space-boundary rule is the alternative if product
  // ever wants word-granular undo.
  test('a typed sentence with a single space coalesces into one undo step', () => {
    const d = doc('');
    typeAt(d, 0, 0, 'a');
    typeAt(d, 0, 1, 'b');
    typeAt(d, 0, 2, ' ');
    typeAt(d, 0, 3, 'c');
    typeAt(d, 0, 4, 'd');
    expect(d.getText()).toBe('ab cd');

    // One undo clears the entire sentence, space included.
    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    // Redo direction: one redo restores the entire sentence.
    d.redo();
    expect(d.getText()).toBe('ab cd');
    expect(d.canRedo).toBe(false);
  });

  // monaco-legacy: src/vs/editor/test/browser/controller/cursor.test.ts — "there is a single undo stop for consecutive whitespaces"
  // DIVERGENCE: vscode isolates a run of two-or-more consecutive spaces into its
  // own undo step, so typing "ab  cd" yields 3 undo steps ("ab  cd" -> "ab  "
  // -> "ab" -> ""). Pierre coalesces the entire run of keystrokes, spaces and
  // all, into one undo step. Pinned as the same adjacency-only design choice as
  // the single-space case above.
  test('consecutive typed spaces coalesce into the surrounding typing', () => {
    const d = doc('');
    typeAt(d, 0, 0, 'a');
    typeAt(d, 0, 1, 'b');
    typeAt(d, 0, 2, ' ');
    typeAt(d, 0, 3, ' ');
    typeAt(d, 0, 4, 'c');
    typeAt(d, 0, 5, 'd');
    expect(d.getText()).toBe('ab  cd');

    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    d.redo();
    expect(d.getText()).toBe('ab  cd');
    expect(d.canRedo).toBe(false);
  });
});
