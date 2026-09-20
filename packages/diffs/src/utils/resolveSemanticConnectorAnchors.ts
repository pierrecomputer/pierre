import type { FileDiffMetadata } from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import type {
  SemanticDiffConnector,
  SemanticDiffConnectorRange,
} from './semanticDiffConnectors';

/** A real source row's edge on the connector's missing side. */
export interface SemanticDiffConnectorLineAnchor {
  line: number;
  edge: 'before' | 'after';
}

/** The opposite file is empty, so its content origin is the only boundary. */
export interface SemanticDiffConnectorEmptyAnchor {
  empty: true;
}

export type SemanticDiffConnectorAnchor =
  | SemanticDiffConnectorLineAnchor
  | SemanticDiffConnectorEmptyAnchor;

interface SourceSegment extends SemanticDiffConnectorRange {
  row: number;
}

interface SourceLayout {
  segments: SourceSegment[];
  empty: boolean;
}

interface ConnectorEvent {
  connectorIndex: number;
  range: SemanticDiffConnectorRange;
  first: number;
  last: number;
  paired: boolean;
}

interface SideCursor {
  events: ConnectorEvent[];
  index: number;
  previous?: ConnectorEvent;
  consumed: Set<number>;
  layout: SourceLayout;
}

// Keep addition/deletion nubs between their neighboring connectors. Use the
// complete diff so scrolling does not change their source anchors.
export function resolveSemanticConnectorAnchors(
  fileDiff: FileDiffMetadata,
  connectors: SemanticDiffConnector[]
): void {
  if (
    !connectors.some(
      (connector) =>
        (connector.base == null || connector.target == null) &&
        (connector.anchor == null || !connector.preserveAnchor)
    )
  ) {
    return;
  }
  const layout = createSourceLayout(fileDiff, connectors);
  const base = createCursor(connectors, 'base', layout.base);
  const target = createCursor(connectors, 'target', layout.target);
  const consume = (own: SideCursor, other: SideCursor): void => {
    const event = own.events[own.index];
    const connector = connectors[event.connectorIndex];
    if (event.paired) {
      own.consumed.add(event.connectorIndex);
    } else if (
      (connector.base == null || connector.target == null) &&
      (connector.anchor == null || !connector.preserveAnchor)
    ) {
      connector.anchor = chooseGapAnchor(
        other.previous,
        other.events[other.index],
        event,
        other.layout,
        connector.anchor
      );
    }
    own.previous = event;
    own.index++;
  };
  while (
    base.index < base.events.length ||
    target.index < target.events.length
  ) {
    const baseEvent = base.events[base.index];
    const targetEvent = target.events[target.index];
    if (
      baseEvent != null &&
      targetEvent != null &&
      baseEvent.connectorIndex === targetEvent.connectorIndex &&
      baseEvent.paired
    ) {
      base.previous = baseEvent;
      target.previous = targetEvent;
      base.index++;
      target.index++;
      continue;
    }

    // Rejoin an already consumed pair, then place one-sided heads before unseen
    // paired landmarks. Otherwise advance whichever endpoint comes first.
    let takeBase: boolean;
    if (targetEvent == null) {
      takeBase = true;
    } else if (baseEvent == null) {
      takeBase = false;
    } else if (target.consumed.has(baseEvent.connectorIndex)) {
      takeBase = true;
    } else if (base.consumed.has(targetEvent.connectorIndex)) {
      takeBase = false;
    } else if (baseEvent.paired !== targetEvent.paired) {
      takeBase = !baseEvent.paired;
    } else {
      takeBase = compareEvents(baseEvent, targetEvent) <= 0;
    }
    if (takeBase) {
      consume(base, target);
    } else {
      consume(target, base);
    }
  }
}

// Each segment has consecutive source lines and split rows. Hunk counts account
// for alignment gaps without expanding the file into individual line records.
function createSourceLayout(
  fileDiff: FileDiffMetadata,
  connectors: readonly SemanticDiffConnector[]
): { base: SourceLayout; target: SourceLayout } {
  const base: SourceLayout = {
    segments: [],
    empty: !fileDiff.isPartial && fileDiff.deletionLines.length === 0,
  };
  const target: SourceLayout = {
    segments: [],
    empty: !fileDiff.isPartial && fileDiff.additionLines.length === 0,
  };
  let oldLine = 1;
  let newLine = 1;
  let row = 0;
  for (const hunk of fileDiff.hunks) {
    const oldStart =
      getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) + 1;
    const newStart =
      getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) + 1;
    const oldGap = oldStart - oldLine;
    const newGap = newStart - newLine;
    appendSegment(base.segments, oldLine, oldGap, row);
    appendSegment(target.segments, newLine, newGap, row);
    row += Math.max(oldGap, newGap);
    oldLine = oldStart;
    newLine = newStart;
    for (const content of hunk.hunkContent) {
      const oldCount =
        content.type === 'context' ? content.lines : content.deletions;
      const newCount =
        content.type === 'context' ? content.lines : content.additions;
      appendSegment(base.segments, oldLine, oldCount, row);
      appendSegment(target.segments, newLine, newCount, row);
      oldLine += oldCount;
      newLine += newCount;
      row += Math.max(oldCount, newCount);
    }
  }
  if (fileDiff.isPartial) {
    // Owned lines beyond the last hunk prove that this unchanged tail exists on
    // both sides. Compact patch arrays cannot tell us the complete file length.
    let tail = 0;
    for (const connector of connectors) {
      if (connector.base != null)
        tail = Math.max(tail, connector.base.end - oldLine + 1);
      if (connector.target != null)
        tail = Math.max(tail, connector.target.end - newLine + 1);
    }
    appendSegment(base.segments, oldLine, tail, row);
    appendSegment(target.segments, newLine, tail, row);
  } else {
    appendSegment(
      base.segments,
      oldLine,
      fileDiff.deletionLines.length - oldLine + 1,
      row
    );
    appendSegment(
      target.segments,
      newLine,
      fileDiff.additionLines.length - newLine + 1,
      row
    );
  }
  return { base, target };
}

function appendSegment(
  segments: SourceSegment[],
  start: number,
  count: number,
  row: number
): void {
  if (count <= 0) return;
  const previous = segments[segments.length - 1];
  if (
    previous != null &&
    previous.end + 1 === start &&
    previous.row + previous.end - previous.start + 1 === row
  ) {
    previous.end += count;
  } else {
    segments.push({ start, end: start + count - 1, row });
  }
}

// Sort each side by its position in the complete split layout, keeping source
// ranges beside those positions for the final anchor.
function createCursor(
  connectors: readonly SemanticDiffConnector[],
  side: 'base' | 'target',
  layout: SourceLayout
): SideCursor {
  const events: ConnectorEvent[] = [];
  for (const [connectorIndex, connector] of connectors.entries()) {
    const range = connector[side];
    if (range == null) continue;
    const first = sourceRow(layout.segments, range.start);
    const last = sourceRow(layout.segments, range.end);
    if (first == null || last == null) continue;
    events.push({
      connectorIndex,
      range,
      first,
      last,
      paired: connector.base != null && connector.target != null,
    });
  }
  events.sort(compareEvents);
  return { events, index: 0, consumed: new Set(), layout };
}

function compareEvents(left: ConnectorEvent, right: ConnectorEvent): number {
  const first = left.first - right.first;
  if (first !== 0) return first;
  const last = left.last - right.last;
  return last !== 0 ? last : left.connectorIndex - right.connectorIndex;
}

function sourceRow(
  segments: readonly SourceSegment[],
  line: number
): number | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (line < segment.start) {
      high = middle - 1;
    } else if (line > segment.end) {
      low = middle + 1;
    } else {
      return segment.row + line - segment.start;
    }
  }
  return undefined;
}

// Keep anchors inside the gap between neighboring connectors. Otherwise choose
// the edge closest to the present span; ties use the next endpoint's top edge.
// FOLLOWUP: Prefer server-provided anchors that already respect connector order.
// Keep this adjustment until that contract is guaranteed.
function chooseGapAnchor(
  previous: ConnectorEvent | undefined,
  next: ConnectorEvent | undefined,
  present: ConnectorEvent,
  layout: SourceLayout,
  anchor: SemanticDiffConnectorAnchor | undefined
): SemanticDiffConnectorAnchor | undefined {
  if (anchor != null) {
    if ('empty' in anchor) return anchor;
    let resolved: SemanticDiffConnectorLineAnchor = anchor;
    let row = sourceRow(layout.segments, anchor.line);
    // A supplied anchor line one past the last row means content appended
    // at the end. That line has no row, so attach below the last row.
    if (row == null && anchor.edge === 'before') {
      const last = layout.segments[layout.segments.length - 1];
      if (last != null && anchor.line === last.end + 1) {
        resolved = { line: last.end, edge: 'after' };
        row = last.row + last.end - last.start;
      }
    }
    // A partial diff may not include the anchor's source row. Keep it for
    // measurement, which omits the nub if that row is not mounted.
    if (row == null) return anchor;
    const boundary = row + (resolved.edge === 'after' ? 1 : 0);
    if (
      (previous == null || previous.last + 1 <= boundary) &&
      (next == null || boundary <= next.first)
    ) {
      return resolved;
    }
  }
  const midpoint = (present.first + present.last + 1) / 2;
  if (previous == null && next == null) {
    return nearestSourceBoundary(layout, midpoint);
  }
  if (
    next == null ||
    (previous != null &&
      Math.abs(midpoint - (previous.last + 1)) <
        Math.abs(next.first - midpoint))
  ) {
    return previous == null
      ? undefined
      : { line: previous.range.end, edge: 'after' };
  }
  return { line: next.range.start, edge: 'before' };
}

// With no opposing semantic endpoint, infer an anchor from the nearest real
// source-row edge in the ordinary split diff.
function nearestSourceBoundary(
  layout: SourceLayout,
  midpoint: number
): SemanticDiffConnectorAnchor | undefined {
  if (layout.empty) {
    return { empty: true };
  }
  const segments = layout.segments;
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (segment.row + segment.end - segment.start + 1 < midpoint) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const next = segments[low];
  const previous = segments[low - 1];
  if (next == null) {
    return previous == null ? undefined : { line: previous.end, edge: 'after' };
  }
  if (midpoint < next.row) {
    if (
      previous != null &&
      midpoint - (previous.row + previous.end - previous.start + 1) <
        next.row - midpoint
    ) {
      return { line: previous.end, edge: 'after' };
    }
    return { line: next.start, edge: 'before' };
  }
  const line = next.start + Math.round(midpoint - next.row);
  return line > next.end
    ? { line: next.end, edge: 'after' }
    : { line, edge: 'before' };
}
