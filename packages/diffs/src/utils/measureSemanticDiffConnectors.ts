import type { Connector, SideBounds } from '../components/SemanticConnector';
import type { SelectedRowEdges } from '../managers/InteractionManager';
import type { SemanticDiffConnectorAttachment } from '../types';
import type {
  SemanticDiffConnector,
  SemanticDiffConnectorRange,
} from './semanticDiffConnectors';

// Half the height of the line a collapsed region's row draws (see style.css).
const COLLAPSED_LINE_HALF_HEIGHT = 0.5;

// How far apart, in pixels, two band ends can be and still count as touching.
// Adjacent rows share an edge, up to sub-pixel rounding.
const MERGE_TOLERANCE = 0.5;

interface MountedLine {
  element: HTMLElement;
  run: number;
  /**
   * May be an annotation line that's attached to the row above or a no-newline
   * row
   */
  end: HTMLElement;
  /**
   * Set when a collapsed region hides the line: `element` and `end` are then
   * the region's row, and connectors meet the line at the row's 1px center
   * line.
   */
  collapsed?: true;
}

// Measure endpoint runs whose rows are mounted in one uninterrupted stretch.
// Annotations and gap rows between source rows stay inside a band; a
// separator, a jump in line numbers, or an unmounted endpoint keeps it out.
export function measureSemanticDiffConnectors(
  regions: readonly SemanticDiffConnector[],
  deletions: HTMLElement,
  additions: HTMLElement,
  originTop: number
): Connector[] {
  if (regions.length === 0) return [];
  const oldLines = indexMountedLines(deletions);
  const newLines = indexMountedLines(additions);
  const rects = new Map<HTMLElement, DOMRect>();
  const measured: MeasuredConnector[] = [];
  for (const region of regions) {
    const base =
      region.base != null
        ? measureRun(region.base, oldLines, rects, originTop)
        : measureAttachment(
            region.attachment,
            oldLines,
            deletions,
            rects,
            originTop
          );
    const target =
      region.target != null
        ? measureRun(region.target, newLines, rects, originTop)
        : measureAttachment(
            region.attachment,
            newLines,
            additions,
            rects,
            originTop
          );
    if (base == null || target == null) {
      continue;
    }
    measured.push({
      connector: {
        id: region.id,
        kind: region.kind,
        rank: region.rank,
        base,
        target,
      },
      collapsedRows: {
        base:
          region.base != null
            ? getCollapsedRow(oldLines, region.base.start, region.base.end)
            : getAttachmentCollapsedRow(oldLines, region.attachment),
        target:
          region.target != null
            ? getCollapsedRow(newLines, region.target.start, region.target.end)
            : getAttachmentCollapsedRow(newLines, region.attachment),
      },
      merged: false,
    });
  }
  mergeOnCollapsedRows(measured, 'base');
  mergeOnCollapsedRows(measured, 'target');
  return measured
    .filter((entry) => !entry.merged)
    .map((entry) => entry.connector);
}

interface MeasuredConnector {
  connector: Connector;
  /** The collapsed region row each end lies on, when it lies on one. */
  collapsedRows: { base?: HTMLElement; target?: HTMLElement };
  /** Folded into another connector by `mergeOnCollapsedRows`. */
  merged: boolean;
}

// The collapsed region row that hides every line from `start` to `end`, if one
// does.
function getCollapsedRow(
  lines: Map<number, MountedLine>,
  start: number,
  end: number
): HTMLElement | undefined {
  const first = lines.get(start);
  return first?.collapsed === true && lines.get(end)?.element === first.element
    ? first.element
    : undefined;
}

function getAttachmentCollapsedRow(
  lines: Map<number, MountedLine>,
  attachment: SemanticDiffConnectorAttachment
): HTMLElement | undefined {
  return 'empty' in attachment
    ? undefined
    : getCollapsedRow(lines, attachment.line, attachment.line);
}

// Connectors whose `side` ends lie on one collapsed region's row all narrow to
// its 1px line, where their translucent fills would stack. Merge the ones of
// one kind whose other ends touch into a single band spanning those ends.
// Ends that don't touch stay separate, so a band never covers unrelated rows.
function mergeOnCollapsedRows(
  entries: MeasuredConnector[],
  side: 'base' | 'target'
): void {
  const other = side === 'base' ? 'target' : 'base';
  const groups = new Map<
    HTMLElement,
    Map<Connector['kind'], MeasuredConnector[]>
  >();
  for (const entry of entries) {
    const row = entry.collapsedRows[side];
    if (row == null || entry.merged) continue;
    let byKind = groups.get(row);
    if (byKind == null) {
      byKind = new Map();
      groups.set(row, byKind);
    }
    const group = byKind.get(entry.connector.kind);
    if (group == null) {
      byKind.set(entry.connector.kind, [entry]);
    } else {
      group.push(entry);
    }
  }
  for (const byKind of groups.values()) {
    for (const group of byKind.values()) {
      group.sort((a, b) => a.connector[other].top - b.connector[other].top);
      let current = group[0];
      for (const entry of group.slice(1)) {
        const currentEnd = current.connector[other];
        const entryEnd = entry.connector[other];
        if (entryEnd.top > currentEnd.bottom + MERGE_TOLERANCE) {
          current = entry;
          continue;
        }
        const span = {
          top: currentEnd.top,
          bottom: Math.max(currentEnd.bottom, entryEnd.bottom),
        };
        current.connector = {
          ...current.connector,
          rank: Math.min(current.connector.rank, entry.connector.rank),
          ...(other === 'base' ? { base: span } : { target: span }),
        };
        entry.merged = true;
      }
    }
  }
}

// Number each uninterrupted sequence so checking two endpoints also proves that
// every source row between them is mounted, without scanning each region again.
function indexMountedLines(content: HTMLElement): Map<number, MountedLine> {
  const lines = new Map<number, MountedLine>();
  let previous: MountedLine | undefined;
  // The line whose rows end directly above the current element, if any.
  let adjacent: MountedLine | undefined;
  let previousLine = 0;
  let run = 0;
  for (const element of content.children) {
    if (!(element instanceof HTMLElement)) continue;
    const sourceLine = element.getAttribute('data-line');
    if (sourceLine != null) {
      const line = Number(sourceLine);
      if (line !== previousLine + 1) run++;
      previous = { element, run, end: element };
      adjacent = previous;
      lines.set(line, previous);
      previousLine = line;
      continue;
    }
    // A collapsed region's row stands in for every old line it hides.
    if (element.hasAttribute('data-semantic-region')) {
      adjacent = undefined;
      const start = Number(element.getAttribute('data-semantic-region-start'));
      const end = Number(element.getAttribute('data-semantic-region-end'));
      if (start !== previousLine + 1) run++;
      previous = { element, run, end: element, collapsed: true };
      for (let line = start; line <= end; line++) {
        lines.set(line, previous);
      }
      previousLine = end;
      continue;
    }
    if (element.hasAttribute('data-no-newline')) {
      if (previous != null) previous.end = element;
      adjacent = undefined;
      continue;
    }
    // An annotation row directly under a line belongs to it, as it does for a
    // selection that ends on that line.
    if (element.hasAttribute('data-line-annotation')) {
      if (adjacent != null) adjacent.end = element;
      adjacent = undefined;
      continue;
    }
    adjacent = undefined;
    if (element.hasAttribute('data-content-buffer')) continue;
    run++;
  }
  return lines;
}

// A run ends at the last row drawn for its final line (see MountedLine.end).
function measureRun(
  range: SemanticDiffConnectorRange,
  lines: Map<number, MountedLine>,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number
): SideBounds | undefined {
  const first = lines.get(range.start);
  const last = lines.get(range.end);
  if (first == null || last == null || first.run !== last.run) return;
  return {
    top: getLineTop(first, rects) - originTop,
    bottom: getLineBottom(last, rects) - originTop,
  };
}

// Find the row edge where an addition or deletion connector ends: the top of
// the line, or the bottom of the last row drawn for it (see MountedLine.end).
// Use the content's top for an empty file; skip rows that aren't rendered.
function measureAttachment(
  attachment: SemanticDiffConnectorAttachment,
  lines: Map<number, MountedLine>,
  content: HTMLElement,
  rects: Map<HTMLElement, DOMRect>,
  originTop: number
): SideBounds | undefined {
  let y: number;
  if ('empty' in attachment) {
    y = getRowRect(content, rects).top - originTop;
  } else {
    const line = lines.get(attachment.line);
    if (line == null) return;
    y =
      (attachment.edge === 'before'
        ? getLineTop(line, rects)
        : getLineBottom(line, rects)) - originTop;
  }
  return { top: y, bottom: y };
}

// Measure the hunk separators in a split column. Their bars stop at each
// column's inner edge, so the connector column repeats them to join the two
// halves. Custom separators have no bar of their own.
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

// Measure the selected rows of both split columns as one vertical span. A line
// selection is one contiguous range, so the connector column draws it as a
// single band that reads as one row across the split. InteractionManager
// records each column's top and bottom selected rows, so only those are read.
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

// Where a line's rows start and end. A line inside a collapsed region has no
// row of its own, so it spans the 1px line drawn through the region's row
// center.
function getLineTop(
  line: MountedLine,
  rects: Map<HTMLElement, DOMRect>
): number {
  const rect = getRowRect(line.element, rects);
  return line.collapsed === true
    ? (rect.top + rect.bottom) / 2 - COLLAPSED_LINE_HALF_HEIGHT
    : rect.top;
}

function getLineBottom(
  line: MountedLine,
  rects: Map<HTMLElement, DOMRect>
): number {
  const rect = getRowRect(line.end, rects);
  return line.collapsed === true
    ? (rect.top + rect.bottom) / 2 + COLLAPSED_LINE_HALF_HEIGHT
    : rect.bottom;
}

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
