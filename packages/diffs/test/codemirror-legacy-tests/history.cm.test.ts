// Undo/redo selection restore and history traversal scenarios ported from
// CodeMirror 6's history suite. See README.md in this directory for suite
// conventions. Selections restored by undo()/redo() are the ones recorded in
// the edit stack entry at edit time: undo() returns the entry's
// selectionsBefore and redo() its selectionsAfter as the second tuple element.
// Selection-only movement between edits never reaches TextDocument (the Editor
// only calls setLastUndoSelectionsAfter when it applies edits), so a caret that
// wanders off after an edit cannot overwrite the recorded restore points — but
// it also cannot break a coalescing group, which is the one pinned divergence
// below.
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
    [caret(line, character)],
    [caret(line, character + text.length)],
    undoBoundary
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

describe('TextDocument history selection restore (codemirror-legacy)', () => {
  // codemirror-legacy: cm-commands/test/test-history.ts — "puts the cursor after the change on redo"
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
      [caret(0, 3)],
      [caret(0, 4)]
    );
    expect(d.getText()).toBe('red!\n\nblue');
    // (caret wanders to the end of the document — invisible to the document)

    const undoResult = d.undo();
    expect(d.getText()).toBe('red\n\nblue');
    expect(undoResult?.[1]).toEqual([caret(0, 3)]);

    const redoResult = d.redo();
    expect(d.getText()).toBe('red!\n\nblue');
    expect(redoResult?.[1]).toEqual([caret(0, 4)]);
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "restores selection on undo-redo-undo"
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
      [caret(1, 3)],
      [caret(1, 4)]
    );
    expect(d.getText()).toBe('ash\noak.\nelm');

    // (caret jumps to (0,0) before every step — invisible to the document)
    expect(d.undo()?.[1]).toEqual([caret(1, 3)]);
    expect(d.getText()).toBe('ash\noak\nelm');

    expect(d.redo()?.[1]).toEqual([caret(1, 4)]);
    expect(d.getText()).toBe('ash\noak.\nelm');

    expect(d.undo()?.[1]).toEqual([caret(1, 3)]);
    expect(d.getText()).toBe('ash\noak\nelm');

    // A second full cycle still reads the same stored selections: traversal
    // moves entries between stacks without mutating them.
    expect(d.redo()?.[1]).toEqual([caret(1, 4)]);
    expect(d.undo()?.[1]).toEqual([caret(1, 3)]);
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "restores the selection before the first change in an item (#46)"
  // Three keystrokes coalesce into one undo entry; the merged entry must keep
  // the selectionsBefore of the FIRST keystroke (CodeMirror regression #46
  // restored an intermediate caret instead).
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
    expect(undoResult?.[1]).toEqual([caret(0, 0)]);

    // The redo side of the merged entry keeps the LAST keystroke's after-caret.
    const redoResult = d.redo();
    expect(d.getText()).toBe('qrs');
    expect(redoResult?.[1]).toEqual([caret(0, 3)]);
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "doesn't merge document changes if there's a selection change in between"
  // DIVERGENCE: CodeMirror tracks selection-only transactions and starts a new
  // undo group whenever one lands between two document changes, so this flow
  // yields two undo steps there. Pierre's coalescing is purely geometric over
  // edit offsets (shouldCoalesceEditStackEntry) and TextDocument has no channel
  // for selection-only transactions, so a caret that moves away and comes back
  // between keystrokes leaves no trace and the run still merges. The sibling
  // monaco suite (editStack.monaco.test.ts) pins the related content-based
  // whitespace-grouping divergence; this pins the missing selection-movement
  // heuristic.
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
    expect(undoResult?.[1]).toEqual([caret(0, 0)]);
  });

  // codemirror-legacy: cm-commands/test/test-history.ts — "doesn't merge document changes if there's a selection change in between"
  // The CM fixture's actual edit sequence — type, select the typed word,
  // replace the selection — lands on the same two-step outcome here, but via
  // edit geometry (a ranged replacement never merges into a typing run), not
  // via a selection-change heuristic.
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
      [caret(0, 5)]
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

  // codemirror-legacy: cm-commands/test/test-history.ts — "can go back and forth through history multiple times"
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
      [caret(0, 12)],
      [caret(2, 4)]
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

  // codemirror-legacy: cm-commands/test/test-history.ts — "restores selection on redo"
  // Three carets insert one character each in a single batch. Between the undo
  // and the redo the selection collapses to a single caret at the top of the
  // document (selection-only, unrecorded); redo must still restore all three
  // recorded after-carets, and undo all three before-carets.
  test('multi-cursor batch restores every caret on undo and redo', () => {
    const d = doc('ox\nelk\nbee\n');
    const selectionsBefore = [caret(0, 2), caret(1, 3), caret(2, 3)];
    const selectionsAfter = [caret(0, 3), caret(1, 4), caret(2, 4)];
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
