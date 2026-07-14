import { describe, expect, test } from 'bun:test';

import { EditStack } from '../../src/editor/editStack';
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

// Splices `edits` (pre-edit offsets, sorted ascending, non-overlapping) into
// `text` at the string level. The seeded sweep below cross-checks this against
// the real applyEdits path on every random case, so the fixed fixtures can use
// it directly without losing honesty.
function spliceString(text: string, edits: readonly ResolvedTextEdit[]) {
  let result = '';
  let consumed = 0;
  for (const edit of edits) {
    result += text.slice(consumed, edit.start) + edit.text;
    consumed = edit.end;
  }
  return result + text.slice(consumed);
}

// Remaps one single-line selection, given as pre-edit offsets, through `edits`
// and reports the post-edit offsets plus the re-derived direction.
function remapRange(
  preText: string,
  selStart: number,
  selEnd: number,
  direction: SelectionDirection,
  edits: readonly ResolvedTextEdit[]
) {
  const pre = doc(preText);
  const postText = spliceString(preText, edits);
  const post = doc(postText);
  const selection: EditorSelection = {
    start: pre.positionAt(selStart),
    end: pre.positionAt(selEnd),
    direction,
  };
  const [next] = remapSelectionsAfterEdits(
    post,
    [selection],
    [[selStart, selEnd]],
    edits
  );
  return {
    post,
    postText,
    start: post.offsetAt(next.start),
    end: post.offsetAt(next.end),
    direction: next.direction,
  };
}

// remapOffsetThroughEdits is module-private, so single offsets travel through
// remapSelectionsAfterEdits as a collapsed selection. The input selection's
// positions are never read by the remap (only its direction is), so a dummy
// caret suffices; `target` must already reflect `edits`.
function mapOffset(
  target: TextDocument<unknown>,
  offset: number,
  edits: readonly ResolvedTextEdit[]
): number {
  const probe: EditorSelection = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
    direction: DirectionNone,
  };
  const [mapped] = remapSelectionsAfterEdits(
    target,
    [probe],
    [[offset, offset]],
    edits
  );
  return target.offsetAt(mapped.start);
}

// Deterministic 32-bit PRNG (mulberry32) so the seeded sweep is reproducible.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

describe('replacement overlapping one selection edge (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/marker-spec.coffee — "moves the start of the marker to the end of the change and invalidates the marker if its stategy is 'overlap', 'inside', or 'touch'"
  test('start-edge overlap clips the selection start to the replacement end and shifts the end by the delta', () => {
    // 'thicket' [8,15) is selected; the replacement covers 'r th' [6,10) —
    // text before the selection plus its first two letters — and is one
    // character shorter than what it removed. Atom's default marker bias and
    // pierre's right gravity agree here: the start lands right after the new
    // text and the end just absorbs the -1 length delta.
    const preText = 'juniper thicket';
    const edits: ResolvedTextEdit[] = [{ start: 6, end: 10, text: 'y w' }];

    const forward = remapRange(preText, 8, 15, DirectionForward, edits);
    expect(forward.postText).toBe('junipey wicket');
    expect([forward.start, forward.end]).toEqual([9, 14]);
    // Only the un-replaced tail of the original word stays selected.
    expect(forward.post.getTextSlice(9, 14)).toBe('icket');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 8, 15, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([9, 14]);
    expect(backward.direction).toBe(DirectionBackward);
  });

  // atom-legacy: atom-text-buffer/spec/marker-spec.coffee — "moves the end of the marker to the end of the change and invalidates the marker if its stategy is 'overlap', 'inside', or 'touch'"
  test('end-edge overlap keeps the selection start and carries the end to the end of the new text', () => {
    // 'lantern' [7,14) is selected; the replacement covers 'rn g' [12,16) —
    // the word's last two letters plus text after it — and is one character
    // longer. The start edge sits strictly before the edit so it never moves;
    // the end edge rides to the end of the replacement, so the selection
    // absorbs ALL of the new text (also Atom's default bias).
    const preText = 'harbor lantern glow';
    const edits: ResolvedTextEdit[] = [{ start: 12, end: 16, text: '&&&&&' }];

    const forward = remapRange(preText, 7, 14, DirectionForward, edits);
    expect(forward.postText).toBe('harbor lante&&&&&low');
    expect([forward.start, forward.end]).toEqual([7, 17]);
    expect(forward.post.getTextSlice(7, 17)).toBe('lante&&&&&');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 7, 14, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([7, 17]);
    expect(backward.direction).toBe(DirectionBackward);
  });
});

describe('replacement surrounding the whole selection (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/marker-spec.coffee — "truncates the marker to the end of the change and invalidates every invalidation strategy except 'never'"
  test('a surrounding replacement collapses the selection to a caret after the new text and resets direction', () => {
    // 'two' [4,7) is selected; the replacement ' two t' [3,9) swallows the
    // selection on both sides. Both edges collapse to the offset just past the
    // replacement text ('#' occupies [3,4), caret at 4), and because
    // createSelectionFromAnchorAndFocusOffsets re-derives direction from the
    // remapped offsets, a stale forward/backward direction cannot survive on
    // the zero-length result — probed: it really does come back DirectionNone.
    const preText = 'one two three';
    const edits: ResolvedTextEdit[] = [{ start: 3, end: 9, text: '#' }];

    const forward = remapRange(preText, 4, 7, DirectionForward, edits);
    expect(forward.postText).toBe('one#hree');
    expect([forward.start, forward.end]).toEqual([4, 4]);
    expect(forward.direction).toBe(DirectionNone);

    const backward = remapRange(preText, 4, 7, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([4, 4]);
    expect(backward.direction).toBe(DirectionNone);
  });
});

describe('replacement anchored at the selection start (atom-legacy)', () => {
  // atom-legacy: atom-text-buffer/spec/marker-spec.coffee — "interprets the change as being inside the marker for all invalidation strategies"
  test('a contained replacement starting exactly at the selection start shrinks the selection to the un-replaced tail', () => {
    // DIVERGENCE: Atom's default marker bias treats a change that begins
    // exactly at a tailed marker's start as INSIDE the marker — the start stays
    // anchored and the range absorbs the new text (here [7,12) would grow to
    // [7,13)). pierre's uniform right gravity pushes any offset at or inside an
    // edit past the replacement, so the selection start lands after the new
    // text and only the un-replaced tail stays selected — the exact shape Atom
    // reserves for its 'inside'-strategy markers. Coherent policy, pinned here.
    const preText = 'silver maple grove';
    // 'maple' [7,12) selected; 'ma' [7,9) replaced by three characters.
    const edits: ResolvedTextEdit[] = [{ start: 7, end: 9, text: 'STE' }];

    const forward = remapRange(preText, 7, 12, DirectionForward, edits);
    expect(forward.postText).toBe('silver STEple grove');
    expect([forward.start, forward.end]).toEqual([10, 13]);
    expect(forward.post.getTextSlice(10, 13)).toBe('ple');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 7, 12, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([10, 13]);
    expect(backward.direction).toBe(DirectionBackward);
  });
});

describe('seeded sweep against a splice reference model (atom-legacy)', () => {
  // atom-legacy: atom-superstring/test/js/marker-index.test.js — "maintains correct marker positions during randomized insertions and mutations"
  test('200 seeded single-edit remaps match the right-gravity reference model', () => {
    // Reference model for one edit, applied independently to each endpoint:
    //   strictly before the edit -> unchanged
    //   at or after the edit end -> shifted by the net length delta
    //   otherwise (inside)       -> the offset just past the replacement text
    // An endpoint EXACTLY at the edit start is the one genuinely
    // bias-ambiguous spot (Atom anchors it, pierre pushes it past the new
    // text — see the anchored-start test above), so the generator nudges
    // endpoints off that offset and the model stays unambiguous. An endpoint
    // exactly at the edit END is not ambiguous: the shift branch and the
    // inside branch produce the same offset there.
    const random = seededRandom(0xa70b1a5);
    const randomInt = (bound: number) => Math.floor(random() * bound);
    const lower = () => String.fromCharCode(97 + randomInt(26));
    const upper = () => String.fromCharCode(65 + randomInt(26));

    const problems: string[] = [];
    for (let round = 0; round < 200; round++) {
      const length = 8 + randomInt(25);
      let preText = '';
      for (let i = 0; i < length; i++) {
        preText += lower();
      }

      const editStart = randomInt(length + 1);
      const editEnd = editStart + randomInt(length - editStart + 1);
      let newText = '';
      const newLength = randomInt(7);
      for (let i = 0; i < newLength; i++) {
        newText += upper();
      }
      const edit: ResolvedTextEdit = {
        start: editStart,
        end: editEnd,
        text: newText,
      };
      const delta = newText.length - (editEnd - editStart);

      const nudge = (offset: number) =>
        offset === editStart
          ? offset === length
            ? offset - 1
            : offset + 1
          : offset;
      const a = nudge(randomInt(length + 1));
      const b = nudge(randomInt(length + 1));
      const selStart = Math.min(a, b);
      const selEnd = Math.max(a, b);
      const direction: SelectionDirection =
        selStart === selEnd
          ? DirectionNone
          : random() < 0.5
            ? DirectionForward
            : DirectionBackward;

      const refMap = (offset: number) =>
        offset < editStart
          ? offset
          : offset >= editEnd
            ? offset + delta
            : editStart + newText.length;
      const wantStart = refMap(selStart);
      const wantEnd = refMap(selEnd);
      const wantDirection = wantStart === wantEnd ? DirectionNone : direction;

      const pre = doc(preText);
      const post = doc(preText);
      post.applyEdits([
        {
          range: {
            start: pre.positionAt(editStart),
            end: pre.positionAt(editEnd),
          },
          newText,
        },
      ]);
      const spliced =
        preText.slice(0, editStart) + newText + preText.slice(editEnd);
      if (post.getText() !== spliced) {
        problems.push(
          `#${round}: applyEdits produced '${post.getText()}', splice reference '${spliced}'`
        );
        continue;
      }

      const selection: EditorSelection = {
        start: pre.positionAt(selStart),
        end: pre.positionAt(selEnd),
        direction,
      };
      const [next] = remapSelectionsAfterEdits(
        post,
        [selection],
        [[selStart, selEnd]],
        [edit]
      );
      const gotStart = post.offsetAt(next.start);
      const gotEnd = post.offsetAt(next.end);
      const label = `#${round} text='${preText}' edit=[${editStart},${editEnd})->'${newText}' sel=[${selStart},${selEnd}] dir=${direction}`;
      if (gotStart > gotEnd || gotStart < 0 || gotEnd > spliced.length) {
        problems.push(
          `${label}: out-of-order or out-of-bounds result [${gotStart},${gotEnd}]`
        );
      }
      if (gotStart !== wantStart || gotEnd !== wantEnd) {
        problems.push(
          `${label}: remapped to [${gotStart},${gotEnd}], reference [${wantStart},${wantEnd}]`
        );
      }
      if (next.direction !== wantDirection) {
        problems.push(
          `${label}: direction ${next.direction}, reference ${wantDirection}`
        );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('bidirectional round-trip through history inverse edits (atom-legacy)', () => {
  // Three hunks with unequal old/new lengths: a growing replacement, a pure
  // insertion, and a shrinking replacement that crosses a line break.
  const baseText = 'cedar\nbirch\noak\nwillow';
  const hunks: ResolvedTextEdit[] = [
    { start: 1, end: 4, text: 'OPPER' }, // 'eda' -> 'OPPER' (+2)
    { start: 8, end: 8, text: '-tree' }, // insertion (+5)
    { start: 12, end: 20, text: 'elm' }, // 'oak\nwill' -> 'elm' (-5)
  ];

  // Applies the batch through the history-tracked path with an injected
  // EditStack, so the inverse edits come from the real undo entry rather than
  // being hand-built. The entry's inverseEdits are expressed in POST-edit
  // offsets, which is exactly the coordinate space the return leg needs.
  function buildHistoryEntry() {
    const stack = new EditStack<unknown>();
    const post = new TextDocument<unknown>(
      'inmemory://1',
      baseText,
      'plain',
      0,
      stack
    );
    post.applyResolvedEdits(hunks, true);
    const entry = stack.peekUndo();
    if (entry === undefined) {
      throw new Error('expected a history entry after the tracked batch');
    }
    return { post, entry };
  }

  // atom-legacy: atom-superstring/test/js/patch.test.js — "correctly records random splices"
  test('offsets outside every hunk round-trip exactly through forward then inverse edits', () => {
    const { post, entry } = buildHistoryEntry();
    const preDoc = doc(baseText);
    expect(post.getText()).toBe('cOPPERr\nbi-treerch\nelmow');
    expect(entry.inverseEdits).toEqual([
      { start: 1, end: 6, text: 'eda' },
      { start: 10, end: 15, text: '' },
      { start: 19, end: 22, text: 'oak\nwill' },
    ]);

    // "Outside" means before a hunk's start or at/after its end. That includes
    // the zero-width insertion hunk's own offset 8: right gravity pushes it
    // past '-tree' on the way forward and the inverse deletion pulls it back.
    expect(mapOffset(post, 8, entry.forwardEdits)).toBe(15);

    const outside = [0, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22];
    const trips = outside.map((offset) => {
      const mapped = mapOffset(post, offset, entry.forwardEdits);
      return mapOffset(preDoc, mapped, entry.inverseEdits);
    });
    expect(trips).toEqual(outside);
  });

  // atom-legacy: atom-superstring/test/js/patch.test.js — "can invert patches"
  test('offsets inside a replaced hunk clamp to the hunk trailing edge instead of round-tripping', () => {
    // Interior offsets are lossy by construction — the text they addressed is
    // gone. Forward they collapse to the end of that hunk's replacement text;
    // the return leg then clamps to the hunk's PRE-edit end offset, never
    // resurrecting the original interior position. Atom's patch translation is
    // likewise lossy inside a change, clamping to the change's boundary.
    const { post, entry } = buildHistoryEntry();
    const preDoc = doc(baseText);

    const insideFirstHunk = [1, 2, 3].map((offset) =>
      mapOffset(post, offset, entry.forwardEdits)
    );
    expect(insideFirstHunk).toEqual([6, 6, 6]); // just past 'OPPER'
    const insideLastHunk = [12, 15, 19].map((offset) =>
      mapOffset(post, offset, entry.forwardEdits)
    );
    expect(insideLastHunk).toEqual([22, 22, 22]); // just past 'elm'

    expect(mapOffset(preDoc, 6, entry.inverseEdits)).toBe(4); // hunk 1 pre-edit end
    expect(mapOffset(preDoc, 22, entry.inverseEdits)).toBe(20); // hunk 3 pre-edit end
  });
});
