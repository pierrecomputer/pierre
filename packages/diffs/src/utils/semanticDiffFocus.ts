import LRUMapPkg from 'lru_map';
import type { Position } from 'shiki';

import type {
  DecorationItem,
  FileDiffMetadata,
  SemanticDiffFocusKind,
  SemanticDiffLineRange,
  SemanticDiffOperation,
  SemanticDiffSpan,
  SemanticDiffSpanRelation,
  SemanticDiffTextPosition,
  SemanticDiffTextRange,
} from '../types';
import { appendItems } from './appendItems';
import { cleanLastNewline } from './cleanLastNewline';

type FocusKind = SemanticDiffSpanRelation | SemanticDiffFocusKind;

interface FocusRange extends SemanticDiffTextRange {
  relation: SemanticDiffSpanRelation;
  kind?: SemanticDiffFocusKind;
}

interface SemanticDiffFocusState {
  ranges: FocusRange[];
  nextRange: number;
  active: FocusRange[];
  wholeLineRanges: SemanticDiffLineRange[];
  nextWholeLineRange: number;
}

interface SemanticDiffFocusStates {
  deletions: SemanticDiffFocusState;
  additions: SemanticDiffFocusState;
}

interface SemanticDiffFocusDecoration extends DecorationItem {
  start: Position;
  end: Position;
}

/** Locates one source line's entries in the `decorations` array. */
interface SemanticDiffFocusLine {
  /** Zero-based index of the first decoration. */
  start: number;
  /** Number of decorations for this line. */
  total: number;
}

/** One source side's decorations and a lookup for each decorated line. */
export interface SemanticDiffFocusSide {
  decorations: SemanticDiffFocusDecoration[];
  // Source line number to its first decoration index and decoration count.
  lines: Map<number, SemanticDiffFocusLine>;
}

/** Prepared Shiki decorations and source-line indexes for both sides. */
export interface SemanticDiffFocus {
  deletions: SemanticDiffFocusSide;
  additions: SemanticDiffFocusSide;
}

interface FocusBoundary {
  character: number;
  kind: FocusKind;
  change: 1 | -1;
}

// Match the render caches' default limit so discarded diffs do not accumulate.
const focusCache = new LRUMapPkg.LRUMap<
  string | FileDiffMetadata,
  { isPartial: boolean; focus: SemanticDiffFocus }
>(100);

// Cache finished decorations with their source diff so windows and theme changes
// only need to select decorations, not interpret the semantic spans again.
export function getSemanticDiffFocus(
  diff: FileDiffMetadata
): SemanticDiffFocus | undefined {
  if (diff.semanticOperations == null) return undefined;
  const key = diff.cacheKey ?? diff;
  const cached = focusCache.get(key);
  // Keyed hydration changes the key. Unkeyed hydration reuses the same object.
  if (
    cached != null &&
    // isPartial hydration re-uses the existing FileDiffMetadata object, so we
    // need to track partial hydration separately because semantic focus
    // nodes will need to be re-computed
    (diff.cacheKey != null || cached.isPartial === diff.isPartial)
  ) {
    return cached.focus;
  }
  const states = createSemanticDiffFocusStates(diff.semanticOperations);
  const focus: SemanticDiffFocus = {
    deletions: prepareFocusSide(states.deletions, diff, 'deletion'),
    additions: prepareFocusSide(states.additions, diff, 'addition'),
  };
  focusCache.set(key, { isPartial: diff.isPartial, focus });
  return focus;
}

// Build decorations in source coordinates and index each decorated line into
// the same array. Partial diffs provide source numbers through their hunks.
function prepareFocusSide(
  state: SemanticDiffFocusState,
  diff: FileDiffMetadata,
  side: 'deletion' | 'addition'
): SemanticDiffFocusSide {
  const result: SemanticDiffFocusSide = {
    decorations: [],
    lines: new Map(),
  };
  if (state.ranges.length === 0) return result;
  const lines = diff[`${side}Lines`];
  if (diff.isPartial) {
    for (const hunk of diff.hunks) {
      prepareLines(
        hunk[`${side}Start`],
        hunk[`${side}LineIndex`],
        hunk[`${side}Count`]
      );
    }
  } else {
    prepareLines(1, 0, lines.length);
  }
  return result;

  // Prepare decorations for a block of source lines. For each decorated line,
  // record its first array index and decoration count for direct lookup.
  function prepareLines(sourceStart: number, lineIndex: number, count: number) {
    for (let offset = 0; offset < count; offset++) {
      const sourceLine = sourceStart + offset;
      const start = result.decorations.length;
      prepareSemanticDiffFocusLine(
        state,
        sourceLine,
        lines[lineIndex + offset],
        result.decorations
      );
      const total = result.decorations.length - start;
      if (total > 0) result.lines.set(sourceLine, { start, total });
    }
  }
}

// FOLLOWUP: It might be worth figuring out how to compute this on the server
// instead of the client...
// Collect both sides in source order for decoration preparation. Only derived
// ranges are split or sorted; the supplied operations and spans stay intact.
function createSemanticDiffFocusStates(
  operations: SemanticDiffOperation[]
): SemanticDiffFocusStates {
  const result: SemanticDiffFocusStates = {
    deletions: createFocusState(),
    additions: createFocusState(),
  };
  const sides = ['old', 'new'] as const;
  for (const operation of operations) {
    const oldBodies: SemanticDiffTextRange[] = [];
    const newBodies: SemanticDiffTextRange[] = [];
    for (const span of operation.spans) {
      if (span.role !== 'body') continue;
      if (span.old != null) appendItems(oldBodies, span.old);
      if (span.new != null) appendItems(newBodies, span.new);
    }
    for (const span of operation.spans) {
      if (span.role !== 'focus') continue;
      for (const side of sides) {
        const ranges = span[side];
        if (ranges == null) continue;
        const state = side === 'old' ? result.deletions : result.additions;
        const bodies = side === 'old' ? oldBodies : newBodies;
        if (bodies.length === 0) {
          for (const range of ranges) {
            state.ranges.push({
              ...range,
              relation: span.relation,
              kind: span.kind,
            });
          }
          continue;
        }
        for (const range of ranges) {
          for (const fragment of subtractEnclosedBodies(range, bodies)) {
            state.ranges.push({
              ...fragment,
              relation: span.relation,
              kind: span.kind,
            });
          }
        }
      }
    }
    for (const side of sides) {
      const state = side === 'old' ? result.deletions : result.additions;
      for (const range of operation.lines[side]) {
        if (
          preservesWholeLineFocus(operation, operation.spans[range.spanIndex])
        ) {
          state.wholeLineRanges.push(range);
        }
      }
    }
  }
  for (const state of [result.deletions, result.additions]) {
    state.ranges.sort((a, b) => comparePositions(a.start, b.start));
    state.wholeLineRanges.sort((a, b) => a.start - b.start);
  }
  return result;
}

function createFocusState(): SemanticDiffFocusState {
  return {
    ranges: [],
    nextRange: 0,
    active: [],
    wholeLineRanges: [],
    nextWholeLineRange: 0,
  };
}

function comparePositions(
  a: SemanticDiffTextPosition,
  b: SemanticDiffTextPosition
): number {
  return a.line === b.line ? a.character - b.character : a.line - b.line;
}

// Apply body cuts in Sema's span order. A body must be strictly inside the
// original focus and fully inside the remaining fragment to remove that text.
function subtractEnclosedBodies(
  focus: SemanticDiffTextRange,
  bodies: SemanticDiffTextRange[]
): SemanticDiffTextRange[] {
  let fragments = [focus];
  for (const body of bodies) {
    if (
      comparePositions(focus.start, body.start) >= 0 ||
      comparePositions(body.end, focus.end) >= 0
    ) {
      continue;
    }
    const remaining: SemanticDiffTextRange[] = [];
    for (const fragment of fragments) {
      if (
        comparePositions(fragment.start, body.start) <= 0 &&
        comparePositions(body.end, fragment.end) <= 0
      ) {
        remaining.push(
          { start: fragment.start, end: body.start },
          { start: body.end, end: fragment.end }
        );
      } else {
        remaining.push(fragment);
      }
    }
    fragments = remaining;
  }
  return fragments;
}

// FOLLOWUP: Not sure i like the way these things look in practice, so may want
// to have a discussion around upserting these into full line styles
// Sema retains whole-line introduced/removed focus on edited paired spans.
// This controls focus filtering only; line colors still use the operation type.
function preservesWholeLineFocus(
  operation: SemanticDiffOperation,
  span: SemanticDiffSpan
): boolean {
  return (
    (span.old?.length ?? 0) > 0 &&
    (span.new?.length ?? 0) > 0 &&
    !(span.role === 'body' && span.relation === 'mapped') &&
    operation.type !== 'reformatted' &&
    (span.relation !== 'moved' || operation.type === 'movedWithEdit')
  );
}

// Filter focuses against the source text and keep only ranges overlapping this
// line. Each side is prepared in source order, skipping gaps in partial diffs.
function prepareSemanticDiffFocusLine(
  focus: SemanticDiffFocusState,
  sourceLine: number,
  lineContent: string,
  decorations: SemanticDiffFocusDecoration[]
): void {
  while (
    focus.nextRange < focus.ranges.length &&
    focus.ranges[focus.nextRange].start.line <= sourceLine
  ) {
    focus.active.push(focus.ranges[focus.nextRange++]);
  }
  while (
    focus.nextWholeLineRange < focus.wholeLineRanges.length &&
    focus.wholeLineRanges[focus.nextWholeLineRange].end < sourceLine
  ) {
    focus.nextWholeLineRange++;
  }
  const wholeLineRange = focus.wholeLineRanges[focus.nextWholeLineRange];
  const preserveWholeLine =
    wholeLineRange != null && wholeLineRange.start <= sourceLine;
  if (focus.active.length === 0) return;
  const text = cleanLastNewline(lineContent);
  const contentStart = text.length - text.trimStart().length;
  const contentEnd = text.trimEnd().length;
  const boundaries: FocusBoundary[] = [];
  let activeCount = 0;
  for (const range of focus.active) {
    if (range.end.line < sourceLine) continue;
    focus.active[activeCount++] = range;
    const start = range.start.line === sourceLine ? range.start.character : 0;
    const end = Math.min(
      text.length,
      range.end.line === sourceLine ? range.end.character : text.length
    );
    if (start >= end || text.slice(start, end).trim() === '') continue;
    const coversLine = start <= contentStart && end >= contentEnd;
    const keepWholeLine =
      range.relation === 'replaced' ||
      (preserveWholeLine &&
        (range.relation === 'introduced' || range.relation === 'removed'));
    if (coversLine && !keepWholeLine) continue;
    const kind = range.kind ?? range.relation;
    // Mapped focus without a formatting kind has no visual emphasis in Sema.
    if (kind === 'mapped') continue;
    boundaries.push(
      { character: start, kind, change: 1 },
      { character: end, kind, change: -1 }
    );
  }
  focus.active.length = activeCount;
  if (boundaries.length > 0) {
    appendFocusSegments(boundaries, sourceLine - 1, decorations);
  }
}

// Combine overlapping focuses into disjoint text segments. Shiki rejects
// crossing ranges, and nested wrappers would stack translucent backgrounds.
function appendFocusSegments(
  boundaries: FocusBoundary[],
  line: number,
  decorations: SemanticDiffFocusDecoration[]
): void {
  boundaries.sort((a, b) => a.character - b.character);
  const active = new Map<FocusKind, number>();
  let previousCharacter = 0;
  let previousEnd: Position | undefined;
  let previousKinds: string | undefined;
  for (let index = 0; index < boundaries.length; ) {
    const character = boundaries[index].character;
    if (previousCharacter < character && active.size > 0) {
      const kinds = [...active.keys()].sort().join(' ');
      if (
        previousEnd != null &&
        previousKinds === kinds &&
        previousEnd.character === previousCharacter
      ) {
        previousEnd.character = character;
      } else {
        previousEnd = { line, character };
        decorations.push({
          start: { line, character: previousCharacter },
          end: previousEnd,
          properties: { 'data-diff-focus': kinds },
          alwaysWrap: true,
        });
        previousKinds = kinds;
      }
    }
    while (
      index < boundaries.length &&
      boundaries[index].character === character
    ) {
      const { kind, change } = boundaries[index++];
      const count = (active.get(kind) ?? 0) + change;
      if (count === 0) active.delete(kind);
      else active.set(kind, count);
    }
    previousCharacter = character;
  }
}
