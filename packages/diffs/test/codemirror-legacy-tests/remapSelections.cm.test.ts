import { describe, expect, test } from 'bun:test';

import {
  DirectionBackward,
  DirectionForward,
  DirectionNone,
  remapSelectionsAfterEdits,
} from '../../src/editor/selection';
import type { ResolvedTextEdit } from '../../src/editor/textDocument';
import { TextDocument } from '../../src/editor/textDocument';
import type { EditorSelection, SelectionDirection } from '../../src/types';

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

// Applies `edits` (resolved, pre-edit offsets) to a fresh document built from
// `preText` and returns the post-edit document, ready to be handed to
// remapSelectionsAfterEdits. Going through applyEdits keeps the fixture honest:
// the expected post text asserted in each test is produced by the real edit
// path, not by hand-splicing.
function applyBatch(preText: string, edits: ResolvedTextEdit[]) {
  const pre = doc(preText);
  const post = doc(preText);
  post.applyEdits(
    edits.map((edit) => ({
      range: {
        start: pre.positionAt(edit.start),
        end: pre.positionAt(edit.end),
      },
      newText: edit.text,
    }))
  );
  return post;
}

// Remaps one selection, given as a pre-edit [start, end] offset pair, through
// `edits`. All fixtures are single-line, so the returned offsets are the
// post-edit character columns.
function remapPair(
  preText: string,
  pair: readonly [number, number],
  edits: ResolvedTextEdit[],
  direction: SelectionDirection = DirectionNone
) {
  const pre = doc(preText);
  const post = applyBatch(preText, edits);
  const selection: EditorSelection = {
    start: pre.positionAt(pair[0]),
    end: pre.positionAt(pair[1]),
    direction,
  };
  const [result] = remapSelectionsAfterEdits(post, [selection], [pair], edits);
  return {
    post,
    result,
    offsets: [post.offsetAt(result.start), post.offsetAt(result.end)] as const,
  };
}

describe('remap through replacements (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "stays on its own side of replacements"
  test('caret at the start boundary of a replaced range lands after the replacement', () => {
    // DIVERGENCE: CodeMirror maps a position sitting exactly at the start of a
    // replaced span back to the span's start under BOTH assoc -1 and assoc 1
    // (mapPos never moves it through the replacement). pierre-fe's
    // remapOffsetThroughEdits applies uniform right gravity to every offset at
    // or after an edit's start — a documented policy on the function — so the
    // caret lands just AFTER the replacement text instead. Disorienting versus
    // CM, but the caret stays at a valid buffer position and the policy matches
    // the typing case (text inserted at the caret pushes the caret past it);
    // the main suite already pins the interior-caret variant of the same rule.
    const { post, offsets, result } = remapPair(
      'papaya mango salad',
      [7, 7], // caret exactly at the 'm' of the replaced word
      [{ start: 7, end: 12, text: 'fig' }]
    );
    expect(post.getText()).toBe('papaya fig salad');
    // CM would report 7 (the replacement start); pierre reports 10, after 'fig'.
    expect(offsets).toEqual([10, 10]);
    expect(result.direction).toBe(DirectionNone);
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "stays on its own side of replacements"
  test('carets at the start and end boundaries of one replacement converge after it', () => {
    // DIVERGENCE (same right-gravity policy as above): the start-boundary caret
    // goes through the "inside the edit" branch and the end-boundary caret
    // through the "past the edit" delta branch, yet both come out at the same
    // offset — the two sides of a replacement are not kept apart the way CM's
    // assoc-aware mapPos keeps them ([start -> start, end -> after]).
    const edits: ResolvedTextEdit[] = [{ start: 4, end: 9, text: 'DOWN' }];
    const preText = 'shutproof latch';
    const atStart = remapPair(preText, [4, 4], edits);
    const atEnd = remapPair(preText, [9, 9], edits);
    expect(atStart.post.getText()).toBe('shutDOWN latch');
    expect(atStart.offsets).toEqual([8, 8]);
    expect(atEnd.offsets).toEqual([8, 8]);
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "stays in between replacements"
  test('caret between two adjacent replacements lands after the second one', () => {
    // DIVERGENCE: CM keeps a caret at the seam of two touching replacements
    // exactly at that seam (mapPos returns the boundary for assoc -1 and 1).
    // pierre-fe's right-gravity branch treats offset == start of the second
    // replacement as "inside" it, so the caret is carried past the second
    // replacement's inserted text. Coherent (valid offset, same documented
    // policy), but the caret does not stay between the two spans.
    const { post, offsets } = remapPair(
      'ppqqrr',
      [2, 2], // caret at the seam between the two replaced spans
      [
        { start: 0, end: 2, text: '11' },
        { start: 2, end: 4, text: '2233' },
      ]
    );
    expect(post.getText()).toBe('112233rr');
    // CM would report 2 (the seam, unchanged by the equal-length first
    // replacement); pierre reports 6, after '2233'.
    expect(offsets).toEqual([6, 6]);
  });
});

describe('insertion at range-selection boundaries (codemirror-legacy)', () => {
  const preText = 'stormcloud';
  // Selection over offsets [3, 7] — the letters 'rmcl'.
  const pair: [number, number] = [3, 7];

  // codemirror-legacy: cm-state/test/test-change.ts — "maps through an insertion"
  test('insertion exactly at the selection end is absorbed into the selection', () => {
    // DIVERGENCE: CM maps a non-empty range's edges with outward bias (from
    // with assoc 1, to with assoc -1), so an insertion touching either boundary
    // is never absorbed and the selected text stays the same. pierre-fe remaps
    // both edges with the same right gravity, so an insertion exactly at the
    // END boundary lands inside the selection and grows it.
    const edits: ResolvedTextEdit[] = [{ start: 7, end: 7, text: '__' }];

    const forward = remapPair(preText, pair, edits, DirectionForward);
    expect(forward.post.getText()).toBe('stormcl__oud');
    expect(forward.offsets).toEqual([3, 9]); // 'rmcl__' — the insert is inside
    expect(forward.result.direction).toBe(DirectionForward);

    const backward = remapPair(preText, pair, edits, DirectionBackward);
    expect(backward.offsets).toEqual([3, 9]);
    expect(backward.result.direction).toBe(DirectionBackward);
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "maps through an insertion"
  test('insertion exactly at the selection start shifts the selection without absorbing', () => {
    // The other half of the asymmetry: at the START boundary the same right
    // gravity pushes the start edge past the inserted text, so the whole
    // selection slides right and keeps covering exactly the original letters.
    // (This half agrees with CM's outward-bias mapping of `from`.)
    const edits: ResolvedTextEdit[] = [{ start: 3, end: 3, text: '__' }];

    const forward = remapPair(preText, pair, edits, DirectionForward);
    expect(forward.post.getText()).toBe('sto__rmcloud');
    expect(forward.offsets).toEqual([5, 9]); // still exactly 'rmcl'
    expect(forward.post.getTextSlice(5, 9)).toBe('rmcl');
    expect(forward.result.direction).toBe(DirectionForward);

    const backward = remapPair(preText, pair, edits, DirectionBackward);
    expect(backward.offsets).toEqual([5, 9]);
    expect(backward.result.direction).toBe(DirectionBackward);
  });
});

describe('remap through deletions (codemirror-legacy)', () => {
  // Deleting offsets [3, 7) — the letters 'rotc' of 'carrotcake'.
  const preText = 'carrotcake';
  const edits: ResolvedTextEdit[] = [{ start: 3, end: 7, text: '' }];

  // codemirror-legacy: cm-state/test/test-change.ts — "maps through deletion"
  test('carets at deletion start, strictly inside, and at deletion end all converge to the deletion start', () => {
    // Matches CM's plain mapPos (no MapMode): every position touching the
    // deleted span collapses to where the span used to begin. CM can still
    // distinguish the three via TrackDel/TrackBefore/TrackAfter map modes;
    // pierre-fe has no map-mode equivalent, so plain convergence is the whole
    // contract.
    const atStart = remapPair(preText, [3, 3], edits);
    const inside = remapPair(preText, [5, 5], edits);
    const atEnd = remapPair(preText, [7, 7], edits);

    expect(atStart.post.getText()).toBe('carake');
    expect(atStart.offsets).toEqual([3, 3]);
    expect(inside.offsets).toEqual([3, 3]);
    expect(atEnd.offsets).toEqual([3, 3]);
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "maps through deletion"
  test('a backward selection exactly spanning the deleted range collapses to a direction-none caret', () => {
    // Both edges converge to the deletion start, and
    // createSelectionFromAnchorAndFocusOffsets re-derives direction from the
    // remapped offsets — equal anchor and focus must yield DirectionNone, not a
    // stale backward direction on a zero-length range.
    const { offsets, result } = remapPair(
      preText,
      [3, 7],
      edits,
      DirectionBackward
    );
    expect(offsets).toEqual([3, 3]);
    expect(result.direction).toBe(DirectionNone);
  });
});

describe('remap through multi-edit batches (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-change.ts — "maps through mixed edits"
  test('caret after an insert + delete + replace batch accumulates every delta', () => {
    // Digits/letters make the offsets self-documenting: the caret sits on 'E'
    // (offset 14) and must still sit on 'E' after all three edits before it.
    const preText = '0123456789ABCDEF';
    const { post, offsets } = remapPair(
      preText,
      [14, 14],
      [
        { start: 2, end: 2, text: '+++' }, // insert, +3
        { start: 5, end: 7, text: '' }, // delete '56', -2
        { start: 9, end: 11, text: 'WXYZ' }, // replace '9A', +2
      ]
    );
    expect(post.getText()).toBe('01+++23478WXYZBCDEF');
    expect(offsets).toEqual([17, 17]); // 14 + 3 - 2 + 2
    expect(post.getTextSlice(17, 18)).toBe('E');
  });

  // codemirror-legacy: cm-state/test/test-change.ts — "maps through multiple insertions"
  test('edits must be sorted ascending by start: unsorted input silently drops earlier edits', () => {
    // DIVERGENCE / contract pin: CM's ChangeSet.of accepts change specs in any
    // order and normalizes them internally, so mapPos always sees every change.
    // pierre-fe's remap walks the edit array once and stops at the first edit
    // whose start lies past the offset — a documented precondition ("sorted
    // ascending and non-overlapping" on remapOffsetThroughEdits). When a caller
    // violates it, edits listed after the early-exit point are silently
    // ignored, even though they sit before the offset. This test pins the
    // precondition by contrasting sorted and unsorted calls over the same
    // batch; it is the caller's job to sort, not corruption inside the remap.
    const preText = '0123456789ABCDEF';
    const edits: ResolvedTextEdit[] = [
      { start: 0, end: 0, text: 'YY' },
      { start: 10, end: 10, text: 'XX' },
    ];

    const sorted = remapPair(preText, [5, 5], edits);
    expect(sorted.post.getText()).toBe('YY0123456789XXABCDEF');
    // Only the insert at 0 precedes the caret: 5 + 2.
    expect(sorted.offsets).toEqual([7, 7]);

    // Same batch listed descending: the walk sees the edit at 10 first,
    // breaks (5 < 10), and never applies the insert at 0 — the caret keeps
    // its stale pre-edit offset.
    const unsorted = remapPair(preText, [5, 5], [edits[1], edits[0]]);
    expect(unsorted.post.getText()).toBe('YY0123456789XXABCDEF');
    expect(unsorted.offsets).toEqual([5, 5]);
  });
});
