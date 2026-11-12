import type { Connector, SideBounds } from '../components/SemanticConnector';
import type { SelectedRowEdges } from '../managers/InteractionManager';
import type { SemanticDiffConnectorAttachment } from '../types';
import type {
  SemanticDiffConnectorRange,
  SemanticDiffConnectorRegion,
} from './semanticDiffConnectors';

// This file works out where to draw the connectors of a semantic diff.
//
// Terms used below:
// - Connector: the colored band in the middle column of a split diff. It
//   joins some lines in the old column to some lines in the new column. Once
//   measured, it is the top and bottom of each of its two ends, in pixels.
// - Row: one element in a code column. Most rows show one source line.
// - Rendered: in the page right now. A virtualized diff only renders the
//   rows near the viewport, so most lines of a long file have no row.
// - Region: the lines one connector joins. Usually some old lines and some
//   new lines. For code that was only added or only removed, it is the lines
//   on one side, and one point on the other side where the connector ends.

// A closed fold's row draws a 1px line through its middle. This is half of
// that line's height.
const FOLD_LINE_HALF_HEIGHT = 0.5;

// One rendered source line.
interface MountedLine {
  /** The row that shows the line. */
  element: HTMLElement;
  /**
   * A group number. Lines that follow each other, with nothing between them
   * that breaks a band, have the same number.
   */
  run: number;
  /**
   * The last row that belongs to the line. Usually this is `element`. It is
   * the row below when that row is the line's annotation or its "No newline
   * at end of file" marker.
   */
  end: HTMLElement;
  /**
   * Set when the line is hidden inside a closed fold: the fold's first old
   * line. `element` and `end` are then the fold's row. A connector touches
   * such a line at the 1px line through the middle of that row.
   */
  fold?: number;
}

/** A computed position for one line. */
export interface ComputedLineBounds extends SideBounds {
  /**
   * Set when the line is hidden inside a closed fold: the fold's first old
   * line. `top` and `bottom` are then the fold's row.
   */
  fold?: number;
  /**
   * Set when `bottom` is the bottom of the "No newline at end of file" row
   * that belongs to the line. That row can be many filler rows below the
   * line.
   */
  reachesNoNewline?: true;
}

/**
 * Answers "where is this line?" without looking at the DOM. It returns the
 * top and bottom of the line's rows, or undefined for a line it cannot place.
 * The numbers are on the diff's own scale, not the page's;
 * `wrapComputeLineBounds` converts them.
 *
 * A virtualized diff provides this, because the lines it has not rendered
 * have no row to measure.
 */
export type ComputeLineBounds = (
  side: 'old' | 'new',
  line: number
) => ComputedLineBounds | undefined;

// Turns regions into connectors. For each region it finds the top and bottom
// of its old lines and of its new lines, in pixels below `originTop`, which is
// the top of the connector column.
//
// `deletions` and `additions` are the old and the new code column.
//
// `openSemanticFolds` holds the semantic folds that are open, by first old
// line. Every other fold is closed.
//
// A connector is left out when one of its ends cannot be placed. That happens
// when a line it needs is not rendered and `computeLineBounds` is not given, or
// when a hunk separator sits in the middle of an end.
export function measureSemanticDiffConnectors(
  regions: readonly SemanticDiffConnectorRegion[],
  deletions: HTMLElement,
  additions: HTMLElement,
  originTop: number,
  _computeLineBounds?: ComputeLineBounds,
  openSemanticFolds?: ReadonlySet<number>
): Connector[] {
  if (regions.length === 0) return [];

  // Step 1: `rects` saves each row's measured position. A row is then
  // measured once, even when several connectors use it.
  const rects = new Map<HTMLElement, DOMRect>();

  // Step 2: Look at each column's rows once. This records which row shows
  // which line, and the first and last line the column has rendered.
  const oldColumn = indexMountedLines(deletions, 'old');
  const newColumn = indexMountedLines(additions, 'new');

  // Step 3: `computeLineBounds` finds the position of a line that is not
  // rendered. It only exists when `_computeLineBounds` was given, which we
  // can assume is a virtualized environment.
  const computeLineBounds =
    _computeLineBounds != null
      ? wrapComputeLineBounds(
          _computeLineBounds,
          oldColumn,
          newColumn,
          rects,
          originTop
        )
      : undefined;

  // Step 4: Go through the regions. Each one has an old end (`base`) and a
  // new end (`target`). An end is a range of lines. For code that was only
  // added or only removed, the other end is a single point (`attachment`).
  const connectors: Connector[] = [];
  for (const region of regions) {
    // Step 4a: Skip a region that belongs to the other state of its fold.
    // The regions that end in one fold are drawn as one joined region while
    // the fold is closed, and each on its own while it is open.
    if (
      region.fold != null &&
      region.fold.closed ===
        (openSemanticFolds?.has(region.fold.start) ?? false)
    ) {
      continue;
    }

    // Step 4b: Skip a region that cannot show. Using line numbers only, check
    // whether each end is above the rendered lines, below them, or among
    // them. Both above, or both below, means the connector is off screen.
    const basePlacement =
      region.base != null
        ? placeLines(oldColumn, region.base.start, region.base.end)
        : placeAttachment(oldColumn, region.attachment);
    const targetPlacement =
      region.target != null
        ? placeLines(newColumn, region.target.start, region.target.end)
        : placeAttachment(newColumn, region.attachment);
    if (
      (basePlacement === 'above' || basePlacement === 'below') &&
      basePlacement === targetPlacement
    ) {
      continue;
    }

    // Step 4c: Find the top and bottom of each end.
    const base =
      region.base != null
        ? measureRun(
            region.base,
            oldColumn,
            rects,
            originTop,
            computeLineBounds
          )
        : measureAttachment(
            region.attachment,
            oldColumn,
            deletions,
            rects,
            originTop,
            computeLineBounds
          );
    const target =
      region.target != null
        ? measureRun(
            region.target,
            newColumn,
            rects,
            originTop,
            computeLineBounds
          )
        : measureAttachment(
            region.attachment,
            newColumn,
            additions,
            rects,
            originTop,
            computeLineBounds
          );
    // Step 4d: Leave the connector out when an end has no position.
    if (base == null || target == null) {
      continue;
    }

    // Step 4e: Keep the connector.
    connectors.push({
      id: region.id,
      kind: region.kind,
      rank: region.rank,
      base,
      target,
    });
  }
  return connectors;
}

/** What one code column has rendered. */
interface MountedColumn {
  /** Which column this is. */
  side: 'old' | 'new';
  /** The rendered lines, by line number. */
  lines: Map<number, MountedLine>;
  /**
   * The lowest and highest rendered line number. When nothing is rendered,
   * `first` is Infinity and `last` is -Infinity, so no line counts as
   * rendered.
   */
  first: number;
  last: number;
  /** Whether the column's "No newline at end of file" row is rendered. */
  hasNoNewline: boolean;
}

// Where some lines are, compared with the lines a column has rendered.
// 'unknown' means the column has no rendered line to compare with.
type Placement = 'above' | 'inside' | 'below' | 'unknown';

function placeLines(
  column: MountedColumn,
  start: number,
  end: number
): Placement {
  // The column shows only filler rows here, so there is nothing to compare.
  if (column.lines.size === 0) return 'unknown';
  // The lines end before the first rendered line: all of them are above.
  if (end < column.first) return 'above';
  // The lines start after the last rendered line: all of them are below.
  if (start > column.last) return 'below';
  // Otherwise at least one of them is among the rendered lines.
  return 'inside';
}

function placeAttachment(
  column: MountedColumn,
  attachment: SemanticDiffConnectorAttachment
): Placement {
  // An empty file has no line to attach to. The connector then ends at the
  // top of the column, which always counts as in view.
  return 'empty' in attachment
    ? 'inside'
    : placeLines(column, attachment.line, attachment.line);
}

// Returns the position of a line that is not rendered, in pixels below the
// connector column's top. Returns undefined when the position is not known.
type ComputeUnrenderedBounds = (
  column: MountedColumn,
  line: number
) => ComputedLineBounds | undefined;

// Builds the function that finds the position of a line that is not
// rendered.
//
// `computeLineBounds` gives positions on the diff's own scale. A connector
// needs them on the page's scale. The two scales differ by one fixed number,
// the offset. To find it: take a line that is rendered, measure where it is
// on the page, ask `computeLineBounds` where it puts that line, and subtract.
function wrapComputeLineBounds(
  computeLineBounds: ComputeLineBounds,
  oldColumn: MountedColumn,
  newColumn: MountedColumn,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number
): ComputeUnrenderedBounds {
  // The offset, once it has been worked out.
  let offset: number | undefined;
  // Works the offset out the first time it is needed.
  const getOffset = (): number | undefined => {
    if (offset != null) return offset;
    // Use the first rendered line of the old column. If the old column has
    // no rendered line, use the new column's.
    for (const column of [oldColumn, newColumn]) {
      const mounted = column.lines.get(column.first);
      const bounds =
        mounted != null
          ? computeLineBounds(column.side, column.first)
          : undefined;
      if (mounted != null && bounds != null) {
        offset =
          getRowRect(mounted.element, rects).top - originTop - bounds.top;
        return offset;
      }
    }
    return undefined;
  };
  return (column, line) => {
    // Ask where the line is, then move the answer by the offset.
    const bounds = computeLineBounds(column.side, line);
    const lineOffset = getOffset();
    if (bounds == null || lineOffset == null) return undefined;
    return {
      top: bounds.top + lineOffset,
      bottom: bounds.bottom + lineOffset,
      fold: bounds.fold,
      reachesNoNewline: bounds.reachesNoNewline,
    };
  };
}

// The top and bottom a connector uses for a line that is not rendered. A
// line hidden in a closed fold is at the 1px line through the middle of the
// fold's row, the same as when the fold's row is rendered.
function getComputedLineEdges(bounds: ComputedLineBounds): SideBounds {
  if (bounds.fold == null) return bounds;
  const middle = (bounds.top + bounds.bottom) / 2;
  return {
    top: middle - FOLD_LINE_HALF_HEIGHT,
    bottom: middle + FOLD_LINE_HALF_HEIGHT,
  };
}

// Looks at every row of a column and records which row shows which line.
//
// It also gives each line a `run` number. Lines get the same number when they
// follow each other with nothing between them that breaks a band. So when two
// lines have the same number, one band can join them, and the rows between
// them need no further check.
function indexMountedLines(
  content: HTMLElement,
  side: 'old' | 'new'
): MountedColumn {
  const lines = new Map<number, MountedLine>();
  // The lowest line number seen so far.
  let first = Infinity;
  let previous: MountedLine | undefined;
  // The line right above the current row, when nothing sits between them.
  let adjacent: MountedLine | undefined;
  let hasNoNewline = false;
  let previousLine = 0;
  let run = 0;
  for (const element of content.children) {
    if (!(element instanceof HTMLElement)) continue;
    // A row that shows a source line. A jump in line numbers starts a new
    // run.
    const sourceLine = element.getAttribute('data-line');
    if (sourceLine != null) {
      const line = Number(sourceLine);
      if (line !== previousLine + 1) run++;
      previous = { element, run, end: element };
      adjacent = previous;
      lines.set(line, previous);
      first = Math.min(first, line);
      previousLine = line;
      continue;
    }
    // A closed fold's row. It stands for every old line the fold hides, so
    // all of those line numbers point to this row.
    if (element.hasAttribute('data-semantic-fold')) {
      adjacent = undefined;
      const start = Number(element.getAttribute('data-semantic-fold-start'));
      const end = Number(element.getAttribute('data-semantic-fold-end'));
      if (start !== previousLine + 1) run++;
      previous = { element, run, end: element, fold: start };
      for (let line = start; line <= end; line++) {
        lines.set(line, previous);
      }
      first = Math.min(first, start);
      previousLine = end;
      continue;
    }
    // A "No newline at end of file" row belongs to the line above it.
    if (element.hasAttribute('data-no-newline')) {
      if (previous != null) previous.end = element;
      adjacent = undefined;
      hasNoNewline = true;
      continue;
    }
    // An annotation row right under a line belongs to that line.
    if (element.hasAttribute('data-line-annotation')) {
      if (adjacent != null) adjacent.end = element;
      adjacent = undefined;
      continue;
    }
    adjacent = undefined;
    // An empty filler row does not break a band. Any other row does, like a
    // hunk separator.
    if (element.hasAttribute('data-content-buffer')) continue;
    run++;
  }
  // Rows are in line order, so the last line seen is the highest.
  return {
    side,
    lines,
    first,
    last: lines.size > 0 ? previousLine : -Infinity,
    hasNoNewline,
  };
}

// Finds the top and bottom of a range of lines on one side.
function measureRun(
  range: SemanticDiffConnectorRange,
  column: MountedColumn,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number,
  computeLineBounds: ComputeUnrenderedBounds | undefined
): SideBounds | undefined {
  // The rows of the range's first and last line, when they are rendered.
  const first = column.lines.get(range.start);
  const last = column.lines.get(range.end);
  // Both are rendered, but something that breaks a band sits between them.
  // That should not happen: one side's lines are always next to each other
  // in one hunk.
  if (first != null && last != null && first.run !== last.run) {
    // Basically I think if we hit this... then we broke something...
    throw new Error(
      `measureSemanticDiffConnectors: ${column.side} lines ${range.start}-${range.end} of a connector are not next to each other; a separator or a jump in line numbers sits between them`
    );
  }
  // The top is measured from the first line's row. When that line is not
  // rendered, its computed position is used instead.
  const computedFirst =
    first == null ? computeLineBounds?.(column, range.start) : undefined;
  const top =
    first != null
      ? getLineTop(first, rects) - originTop
      : computedFirst != null
        ? getComputedLineEdges(computedFirst).top
        : undefined;
  // The bottom is found the same way, from the last line.
  const computedLast =
    last == null ? computeLineBounds?.(column, range.end) : undefined;
  const bottom =
    last != null
      ? measureLineBottom(
          last,
          range.end,
          column,
          rects,
          originTop,
          computeLineBounds
        )
      : computedLast != null
        ? getComputedLineEdges(computedLast).bottom
        : undefined;
  // The top or the bottom has no position: leave the connector out.
  if (top == null || bottom == null) return;
  return { top, bottom };
}

// Finds the single point where a connector for added or removed code ends
// on the other side. The point is at the top of a line, or at the bottom of
// a line.
function measureAttachment(
  attachment: SemanticDiffConnectorAttachment,
  column: MountedColumn,
  content: HTMLElement,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number,
  computeLineBounds: ComputeUnrenderedBounds | undefined
): SideBounds | undefined {
  // A point has no height, so its top and bottom are the same number, `y`.
  let y: number;
  if ('empty' in attachment) {
    // The file is empty on this side: end at the top of the column.
    y = getRowRect(content, rects).top - originTop;
  } else {
    const line = column.lines.get(attachment.line);
    if (line != null) {
      // The line is rendered: measure its row.
      y =
        attachment.edge === 'before'
          ? getLineTop(line, rects) - originTop
          : measureLineBottom(
              line,
              attachment.line,
              column,
              rects,
              originTop,
              computeLineBounds
            );
    } else {
      // The line is not rendered: use its computed position instead.
      const computed = computeLineBounds?.(column, attachment.line);
      if (computed == null) return;
      const edges = getComputedLineEdges(computed);
      y = attachment.edge === 'before' ? edges.top : edges.bottom;
    }
  }
  return { top: y, bottom: y };
}

// Finds the top and bottom of each hunk separator in a column. The connector
// column draws a bar at each one, so a separator looks like one bar across
// both code columns. Custom separators are skipped: they have no bar.
export function measureSemanticDiffSeparators(
  content: HTMLElement,
  originTop: number
): SideBounds[] {
  const separators: SideBounds[] = [];
  for (const element of content.children) {
    if (!(element instanceof HTMLElement)) continue;
    const type = element.getAttribute('data-separator');
    if (type == null || type === 'custom') continue;
    const rect = element.getBoundingClientRect();
    separators.push({
      top: rect.top - originTop,
      bottom: rect.bottom - originTop,
    });
  }
  return separators;
}

// Finds the top and bottom of the selected rows, across both columns. The
// connector column draws one band there, so a selection looks like one block
// across the split. `edges` holds the first and last selected row of each
// column, so only those rows are measured.
export function measureSemanticDiffSelection(
  edges: readonly SelectedRowEdges[],
  originTop: number
): SideBounds | undefined {
  let selection: SideBounds | undefined;
  for (const { first, last } of edges) {
    const top = first.getBoundingClientRect().top - originTop;
    const bottom = last.getBoundingClientRect().bottom - originTop;
    selection = {
      top: Math.min(top, selection?.top ?? top),
      bottom: Math.max(bottom, selection?.bottom ?? bottom),
    };
  }
  return selection;
}

// The top of a line's rows. A line hidden in a closed fold has no row of its
// own. Its top is the top of the 1px line through the middle of the fold's
// row.
function getLineTop(
  line: MountedLine,
  rects: Map<HTMLElement, DOMRect>
): number {
  const rect = getRowRect(line.element, rects);
  return line.fold != null
    ? (rect.top + rect.bottom) / 2 - FOLD_LINE_HALF_HEIGHT
    : rect.top;
}

// The bottom of a line's rows. For a line hidden in a closed fold, it is the
// bottom of that same 1px line.
function getLineBottom(
  line: MountedLine,
  rects: Map<HTMLElement, DOMRect>
): number {
  const rect = getRowRect(line.end, rects);
  return line.fold != null
    ? (rect.top + rect.bottom) / 2 + FOLD_LINE_HALF_HEIGHT
    : rect.bottom;
}

// The bottom of a rendered line, from the connector column's top.
//
// A side's last line reaches down to that side's "No newline at end of file"
// row, which can be many filler rows below it. When the line is rendered and
// that row is not, the row's bottom comes from the line's computed position.
// Only the last rendered line of a column can be in that state.
function measureLineBottom(
  line: MountedLine,
  lineNumber: number,
  column: MountedColumn,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number,
  computeLineBounds: ComputeUnrenderedBounds | undefined
): number {
  const bottom = getLineBottom(line, rects) - originTop;
  if (column.hasNoNewline || lineNumber !== column.last) return bottom;
  const computed = computeLineBounds?.(column, lineNumber);
  return computed?.reachesNoNewline === true ? computed.bottom : bottom;
}

// Measures a row, or returns the measurement saved for it.
function getRowRect(
  element: HTMLElement,
  rects: Map<HTMLElement, DOMRect>
): DOMRect {
  let rect = rects.get(element);
  if (rect == null) {
    rect = element.getBoundingClientRect();
    rects.set(element, rect);
  }
  return rect;
}
