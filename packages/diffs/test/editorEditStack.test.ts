import { describe, expect, test } from 'bun:test';

import {
  createEditStackEntry,
  EditStack,
  shouldCoalesceEditStackEntry,
} from '../src/editor/editStack';
import { DirectionNone } from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';
import type {
  EditorSelection,
  SelectionDirection,
  TextEdit,
} from '../src/types';

function createSelection(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionNone
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction,
  };
}

function caret(character: number) {
  return createSelection(0, character, 0, character, DirectionNone);
}

function stackEntry(
  textBeforeEdit: string,
  resolvedEdits: { start: number; end: number; text: string }[],
  versionBefore: number,
  versionAfter: number,
  selectionsBefore?: EditorSelection[],
  selectionsAfter?: EditorSelection[]
) {
  const doc = new TextDocument(
    'inmemory://edit-stack-test',
    textBeforeEdit,
    'plain',
    versionBefore
  );
  return createEditStackEntry(
    doc,
    resolvedEdits,
    versionBefore,
    versionAfter,
    selectionsBefore,
    selectionsAfter
  );
}

describe('EditHistory', () => {
  test('push stores cloned selections and pop methods move entries between stacks', () => {
    const editStack = new EditStack();
    const selectionBefore = [caret(0), caret(1)];
    const selectionAfter = [caret(2), caret(3)];

    editStack.push(
      stackEntry(
        'ab',
        [{ start: 1, end: 1, text: 'X' }],
        4,
        5,
        selectionBefore,
        selectionAfter
      )
    );

    selectionBefore[0] = caret(99);
    selectionAfter[0] = caret(99);

    expect(editStack.canUndo).toBe(true);
    expect(editStack.canRedo).toBe(false);

    const entry = editStack.popUndoToRedo();

    expect(entry).toEqual({
      forwardEdits: [{ start: 1, end: 1, text: 'X' }],
      inverseEdits: [{ start: 1, end: 2, text: '' }],
      versionBefore: 4,
      versionAfter: 5,
      selectionsBefore: [caret(0), caret(1)],
      selectionsAfter: [caret(2), caret(3)],
    });
    expect(editStack.canUndo).toBe(false);
    expect(editStack.canRedo).toBe(true);

    expect(editStack.popRedoToUndo()).toEqual(entry);
    expect(editStack.canUndo).toBe(true);
    expect(editStack.canRedo).toBe(false);
  });

  test('setLastUndoSelectionsAfter stores cloned redo selections', () => {
    const editStack = new EditStack();
    let selectionAfter = caret(2);

    editStack.push(
      stackEntry(
        'a',
        [{ start: 1, end: 1, text: 'b' }],
        1,
        2,
        [caret(1)],
        [selectionAfter]
      )
    );
    selectionAfter = caret(99);

    expect(editStack.popUndoToRedo()).toMatchObject({
      selectionsAfter: [caret(2)],
    });
  });

  test('push clears redo history when recording a new undo entry', () => {
    const editStack = new EditStack();

    editStack.push(
      stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1, [caret(0)])
    );
    editStack.push(
      stackEntry('a', [{ start: 1, end: 1, text: 'b' }], 1, 2, [caret(1)])
    );

    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 1, end: 1, text: 'b' }],
    });
    expect(editStack.canRedo).toBe(true);

    editStack.push(
      stackEntry('a', [{ start: 1, end: 1, text: 'c' }], 1, 2, [caret(1)])
    );

    expect(editStack.canRedo).toBe(false);
    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 1, end: 1, text: 'c' }],
    });
    expect(editStack.popUndoToRedo()).toMatchObject({
      forwardEdits: [{ start: 0, end: 0, text: 'a' }],
    });
  });

  test('maxEntries drops oldest undo history first', () => {
    const editStack = new EditStack({ maxEntries: 3 });

    for (let i = 0; i < 4; i++) {
      editStack.push(
        stackEntry('', [{ start: 0, end: 0, text: `${i}` }], i, i + 1, [
          caret(0),
        ])
      );
    }

    const third = editStack.popUndoToRedo();
    expect(third?.forwardEdits[0]?.text).toBe('3');
    expect(editStack.popUndoToRedo()?.forwardEdits[0]?.text).toBe('2');
    expect(editStack.popUndoToRedo()?.forwardEdits[0]?.text).toBe('1');
    expect(editStack.popUndoToRedo()).toBeUndefined();
  });

  test('clear resets both undo and redo stacks', () => {
    const editStack = new EditStack();

    editStack.push(
      stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1, [caret(0)])
    );
    editStack.popUndoToRedo();
    editStack.clear();

    expect(editStack.canUndo).toBe(false);
    expect(editStack.canRedo).toBe(false);
    expect(editStack.popUndoToRedo()).toBeUndefined();
    expect(editStack.popRedoToUndo()).toBeUndefined();
  });
});

describe('shouldCoalesceEditStackEntry', () => {
  test('coalesces two consecutive single-character inserts', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1);
    const next = stackEntry('a', [{ start: 1, end: 1, text: 'b' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(true);
  });

  test('does not coalesce when the previous entry is an undo boundary', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1);
    previous.undoBoundary = true;
    const next = stackEntry('a', [{ start: 1, end: 1, text: 'b' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  test('does not coalesce when the next entry is an undo boundary', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1);
    const next = stackEntry('a', [{ start: 1, end: 1, text: 'b' }], 1, 2);
    next.undoBoundary = true;
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  // A newline insert must never merge into the typing before it. The editor
  // already prevents this with a separate `lineDelta === 0` check, so this test
  // calls the helper directly to protect other callers.
  test('does not coalesce a newline insert into preceding typing', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1);
    const next = stackEntry('a', [{ start: 1, end: 1, text: '\n' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  // Both edges of a pure insert map back to the same base offset, so the
  // left-edge case is rejected by after-edit position, not base offset.
  test('does not coalesce an insert typed at the left edge of the previous insert', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'a' }], 0, 1);
    const next = stackEntry('a', [{ start: 0, end: 0, text: 'b' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  test('does not coalesce an insert typed inside a previous multi-character insert', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'ab' }], 0, 1);
    const next = stackEntry('ab', [{ start: 1, end: 1, text: 'c' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  test('coalesces an insert that continues at the end of a multi-character insert run', () => {
    const previous = stackEntry('', [{ start: 0, end: 0, text: 'ab' }], 0, 1);
    const next = stackEntry('ab', [{ start: 2, end: 2, text: 'c' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(true);
  });

  test('does not coalesce typing before a just-replaced selection', () => {
    const previous = stackEntry(
      'hello',
      [{ start: 0, end: 5, text: 'w' }],
      0,
      1
    );
    const next = stackEntry('w', [{ start: 0, end: 0, text: 'o' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(false);
  });

  test('coalesces typing after a just-replaced selection', () => {
    const previous = stackEntry(
      'hello',
      [{ start: 0, end: 5, text: 'w' }],
      0,
      1
    );
    const next = stackEntry('w', [{ start: 1, end: 1, text: 'o' }], 1, 2);
    expect(shouldCoalesceEditStackEntry(previous, next)).toBe(true);
  });
});

// --- Shared helpers for the undo/redo coalescing and history scenarios below ---

function doc(text: string, editStack?: EditStack<unknown>) {
  return new TextDocument('inmemory://1', text, 'plain', 0, editStack);
}

function caretAt(line: number, character: number) {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

// Inserts single-line `text` at the caret with history recording enabled, like
// one keystroke (or a paste when `undoBoundary` is set). Records both the
// pre-keystroke caret and the caret sitting after the inserted text, the way
// the editor does for typing.
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
    [caretAt(line, character)],
    [caretAt(line, character + text.length)],
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
    [caretAt(line, caretChar)]
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
    [caretAt(line, caretChar)]
  );
}

// Runs undo (or redo) to exhaustion and returns how many steps it took, so
// traversal tests can assert the step count stays stable across cycles.
function undoAll(d: ReturnType<typeof doc>) {
  let steps = 0;
  while (d.canUndo) {
    d.undo();
    steps++;
  }
  return steps;
}

function redoAll(d: ReturnType<typeof doc>) {
  let steps = 0;
  while (d.canRedo) {
    d.redo();
    steps++;
  }
  return steps;
}

// Undo/redo coalescing scenarios. The three test.failing entries here are
// known bugs: coalescing is decided purely by comparing edit geometry against
// whatever entry sits on top of the undo stack, with no state reset after
// undo()/redo() and no sticky typing-mode tracking.
describe('EditStack coalescing across undo and redo', () => {
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

  // DIVERGENCE: the conventional behavior breaks typed runs at whitespace (a
  // lone space merges with the word before it, but typing after the space
  // starts a new undo stop), so typing "ab cd" yields 2 undo steps
  // ("ab cd" -> "ab" -> ""). Pierre's coalescing is purely adjacency-based
  // with no character-content awareness, so the whole typed sentence
  // collapses into a single undo step. Pinned as a design choice; the
  // conventional space-boundary rule is the alternative if product ever
  // wants word-granular undo.
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

  // DIVERGENCE: the conventional behavior isolates a run of two-or-more
  // consecutive spaces into its own undo step, so typing "ab  cd" yields 3
  // undo steps ("ab  cd" -> "ab  " -> "ab" -> ""). Pierre coalesces the
  // entire run of keystrokes, spaces and all, into one undo step. Pinned as
  // the same adjacency-only design choice as the single-space case above.
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

// Undo/redo selection restore and history traversal scenarios. Selections
// restored by undo()/redo() are the ones recorded in the edit stack entry at
// edit time: undo() returns the entry's selectionsBefore and redo() its
// selectionsAfter as the second tuple element. Selection-only movement
// between edits never reaches TextDocument (the Editor only calls
// setLastUndoSelectionsAfter when it applies edits), so a caret that wanders
// off after an edit cannot overwrite the recorded restore points — but it
// also cannot break a coalescing group, which is the one pinned divergence
// below.
describe('TextDocument history selection restore', () => {
  // After the edit, the user moves the caret to the end of the document. That
  // is a selection-only step that never reaches TextDocument, so redo must
  // hand back the caret recorded when the edit was made, not the undo-time one.
  test('redo restores the caret recorded at edit time, not the undo-time caret', () => {
    const d = doc('red\n\nblue');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 3 },
          },
          newText: '!',
        },
      ],
      true,
      [caretAt(0, 3)],
      [caretAt(0, 4)]
    );
    expect(d.getText()).toBe('red!\n\nblue');
    // (caret wanders to the end of the document — invisible to the document)

    const undoResult = d.undo();
    expect(d.getText()).toBe('red\n\nblue');
    expect(undoResult?.[1]).toEqual([caretAt(0, 3)]);

    const redoResult = d.redo();
    expect(d.getText()).toBe('red!\n\nblue');
    expect(redoResult?.[1]).toEqual([caretAt(0, 4)]);
  });

  // Before every traversal step the caret jumps to the top of the document
  // (selection-only, unrecorded). Each undo/redo must keep returning the
  // selections stored in the entry, unchanged by the traversal itself.
  test('undo-redo-undo keeps returning the recorded before/after selections', () => {
    const d = doc('ash\noak\nelm');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
          },
          newText: '.',
        },
      ],
      true,
      [caretAt(1, 3)],
      [caretAt(1, 4)]
    );
    expect(d.getText()).toBe('ash\noak.\nelm');

    // (caret jumps to (0,0) before every step — invisible to the document)
    expect(d.undo()?.[1]).toEqual([caretAt(1, 3)]);
    expect(d.getText()).toBe('ash\noak\nelm');

    expect(d.redo()?.[1]).toEqual([caretAt(1, 4)]);
    expect(d.getText()).toBe('ash\noak.\nelm');

    expect(d.undo()?.[1]).toEqual([caretAt(1, 3)]);
    expect(d.getText()).toBe('ash\noak\nelm');

    // A second full cycle still reads the same stored selections: traversal
    // moves entries between stacks without mutating them.
    expect(d.redo()?.[1]).toEqual([caretAt(1, 4)]);
    expect(d.undo()?.[1]).toEqual([caretAt(1, 3)]);
  });

  // Three keystrokes coalesce into one undo entry; the merged entry must keep
  // the selectionsBefore of the FIRST keystroke (keeping an intermediate
  // keystroke's caret instead is a known regression class).
  test('undoing a coalesced typing run restores the caret from before the first keystroke', () => {
    const d = doc('');
    typeAt(d, 0, 0, 'q');
    typeAt(d, 0, 1, 'r');
    typeAt(d, 0, 2, 's');
    expect(d.getText()).toBe('qrs');

    const undoResult = d.undo();
    expect(d.getText()).toBe('');
    // The whole run was a single entry...
    expect(d.canUndo).toBe(false);
    // ...and it restores the pre-first-keystroke caret, not (0,1) or (0,2).
    expect(undoResult?.[1]).toEqual([caretAt(0, 0)]);

    // The redo side of the merged entry keeps the LAST keystroke's after-caret.
    const redoResult = d.redo();
    expect(d.getText()).toBe('qrs');
    expect(redoResult?.[1]).toEqual([caretAt(0, 3)]);
  });

  // DIVERGENCE: the conventional behavior tracks selection-only transactions
  // and starts a new undo group whenever one lands between two document
  // changes, so this flow yields two undo steps there. Pierre's coalescing is
  // purely geometric over edit offsets (shouldCoalesceEditStackEntry) and
  // TextDocument has no channel for selection-only transactions, so a caret
  // that moves away and comes back between keystrokes leaves no trace and the
  // run still merges. The coalescing tests above ("EditStack coalescing
  // across undo and redo") pin the related content-based whitespace-grouping
  // divergence; this pins the missing selection-movement heuristic.
  test('a caret round-trip between two keystrokes does not break the undo group', () => {
    const d = doc('');
    typeAt(d, 0, 0, 'a');
    // (caret moves to (0,0), then back to (0,1) — selection-only, unrecorded)
    typeAt(d, 0, 1, 'b');
    expect(d.getText()).toBe('ab');

    const undoResult = d.undo();
    // One undo removes both characters: the round trip did not split the group.
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);
    expect(undoResult?.[1]).toEqual([caretAt(0, 0)]);
  });

  // The reference fixture's actual edit sequence — type, select the typed
  // word, replace the selection — lands on the same two-step outcome here,
  // but via edit geometry (a ranged replacement never merges into a typing
  // run), not via a selection-change heuristic.
  test('replacing a selection right after typing starts a new undo step', () => {
    const d = doc('');
    typeAt(d, 0, 0, 'h');
    typeAt(d, 0, 1, 'i');
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: 'howdy',
        },
      ],
      true,
      [
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
          direction: DirectionNone,
        },
      ],
      [caretAt(0, 5)]
    );
    expect(d.getText()).toBe('howdy');

    d.undo();
    expect(d.getText()).toBe('hi');
    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    d.redo();
    expect(d.getText()).toBe('hi');
    d.redo();
    expect(d.getText()).toBe('howdy');
    expect(d.canRedo).toBe(false);
  });

  // Mixed history: a coalesced typing run, a paste guarded by an undoBoundary,
  // a multi-line insert (never merges into typing), and a trailing keystroke.
  // Four full undo-to-exhaustion / redo-to-exhaustion cycles must be
  // idempotent: identical text and version at both extremes, stable step
  // counts, and stable canUndo/canRedo flags — traversal must not mutate stack
  // entries or drift the document version.
  test('full undo/redo traversal over mixed history is idempotent across repeated cycles', () => {
    const d = doc('');
    // Typing run: "log jam", one keystroke at a time (coalesces).
    typeAt(d, 0, 0, 'l');
    typeAt(d, 0, 1, 'o');
    typeAt(d, 0, 2, 'g');
    typeAt(d, 0, 3, ' ');
    typeAt(d, 0, 4, 'j');
    typeAt(d, 0, 5, 'a');
    typeAt(d, 0, 6, 'm');
    // Paste at the start of the line (undo boundary, its own step).
    typeAt(d, 0, 0, 'pine ', true);
    // Multi-line insert at the end of the line (its own step).
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 12 },
          },
          newText: '\nfern\nmoss',
        },
      ],
      true,
      [caretAt(0, 12)],
      [caretAt(2, 4)]
    );
    // One more keystroke after the multi-line insert (its own step).
    typeAt(d, 2, 4, '!');

    const fullText = d.getText();
    expect(fullText).toBe('pine log jam\nfern\nmoss!');
    const fullVersion = d.version;

    const firstUndoSteps = undoAll(d);
    expect(d.getText()).toBe('');
    const emptyVersion = d.version;
    const firstRedoSteps = redoAll(d);
    expect(d.getText()).toBe(fullText);
    expect(firstUndoSteps).toBe(firstRedoSteps);

    for (let cycle = 0; cycle < 4; cycle++) {
      expect(undoAll(d)).toBe(firstUndoSteps);
      expect(d.getText()).toBe('');
      expect(d.version).toBe(emptyVersion);
      expect(d.canUndo).toBe(false);
      expect(d.canRedo).toBe(true);

      expect(redoAll(d)).toBe(firstRedoSteps);
      expect(d.getText()).toBe(fullText);
      expect(d.version).toBe(fullVersion);
      expect(d.canUndo).toBe(true);
      expect(d.canRedo).toBe(false);
    }
  });

  // Three carets insert one character each in a single batch. Between the undo
  // and the redo the selection collapses to a single caret at the top of the
  // document (selection-only, unrecorded); redo must still restore all three
  // recorded after-carets, and undo all three before-carets.
  test('multi-cursor batch restores every caret on undo and redo', () => {
    const d = doc('ox\nelk\nbee\n');
    const selectionsBefore = [caretAt(0, 2), caretAt(1, 3), caretAt(2, 3)];
    const selectionsAfter = [caretAt(0, 3), caretAt(1, 4), caretAt(2, 4)];
    d.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 2 },
          },
          newText: '*',
        },
        {
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 3 },
          },
          newText: '*',
        },
        {
          range: {
            start: { line: 2, character: 3 },
            end: { line: 2, character: 3 },
          },
          newText: '*',
        },
      ],
      true,
      selectionsBefore,
      selectionsAfter
    );
    expect(d.getText()).toBe('ox*\nelk*\nbee*\n');

    // (selection collapses to a caret at (0,0) — invisible to the document)
    const undoResult = d.undo();
    expect(d.getText()).toBe('ox\nelk\nbee\n');
    expect(undoResult?.[1]).toEqual(selectionsBefore);

    // (selection collapses again before redo)
    const redoResult = d.redo();
    expect(d.getText()).toBe('ox*\nelk*\nbee*\n');
    expect(redoResult?.[1]).toEqual(selectionsAfter);
  });
});

// Every fixture in the non-history-edit scenarios below is single-line, so a
// character index on line 0 is also the flat document offset.
function lineEdit(
  startCharacter: number,
  endCharacter: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line: 0, character: startCharacter },
      end: { line: 0, character: endCharacter },
    },
    newText,
  };
}

// A history-recorded local edit, like typing or a command. The caret defaults
// to the edit start.
function localEdit(
  d: ReturnType<typeof doc>,
  startCharacter: number,
  endCharacter: number,
  newText: string,
  selectionsBefore?: EditorSelection[]
) {
  d.applyEdits(
    [lineEdit(startCharacter, endCharacter, newText)],
    true,
    selectionsBefore ?? [caretAt(0, startCharacter)]
  );
}

// A non-history edit: updateHistory=false, the TextDocument-level shape of a
// programmatic/remote change. It still joins the undo timeline (history
// equivalence), just without selection/undo-boundary metadata.
function remoteEdit(
  d: ReturnType<typeof doc>,
  startCharacter: number,
  endCharacter: number,
  newText: string
) {
  d.applyEdits([lineEdit(startCharacter, endCharacter, newText)], false);
}

// Undo/redo interacting with non-history edits (updateHistory=false).
//
// DESIGN MODEL (equivalence, implemented in TextDocument.applyResolvedEdits):
// applying an edit with updateHistory=false is an implementation detail of
// how the edit reaches applyEdits (the shape of programmatic/remote changes —
// collaborative patches, codemod fixes, etc.), not a separate semantic class
// of edit. Every edit joins the undo timeline: an untracked edit
// affects the edit stack exactly as the identical tracked call with no
// selections and no undo boundary would — it gets an entry (clearing any
// pending redo), coalesces by the normal geometry rules, and is unwound by
// undo and replayed by redo like any other entry, never rebased around. A
// mixed tracked/untracked sequence therefore leaves the document and its
// history in a state equivalent to the same sequence applied all-tracked.
// The headline contract — chosen because it sidesteps per-step grouping
// ambiguity — is exhaustion: after any edit sequence, undo-to-exhaustion
// restores the ORIGINAL byte-exact text and redo-to-exhaustion restores the
// FINAL text, no matter which edits skipped history tracking. Where a
// per-step value is asserted, it is the value the all-tracked reference run
// of the same script produces; the literals below are embedded from those
// reference runs. The rejected alternative — untracked edits survive undo
// while frozen history entries remap around them (rebasing) — is pinned
// against explicitly (the interior-insert and whole-document-replace tests).
describe('undo/redo across non-history edits', () => {
  // An untracked edit after the tracked range is its own timeline entry
  // sitting above the tracked one (insert at 10 is not adjacent to the
  // tracked insert's end at 5, so no coalescing), and LIFO order unwinds it
  // first — matching the all-tracked reference "sour lemon tart" ->
  // "sour lemon" -> "lemon". Previously this geometry pinned the old bypass
  // model (a single undo that skipped the untracked suffix).
  test('an untracked edit after the tracked range is its own undo step above it', () => {
    const d = doc('lemon');
    localEdit(d, 0, 0, 'sour '); // tracked: "sour lemon"
    remoteEdit(d, 10, 10, ' tart'); // remote suffix: "sour lemon tart"
    expect(d.getText()).toBe('sour lemon tart');
    d.undo();
    expect(d.getText()).toBe('sour lemon');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(true);
    d.undo();
    expect(d.getText()).toBe('lemon');
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);
    d.redo();
    expect(d.getText()).toBe('sour lemon');
    d.redo();
    expect(d.getText()).toBe('sour lemon tart');
    expect(d.canRedo).toBe(false);
  });

  // The two untracked inserts are part of the timeline, so exhaustion
  // reproduces the all-tracked reference ("syncpilot?" -> "syncpilot" ->
  // "pilot" -> "" and back); geometry blocks coalescing at both steps.
  test('a mixed tracked/untracked insert sequence unwinds and replays like the all-tracked timeline', () => {
    const d = doc('');
    localEdit(d, 0, 0, 'pilot'); // tracked typing
    remoteEdit(d, 0, 0, 'sync'); // untracked prefix: "syncpilot"
    remoteEdit(d, 9, 9, '?'); // untracked suffix: "syncpilot?"
    expect(d.getText()).toBe('syncpilot?');

    // Undo-to-exhaustion restores the original byte-exact text...
    undoAll(d);
    expect(d.getText()).toBe('');

    // ...and redo-to-exhaustion restores the final text.
    redoAll(d);
    expect(d.getText()).toBe('syncpilot?');
  });

  // The untracked insert is one more logical step (it cannot coalesce with a
  // three-edit batch), so exhaustion reproduces the all-tracked reference
  // ("UV####WXYZ" -> "UVWXYZ" -> "pqr" and back) — the untracked text is
  // unwound before the batch inverse applies, keeping its offsets valid.
  test('a replacement batch with an interleaved untracked insert unwinds and replays like the all-tracked timeline', () => {
    const d = doc('pqr');
    // One tracked batch of three adjacent replacements.
    d.applyEdits(
      [lineEdit(0, 1, 'UV'), lineEdit(1, 2, 'WX'), lineEdit(2, 3, 'YZ')],
      true,
      [caretAt(0, 3)]
    );
    expect(d.getText()).toBe('UVWXYZ');

    // Untracked insert exactly between the first and second replacements.
    remoteEdit(d, 2, 2, '####');
    expect(d.getText()).toBe('UV####WXYZ');

    // Undo-to-exhaustion restores the original byte-exact text — the
    // untracked insert is unwound too, exactly as if it had been tracked.
    undoAll(d);
    expect(d.getText()).toBe('pqr');

    // Redo-to-exhaustion restores the final text.
    redoAll(d);
    expect(d.getText()).toBe('UV####WXYZ');
  });

  // The untracked interior insert does NOT survive undo — it is one of the
  // undo steps like any other edit (rebasing it around the tracked entry is
  // the rejected model), and exhaustion reproduces the all-tracked reference
  // ("WXjYZ" -> "WXYZ" -> "" and back).
  test('an untracked insert inside a tracked insertion unwinds and replays like the all-tracked timeline', () => {
    const d = doc('');
    localEdit(d, 0, 0, 'WXYZ'); // tracked insertion
    remoteEdit(d, 2, 2, 'j'); // untracked insert in the middle of it
    expect(d.getText()).toBe('WXjYZ');

    undoAll(d);
    expect(d.getText()).toBe('');

    redoAll(d);
    expect(d.getText()).toBe('WXjYZ');
  });

  // An untracked replace that wipes the region a tracked insertion lives in
  // reads as one more logical step: the all-tracked reference unwinds
  // "core" -> "oGHk" -> "ok" and replays "oGHk" -> "core", and no state along
  // the way mixes the two texts — the strongest anti-corruption pin, since a
  // mixture like "cGHe" never existed on any timeline.
  test('an untracked whole-document replace over a tracked insertion unwinds and replays like the all-tracked timeline', () => {
    const d = doc('ok');
    localEdit(d, 1, 1, 'GH'); // tracked insert: "oGHk"
    remoteEdit(d, 0, 4, 'core'); // untracked replace of the whole doc
    expect(d.getText()).toBe('core');

    const visited: string[] = [];
    while (d.canUndo) {
      d.undo();
      visited.push(d.getText());
    }
    expect(d.getText()).toBe('ok');

    while (d.canRedo) {
      d.redo();
      visited.push(d.getText());
    }
    expect(d.getText()).toBe('core');

    // Every state the traversal visits must be one the all-tracked
    // timeline visits — no mixtures like "cGHe".
    for (const state of visited) {
      expect(['ok', 'oGHk', 'core']).toContain(state);
    }
  });

  // Stored selections need no remapping at all — by the time the tracked
  // delete's entry is undone, the untracked insert has itself been unwound,
  // so the document is back in the exact coordinate space the selections
  // were recorded in and they restore verbatim. The all-tracked reference
  // unwinds " worXYld" -> " world" -> "hello world" with the final undo
  // returning carets [6, 11] unchanged.
  test('undo exhaustion across an untracked insert restores the original text and the verbatim recorded selections', () => {
    const d = doc('hello world');
    // Tracked delete of the leading word, with two carets recorded.
    d.applyEdits([lineEdit(0, 5, '')], true, [caretAt(0, 6), caretAt(0, 11)]);
    expect(d.getText()).toBe(' world');

    // Untracked insert; in the original coordinates this lands at offset 9,
    // between the two stored carets.
    remoteEdit(d, 4, 4, 'XY');
    expect(d.getText()).toBe(' worXYld');

    let lastUndo: ReturnType<typeof d.undo>;
    while (d.canUndo) {
      lastUndo = d.undo();
    }
    expect(d.getText()).toBe('hello world');
    // Mirrors the all-tracked reference: the final undo hands back the
    // entry's stored selectionsBefore untouched.
    expect(lastUndo?.[1]?.map((s) => s.start.character)).toEqual([6, 11]);

    redoAll(d);
    expect(d.getText()).toBe(' worXYld');
  });

  // The untracked "b" is part of the timeline like any other edit — and
  // subject to NORMAL typing coalescing, not a forced boundary — so
  // undo-to-exhaustion restores the original (empty) text, not an untracked
  // remainder. The all-tracked run of this script unwinds "acb" -> "ab" -> ""
  // and replays "" -> "ab" -> "acb" (the "b" coalesces into the "a"
  // keystroke; "c" lands inside the merged insert and starts a new step);
  // however the mixed run groups its steps, exhaustion must hit the same
  // endpoints.
  test('typing around an untracked insert unwinds to the original text, not to an untracked remainder', () => {
    const d = doc('');
    localEdit(d, 0, 0, 'a'); // tracked keystroke: "a"
    remoteEdit(d, 1, 1, 'b'); // untracked: "ab"
    localEdit(d, 1, 1, 'c'); // tracked keystroke right after the "a": "acb"
    expect(d.getText()).toBe('acb');

    // Undo-to-exhaustion restores the original byte-exact text...
    undoAll(d);
    expect(d.getText()).toBe('');

    // ...and redo-to-exhaustion restores the final text.
    redoAll(d);
    expect(d.getText()).toBe('acb');
  });

  // An untracked edit is a new edit like any other: it joins the undo
  // timeline (here coalescing into the tracked keystroke by the normal
  // insert-adjacency rule, exactly as the all-tracked reference does) and,
  // while a redo entry is pending, pushing it clears the redo stack — the
  // parked entry never replays anywhere. Previously pinned the old bypass
  // model, where untracked edits touched neither stack.
  test('a non-history edit joins the undo timeline and clears the redo stack', () => {
    const d = doc('alpha');
    localEdit(d, 5, 5, '!'); // tracked: "alpha!"
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    // Starts exactly where the tracked insert ends, so it coalesces into the
    // "!" entry like continued typing would.
    remoteEdit(d, 6, 6, ' beta'); // "alpha! beta"
    expect(d.getText()).toBe('alpha! beta');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    // One coalesced step unwinds both inserts.
    d.undo();
    expect(d.getText()).toBe('alpha');
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);

    // A non-history edit while a redo entry is pending pushes a new entry
    // and clears the redo — the parked "! beta" entry is gone for good.
    remoteEdit(d, 5, 5, '?'); // "alpha?"
    expect(d.getText()).toBe('alpha?');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    d.redo(); // no-op: nothing left to redo
    expect(d.getText()).toBe('alpha?');
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);

    expect(undoAll(d)).toBe(1);
    expect(d.getText()).toBe('alpha');
    redoAll(d);
    expect(d.getText()).toBe('alpha?');
  });

  // The untracked ">> " insert is an ordinary new edit, and a new edit while
  // a redo is pending clears the redo stack (the same rule tracked edits
  // already follow) — the parked "!" entry never replays anywhere, so its
  // forward edit can never land at a stale offset. Matches the all-tracked
  // reference run: canRedo goes false after the ">> " edit, redo() is a
  // no-op at ">> note", undo-to-exhaustion yields "note", redo-to-exhaustion
  // ">> note".
  test('an untracked edit while a redo is pending behaves like a tracked edit and clears the redo', () => {
    const d = doc('note');
    localEdit(d, 4, 4, '!'); // tracked: "note!"
    d.undo();
    expect(d.getText()).toBe('note');
    expect(d.canRedo).toBe(true);

    remoteEdit(d, 0, 0, '>> '); // untracked prefix while redo is pending
    expect(d.getText()).toBe('>> note');

    // Mirrors the all-tracked reference: pushing a new edit clears redo,
    // so the pending "!" never replays anywhere.
    expect(d.canRedo).toBe(false);
    d.redo();
    expect(d.getText()).toBe('>> note');

    // Exhaustion in both directions matches the reference timeline.
    undoAll(d);
    expect(d.getText()).toBe('note');
    redoAll(d);
    expect(d.getText()).toBe('>> note');
  });
});

function insertEdit(
  line: number,
  character: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line, character },
      end: { line, character },
    },
    newText,
  };
}

// One history-recorded keystroke: inserts `text` at the caret position, with
// the pre-keystroke caret recorded, the way the editor drives typing.
function keystroke(
  d: ReturnType<typeof doc>,
  line: number,
  character: number,
  text: string
) {
  d.applyEdits([insertEdit(line, character, text)], true, [
    caretAt(line, character),
  ]);
}

// History/coalescing scenarios. Two areas: (1) degenerate history batches
// around undo — the conventional empty-transaction contract says a batch
// containing no edits must leave history untouched, and in particular must
// not destroy a pending redo; (2) a seeded randomized keystroke-run oracle
// asserting the typing/backspace/forward-delete coalescing pipeline never
// corrupts undo/redo round-trips. Deterministic coalescing cases are already
// pinned in test/editorTextDocument.test.ts and the sibling describes above
// in this file; nothing here repeats those.
describe('degenerate history batches around undo', () => {
  // The post-undo variant of the empty-transaction contract: the main suite
  // only checks an empty batch on a fresh document (canUndo stays false), so
  // the redo-stack half of the contract is pinned here.
  test('an empty history batch after undo leaves the redo stack ready to fire', () => {
    const d = doc('tide');
    keystroke(d, 0, 4, 'pool');
    expect(d.getText()).toBe('tidepool');
    d.undo();
    expect(d.getText()).toBe('tide');
    expect(d.version).toBe(0);
    expect(d.canRedo).toBe(true);

    // An empty batch with history requested pushes no entry, bumps no
    // version, and — critically — does not clear the pending redo.
    expect(d.applyEdits([], true, [caretAt(0, 0)])).toBeUndefined();
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);
    expect(d.version).toBe(0);

    // Even flagged as an undo boundary, the empty batch stays inert.
    expect(
      d.applyEdits([], true, [caretAt(0, 2)], [caretAt(0, 2)], true)
    ).toBeUndefined();
    expect(d.canRedo).toBe(true);
    expect(d.version).toBe(0);

    // The surviving redo replays the undone insert exactly.
    expect(d.redo()).toBeDefined();
    expect(d.getText()).toBe('tidepool');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  // An empty batch between two keystrokes leaves no trace at all: it must not
  // sever the typing coalescing group the way a real zero-width entry does
  // (that contrast is pinned in editorApplyEdits.test.ts).
  test('an empty history batch between keystrokes leaves the coalescing group intact', () => {
    const d = doc('');
    keystroke(d, 0, 0, 'w');
    d.applyEdits([], true, [caretAt(0, 1)], undefined, true);
    keystroke(d, 0, 1, 'o');
    expect(d.getText()).toBe('wo');

    // One undo step clears both characters: the empty batch was invisible.
    d.undo();
    expect(d.getText()).toBe('');
    expect(d.canUndo).toBe(false);

    d.redo();
    expect(d.getText()).toBe('wo');
    expect(d.canRedo).toBe(false);
  });

  // DIVERGENCE: the conventional behavior drops a transaction that made no
  // changes on the floor, so any no-op after undo preserves the redo stack.
  // Pierre records every non-empty edits array passed with updateHistory as a
  // real history step — identity entries on a fresh document are pinned that
  // way in editorApplyEdits.test.ts — and every recorded step clears redo,
  // the same rule as a real edit (pinned in test/editorTextDocument.test.ts
  // 'new edit after undo clears redo stack'). Coherent policy; pinned here at
  // the post-undo boundary where it costs the pending redo.
  test('a batch of zero-width empty edits after undo records a real step and drops redo', () => {
    const d = doc('fern');
    keystroke(d, 0, 4, '!');
    d.undo();
    expect(d.canRedo).toBe(true);

    const change = d.applyEdits([insertEdit(0, 2, '')], true, [caretAt(0, 2)]);
    expect(change).toBeDefined();
    expect(change?.lineDelta).toBe(0);
    expect(d.getText()).toBe('fern');
    expect(d.version).toBe(1);
    expect(d.canUndo).toBe(true);
    // The pending redo (the undone '!') is gone.
    expect(d.canRedo).toBe(false);

    // The identity entry is one clean history step: undo/redo round-trip the
    // version without touching the text, and nothing older sits beneath it.
    expect(d.undo()).toBeDefined();
    expect(d.getText()).toBe('fern');
    expect(d.version).toBe(0);
    expect(d.canUndo).toBe(false);
    expect(d.redo()).toBeDefined();
    expect(d.getText()).toBe('fern');
    expect(d.version).toBe(1);

    // A multi-edit degenerate batch behaves the same way: one entry, redo gone.
    const d2 = doc('reef\nkelp');
    keystroke(d2, 1, 4, 's');
    d2.undo();
    expect(d2.canRedo).toBe(true);
    d2.applyEdits([insertEdit(0, 1, ''), insertEdit(1, 2, '')], true, [
      caretAt(0, 1),
      caretAt(1, 2),
    ]);
    expect(d2.getText()).toBe('reef\nkelp');
    expect(d2.canRedo).toBe(false);
    expect(d2.canUndo).toBe(true);
    d2.undo();
    expect(d2.canUndo).toBe(false);
  });
});

// Deterministic pseudo-random source (mulberry32) so every fuzz run replays
// the identical operation stream for a given seed.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Maps an offset in the reference string to a {line, character} position,
// independent of the document under test.
function positionInMirror(text: string, offset: number) {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

const FUZZ_STEPS = 150;

// Drives one seeded run of FUZZ_STEPS random operations — multi-caret typing,
// backspace, forward delete, boundary-flagged pastes, and selection-only caret
// jumps — through history-tracked applyEdits while maintaining a reference
// string, then unwinds and replays the whole history.
function runSeededKeystrokeRun(seed: number) {
  const rand = seededRandom(seed);
  const baseText = 'harbor lights\ndim the quay\n';
  // A roomy injected stack keeps this a pure coalescing test: the run may
  // produce more entries than the default 100-entry cap, and entry eviction
  // (covered by the "maxEntries drops oldest undo history first" test above)
  // would break exhaustion.
  const d = doc(baseText, new EditStack({ maxEntries: 1000 }));
  let mirror = baseText;
  // Caret offsets into `mirror`, ascending and distinct; multi-caret steps
  // apply one sub-edit per caret in a single applyEdits batch.
  let carets: number[] = [Math.floor(rand() * (mirror.length + 1))];
  const typeAlphabet = 'esketch mont\nblue';
  const pasteAlphabet = 'veranda ';

  const jumpCarets = () => {
    const count = 1 + Math.floor(rand() * 3);
    const landed = new Set<number>();
    for (let i = 0; i < count; i++) {
      landed.add(Math.floor(rand() * (mirror.length + 1)));
    }
    carets = [...landed].sort((a, b) => a - b);
  };

  // Applies one batch (offsets resolved against the current text, ascending
  // and non-overlapping), mirrors it onto the reference string, and re-seats
  // the carets. Selections passed to applyEdits are the pre-edit carets, the
  // same shape the editor records for typing.
  const applyBatch = (
    splices: { start: number; end: number; text: string }[],
    caretsAfter: number[],
    undoBoundary: boolean
  ) => {
    const edits = splices.map((splice) => ({
      range: {
        start: d.positionAt(splice.start),
        end: d.positionAt(splice.end),
      },
      newText: splice.text,
    }));
    const selections = carets.map((offset) => {
      const p = positionInMirror(mirror, offset);
      return caretAt(p.line, p.character);
    });
    d.applyEdits(edits, true, selections, undefined, undoBoundary);
    for (const splice of [...splices].reverse()) {
      mirror =
        mirror.slice(0, splice.start) + splice.text + mirror.slice(splice.end);
    }
    carets = [...new Set(caretsAfter)].sort((a, b) => a - b);
  };

  for (let step = 0; step < FUZZ_STEPS; step++) {
    const roll = rand();
    if (roll < 0.4) {
      // Type one character at every caret, like multi-cursor typing.
      const ch = typeAlphabet[Math.floor(rand() * typeAlphabet.length)] ?? 'e';
      let delta = 0;
      const caretsAfter = carets.map((offset) => {
        const seated = offset + delta + 1;
        delta += 1;
        return seated;
      });
      applyBatch(
        carets.map((offset) => ({ start: offset, end: offset, text: ch })),
        caretsAfter,
        false
      );
    } else if (roll < 0.55) {
      // Backspace at every caret that has a character to its left.
      const eligible = carets.filter((offset) => offset > 0);
      if (eligible.length === 0) {
        jumpCarets();
        continue;
      }
      let delta = 0;
      const caretsAfter = carets.map((offset) => {
        if (offset > 0) {
          const seated = offset - 1 + delta;
          delta -= 1;
          return seated;
        }
        return offset + delta;
      });
      applyBatch(
        eligible.map((offset) => ({
          start: offset - 1,
          end: offset,
          text: '',
        })),
        caretsAfter,
        false
      );
    } else if (roll < 0.7) {
      // Forward-delete at every caret that has a character to its right.
      const eligible = carets.filter((offset) => offset < mirror.length);
      if (eligible.length === 0) {
        jumpCarets();
        continue;
      }
      let delta = 0;
      const caretsAfter = carets.map((offset) => {
        const seated = offset + delta;
        if (offset < mirror.length) {
          delta -= 1;
        }
        return seated;
      });
      applyBatch(
        eligible.map((offset) => ({
          start: offset,
          end: offset + 1,
          text: '',
        })),
        caretsAfter,
        false
      );
    } else if (roll < 0.82) {
      // Paste a short string at every caret, flagged as an undo boundary the
      // way the editor's paste handler does.
      let pasted = '';
      const length = 2 + Math.floor(rand() * 5);
      for (let i = 0; i < length; i++) {
        pasted +=
          pasteAlphabet[Math.floor(rand() * pasteAlphabet.length)] ?? ' ';
      }
      let delta = 0;
      const caretsAfter = carets.map((offset) => {
        const seated = offset + delta + pasted.length;
        delta += pasted.length;
        return seated;
      });
      applyBatch(
        carets.map((offset) => ({ start: offset, end: offset, text: pasted })),
        caretsAfter,
        true
      );
    } else {
      // Selection-only caret jump: no edit, so nothing to assert this step.
      jumpCarets();
      continue;
    }
    // Per-step invariants: the document tracks the reference byte-for-byte.
    expect(d.getText()).toBe(mirror);
    expect(d.lineCount).toBe(mirror.split('\n').length);
  }

  // Exhaustion phase: however the keystrokes coalesced, unwinding the whole
  // history restores the original text and replaying it restores the final
  // text, byte-exact, with the version tracking both endpoints.
  const finalText = mirror;
  const finalVersion = d.version;
  const undoSteps = undoAll(d);
  expect(undoSteps).toBeGreaterThan(0);
  expect(d.getText()).toBe(baseText);
  expect(d.version).toBe(0);
  expect(d.canRedo).toBe(true);

  const redoSteps = redoAll(d);
  expect(redoSteps).toBe(undoSteps);
  expect(d.getText()).toBe(finalText);
  expect(d.version).toBe(finalVersion);
  expect(d.canUndo).toBe(true);
}

describe('randomized keystroke-run history oracle', () => {
  // Where a randomized splice oracle replays random splices against a mirror
  // document and checks the recorded patch in both directions, this drives
  // seeded keystroke runs through history-tracked applyEdits and checks the
  // coalesced history in both directions via exhaustion. CONSTRAINTS: this
  // must stay a passing invariant test, so the run never undoes mid-stream
  // (coalescing across undo/redo is the known-bug family in the "EditStack
  // coalescing across undo and redo" describe above) and never applies
  // history-skipping edits (the frozen-entry known bugs live in the
  // "undo/redo across non-history edits" describe above); undo/redo run only
  // in the final exhaustion phase.
  test('seeded keystroke runs keep per-step text fidelity and byte-exact undo/redo exhaustion', () => {
    for (const seed of [7, 19, 33]) {
      runSeededKeystrokeRun(seed);
    }
  });
});
