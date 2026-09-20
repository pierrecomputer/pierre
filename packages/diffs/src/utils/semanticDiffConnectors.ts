import type { ConnectorKind } from '../components/SemanticConnector';
import type {
  FileDiffMetadata,
  LineTypes,
  SemanticDiffLineRange,
  SemanticDiffSpan,
  SemanticDiffSpanAnchor,
  SemanticDiffTextRange,
} from '../types';
import { extendSemanticConnectorBlankLines } from './extendSemanticConnectorBlankLines';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import { mergeSemanticDiffLinePairs } from './mergeSemanticDiffLinePairs';
import {
  resolveSemanticConnectorAnchors,
  type SemanticDiffConnectorAnchor,
} from './resolveSemanticConnectorAnchors';
import { resolveSemanticDiffSpanAnchor } from './resolveSemanticDiffSpanAnchor';
import { semanticLineType } from './semanticDiffLines';

/** Inclusive source line numbers, starting at 1. */
export interface SemanticDiffConnectorRange {
  start: number;
  end: number;
}

interface OwnedConnectorRun extends SemanticDiffConnectorRange {
  anchorIndex?: number;
}

interface BaseSemanticDiffConnector {
  id: string;
  kind: ConnectorKind;
  rank: number;
}

interface BodyBounds {
  old: SemanticDiffTextRange;
  new: SemanticDiffTextRange;
}

/** Source regions connected across both split-view columns. */
export interface SemanticDiffPairedConnector extends BaseSemanticDiffConnector {
  base: SemanticDiffConnectorRange;
  target: SemanticDiffConnectorRange;
}

/** Added source lines with no old-side region. */
export interface SemanticDiffAddedConnector extends BaseSemanticDiffConnector {
  base?: never;
  target: SemanticDiffConnectorRange;
  anchor?: SemanticDiffConnectorAnchor;
  /** Keep call and container anchors attached to their operation's body. */
  preserveAnchor: boolean;
}

/** Removed source lines with no new-side region. */
export interface SemanticDiffRemovedConnector extends BaseSemanticDiffConnector {
  base: SemanticDiffConnectorRange;
  target?: never;
  anchor?: SemanticDiffConnectorAnchor;
  /** Keep call and container anchors attached to their operation's body. */
  preserveAnchor: boolean;
}

/** Source regions to measure for a connecting band or an addition/deletion nub. */
export type SemanticDiffConnector =
  | SemanticDiffPairedConnector
  | SemanticDiffAddedConnector
  | SemanticDiffRemovedConnector;

const CONNECTOR_KIND_BY_LINE_TYPE: Record<
  LineTypes,
  ConnectorKind | undefined
> = {
  context: undefined,
  'context-expanded': undefined,
  'change-addition': 'added',
  'change-deletion': 'deleted',
  'change-moved': 'moved',
  'change-moved-with-edit': 'modified',
  'change-edited': 'modified',
  'change-renamed': 'modified',
  'change-reordered': 'moved',
  'change-reformatted': 'reformatted',
  'change-extracted-function': 'moved',
  'change-inlined-function': 'moved',
};

// Use the converter's owned source runs before checking which rows are mounted.
// The same diff then keeps the same pairs and IDs as the viewport changes.
export function prepareSemanticDiffConnectors(
  fileDiff: FileDiffMetadata
): SemanticDiffConnector[] {
  const operations = fileDiff.semanticOperations;
  if (operations == null || operations.length === 0) return [];
  const breaks = getSourceRunBreaks(fileDiff);
  const connectors: SemanticDiffConnector[] = [];
  for (const [operationIndex, operation] of operations.entries()) {
    const kinds = new Map<number, ConnectorKind>();
    for (const [spanIndex, span] of operation.spans.entries()) {
      if (span.role === 'body' && span.relation === 'mapped') continue;
      // A one-sided span may own only blank lines and have no ranges; its
      // owned line runs decide whether it draws anything.
      if (
        span.relation !== 'introduced' &&
        span.relation !== 'removed' &&
        (span.old.length === 0 ||
          span.new.length === 0 ||
          (span.role === 'focus' && operation.type !== 'renamed'))
      ) {
        continue;
      }
      const kind =
        CONNECTOR_KIND_BY_LINE_TYPE[semanticLineType(operation, span)];
      if (kind != null) kinds.set(spanIndex, kind);
    }
    if (kinds.size === 0) continue;
    const oldRuns = groupOwnedRuns(operation.lines.old, breaks.old, kinds);
    const newRuns = groupOwnedRuns(operation.lines.new, breaks.new, kinds);
    const bodies = operationBodyBounds(operation.spans);
    for (const [spanIndex, kind] of kinds) {
      const span = operation.spans[spanIndex];
      const baseRuns = oldRuns.get(spanIndex);
      const targetRuns = newRuns.get(spanIndex);
      const bodyBounds = span.role === 'call' ? bodies.moved : bodies.container;
      const preserveAnchor = span.role === 'call' || span.role === 'container';
      if (span.relation === 'introduced') {
        for (const target of targetRuns ?? []) {
          const anchor =
            span.anchors == null
              ? bodyAnchorFor(span, target, 'new', bodyBounds)
              : suppliedRunAnchor(span.anchors, target.anchorIndex, 'old');
          if (span.anchors != null && anchor == null) continue;
          connectors.push({
            id: `${operationIndex}:${spanIndex}:new:${target.start}-${target.end}`,
            kind,
            rank: 2,
            target,
            anchor,
            preserveAnchor,
          });
        }
        continue;
      }
      if (span.relation === 'removed') {
        for (const base of baseRuns ?? []) {
          const anchor =
            span.anchors == null
              ? bodyAnchorFor(span, base, 'old', bodyBounds)
              : suppliedRunAnchor(span.anchors, base.anchorIndex, 'new');
          if (span.anchors != null && anchor == null) continue;
          connectors.push({
            id: `${operationIndex}:${spanIndex}:old:${base.start}-${base.end}`,
            kind,
            rank: 2,
            base,
            anchor,
            preserveAnchor,
          });
        }
        continue;
      }
      const rank =
        operation.type === 'inlinedFunction' && kind === 'moved' ? 1 : 0;
      for (const pair of mergeSemanticDiffLinePairs(span.linePairs, breaks)) {
        const { old: base, new: target } = pair;
        connectors.push({
          id: `${operationIndex}:${spanIndex}:${base.start}-${base.end}:${target.start}-${target.end}`,
          kind,
          rank,
          base,
          target,
        });
      }
    }
  }
  extendSemanticConnectorBlankLines(fileDiff, connectors, breaks);
  resolveSemanticConnectorAnchors(fileDiff, connectors);
  return connectors.sort((a, b) => a.rank - b.rank);
}

// One anchor can serve every run. With several anchors, the producer identifies
// which one belongs to each run; layout splits retain that same index.
function suppliedRunAnchor(
  anchors: readonly SemanticDiffSpanAnchor[],
  anchorIndex: number | undefined,
  side: 'old' | 'new'
): SemanticDiffConnectorAnchor | undefined {
  const index = anchorIndex ?? (anchors.length === 1 ? 0 : undefined);
  const anchor = index == null ? undefined : anchors[index];
  return anchor == null
    ? undefined
    : resolveSemanticDiffSpanAnchor(anchor, side);
}

// Calls stay attached to the moved body. Wrappers also enclose replaced body
// spans, such as a return statement changed during extraction.
function operationBodyBounds(spans: readonly SemanticDiffSpan[]): {
  moved?: BodyBounds;
  container?: BodyBounds;
} {
  let moved: BodyBounds | undefined;
  let container: BodyBounds | undefined;
  for (const span of spans) {
    if (
      span.role !== 'body' ||
      span.relation === 'introduced' ||
      span.relation === 'removed'
    ) {
      continue;
    }
    const old = sourceRangeBounds(span.old);
    const added = sourceRangeBounds(span.new);
    if (old == null || added == null) continue;
    if (span.relation === 'moved') moved = { old, new: added };
    if (container == null) {
      container = { old: { ...old }, new: { ...added } };
    } else {
      extendSourceRange(container.old, old);
      extendSourceRange(container.new, added);
    }
  }
  return { moved, container };
}

// Keep a call or wrapper on its own body's edge even when another operation
// provides a closer edge in the full diff.
function bodyAnchorFor(
  span: SemanticDiffSpan,
  run: SemanticDiffConnectorRange,
  side: 'old' | 'new',
  body: BodyBounds | undefined
): SemanticDiffConnectorAnchor | undefined {
  const present = body?.[side];
  const opposite = body?.[side === 'old' ? 'new' : 'old'];
  if (present == null || opposite == null) return undefined;
  let edge: 'before' | 'after';
  if (span.role === 'call') {
    const call = sourceRangeBounds(span[side]);
    if (call == null) return undefined;
    edge =
      present.end.line < call.start.line ||
      (present.end.line === call.start.line &&
        present.end.character <= call.start.character)
        ? 'after'
        : 'before';
  } else if (span.role === 'container') {
    if (run.end < present.start.line) {
      edge = 'before';
    } else if (
      run.start > present.end.line ||
      (run.start === present.end.line && present.end.character === 0)
    ) {
      edge = 'after';
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
  return {
    line:
      edge === 'before'
        ? opposite.start.line
        : opposite.end.line - (opposite.end.character === 0 ? 1 : 0),
    edge,
  };
}

// A body can contain several node ranges; anchors use its first and last text.
function sourceRangeBounds(
  ranges: readonly SemanticDiffTextRange[] | undefined
): SemanticDiffTextRange | undefined {
  if (ranges == null || ranges.length === 0) return undefined;
  const bounds = { ...ranges[0] };
  for (let index = 1; index < ranges.length; index++) {
    extendSourceRange(bounds, ranges[index]);
  }
  return bounds;
}

function extendSourceRange(
  bounds: SemanticDiffTextRange,
  range: SemanticDiffTextRange
): void {
  if (
    range.start.line < bounds.start.line ||
    (range.start.line === bounds.start.line &&
      range.start.character < bounds.start.character)
  ) {
    bounds.start = range.start;
  }
  if (
    range.end.line > bounds.end.line ||
    (range.end.line === bounds.end.line &&
      range.end.character > bounds.end.character)
  ) {
    bounds.end = range.end;
  }
}

// A cut names the first source line after a gap. Hunk counts locate alignment
// gaps without visiting every line; hunk boundaries keep cuts stable on expansion.
function getSourceRunBreaks(fileDiff: FileDiffMetadata): {
  old: number[];
  new: number[];
} {
  const oldBreaks = new Set<number>();
  const newBreaks = new Set<number>();
  let oldLine = 1;
  let newLine = 1;
  for (const hunk of fileDiff.hunks) {
    const oldStart =
      getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) + 1;
    const newStart =
      getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) + 1;
    if (oldStart > oldLine || newStart > newLine) {
      oldBreaks.add(oldLine);
      oldBreaks.add(oldStart);
      newBreaks.add(newLine);
      newBreaks.add(newStart);
    }
    oldLine = oldStart;
    newLine = newStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        oldLine += content.lines;
        newLine += content.lines;
      } else {
        oldLine += content.deletions;
        newLine += content.additions;
        if (content.deletions < content.additions) oldBreaks.add(oldLine);
        if (content.additions < content.deletions) newBreaks.add(newLine);
      }
    }
  }
  if (fileDiff.hunks.length > 0) {
    oldBreaks.add(oldLine);
    newBreaks.add(newLine);
  }
  return {
    old: [...oldBreaks].sort((a, b) => a - b),
    new: [...newBreaks].sort((a, b) => a - b),
  };
}

// Join adjacent ownership ranges for each eligible span, stopping at source gaps
// or split-view gaps. The supplied ranges are already sorted by source line.
function groupOwnedRuns(
  ranges: readonly SemanticDiffLineRange[],
  breaks: readonly number[],
  kinds: ReadonlyMap<number, ConnectorKind>
): Map<number, OwnedConnectorRun[]> {
  const spans = new Map<number, OwnedConnectorRun[]>();
  for (const range of ranges) {
    if (!kinds.has(range.spanIndex)) continue;
    let runs = spans.get(range.spanIndex);
    if (runs == null) {
      runs = [];
      spans.set(range.spanIndex, runs);
    }
    let start = range.start;
    let breakIndex = firstBreakAtOrAfter(breaks, start);
    let splitBefore = breaks[breakIndex] === start;
    if (splitBefore) breakIndex++;
    while (start <= range.end) {
      const nextBreak = breaks[breakIndex];
      const end =
        nextBreak != null && nextBreak <= range.end ? nextBreak - 1 : range.end;
      const previous = runs[runs.length - 1];
      if (
        !splitBefore &&
        previous != null &&
        previous.end + 1 === start &&
        previous.anchorIndex === range.anchorIndex
      ) {
        previous.end = end;
      } else {
        runs.push({ start, end, anchorIndex: range.anchorIndex });
      }
      start = end + 1;
      breakIndex++;
      splitBefore = true;
    }
  }
  return spans;
}

// Operations can start anywhere in the file, so skip earlier cuts in one search.
function firstBreakAtOrAfter(breaks: readonly number[], line: number): number {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (breaks[middle] < line) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
