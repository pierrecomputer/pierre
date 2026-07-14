// History/coalescing scenarios ported from Atom's text-buffer and superstring
// suites. See README.md in this directory for suite conventions. Two areas:
// (1) degenerate history batches around undo — Atom's empty-transaction
// contract says a batch containing no edits must leave history untouched, and
// in particular must not destroy a pending redo; (2) a seeded randomized
// keystroke-run oracle asserting the typing/backspace/forward-delete
// coalescing pipeline never corrupts undo/redo round-trips. Deterministic
// coalescing cases are already pinned in test/editorTextDocument.test.ts,
// test/editorEditStack.test.ts, and the monaco/codemirror sibling suites;
// nothing here repeats those.
import { describe, expect, test } from 'bun:test';

import { EditStack } from '../../src/editor/editStack';
import { DirectionNone } from '../../src/editor/selection';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, TextEdit } from '../../src/types';

function doc(text: string, editStack?: EditStack<unknown>) {
  return new TextDocument('inmemory://1', text, 'plain', 0, editStack);
}

function caret(line: number, character: number) {
  const position = { line, character };
  return {
    start: position,
    end: position,
    direction: DirectionNone,
  } satisfies EditorSelection;
}

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
    caret(line, character),
  ]);
}

describe('degenerate history batches around undo (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "does not push the transaction to the undo stack if it is empty"
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
    expect(d.applyEdits([], true, [caret(0, 0)])).toBeUndefined();
    expect(d.canUndo).toBe(false);
    expect(d.canRedo).toBe(true);
    expect(d.version).toBe(0);

    // Even flagged as an undo boundary, the empty batch stays inert.
    expect(
      d.applyEdits([], true, [caret(0, 2)], [caret(0, 2)], true)
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

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "doesn't notify observers after an empty transaction"
  // An empty batch between two keystrokes leaves no trace at all: it must not
  // sever the typing coalescing group the way a real zero-width entry does
  // (that contrast is pinned in codemirror-legacy-tests/applyEditsBatch.cm.test.ts).
  test('an empty history batch between keystrokes leaves the coalescing group intact', () => {
    const d = doc('');
    keystroke(d, 0, 0, 'w');
    d.applyEdits([], true, [caret(0, 1)], undefined, true);
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

  // atom-legacy: atom-text-buffer/spec/text-buffer-spec.coffee — "does not push the transaction to the undo stack if it is empty"
  // DIVERGENCE: Atom drops a transaction that made no changes on the floor, so
  // any no-op after undo preserves the redo stack. Pierre records every
  // non-empty edits array passed with updateHistory as a real history step —
  // identity entries on a fresh document are pinned that way in
  // codemirror-legacy-tests/applyEditsBatch.cm.test.ts — and every recorded
  // step clears redo, the same rule as a real edit (pinned in
  // test/editorTextDocument.test.ts 'new edit after undo clears redo stack').
  // Coherent policy; pinned here at the post-undo boundary where it costs the
  // pending redo.
  test('a batch of zero-width empty edits after undo records a real step and drops redo', () => {
    const d = doc('fern');
    keystroke(d, 0, 4, '!');
    d.undo();
    expect(d.canRedo).toBe(true);

    const change = d.applyEdits([insertEdit(0, 2, '')], true, [caret(0, 2)]);
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
      caret(0, 1),
      caret(1, 2),
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

// Runs undo (or redo) to exhaustion and returns the step count, so the fuzz
// can assert the two directions traverse the same number of entries.
function undoToExhaustion(d: ReturnType<typeof doc>) {
  let steps = 0;
  while (d.canUndo) {
    d.undo();
    steps++;
  }
  return steps;
}

function redoToExhaustion(d: ReturnType<typeof doc>) {
  let steps = 0;
  while (d.canRedo) {
    d.redo();
    steps++;
  }
  return steps;
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
  // (covered by the main suite's maxEntries tests) would break exhaustion.
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
      return caret(p.line, p.character);
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
  const undoSteps = undoToExhaustion(d);
  expect(undoSteps).toBeGreaterThan(0);
  expect(d.getText()).toBe(baseText);
  expect(d.version).toBe(0);
  expect(d.canRedo).toBe(true);

  const redoSteps = redoToExhaustion(d);
  expect(redoSteps).toBe(undoSteps);
  expect(d.getText()).toBe(finalText);
  expect(d.version).toBe(finalVersion);
  expect(d.canUndo).toBe(true);
}

describe('randomized keystroke-run history oracle (atom-legacy)', () => {
  // atom-legacy: atom-superstring/test/js/patch.test.js — "correctly records random splices"
  // Where superstring replays random splices against a mirror document and
  // checks the recorded patch in both directions, this drives seeded keystroke
  // runs through history-tracked applyEdits and checks the coalesced history
  // in both directions via exhaustion. CONSTRAINTS: this must stay a passing
  // invariant test, so the run never undoes mid-stream (coalescing across
  // undo/redo is the known-bug family in
  // monaco-legacy-tests/editStack.monaco.test.ts) and never applies
  // history-skipping edits (the frozen-entry known bugs live in
  // codemirror-legacy-tests/historyRemote.cm.test.ts); undo/redo run only in
  // the final exhaustion phase.
  test('seeded keystroke runs keep per-step text fidelity and byte-exact undo/redo exhaustion', () => {
    for (const seed of [7, 19, 33]) {
      runSeededKeystrokeRun(seed);
    }
  });
});
