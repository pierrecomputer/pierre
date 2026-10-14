import type { Connector, SideBounds } from '../components/SemanticConnector';
import type { SelectedRowEdges } from '../managers/InteractionManager';
import type { SemanticDiffConnectorAttachment } from '../types';
import type {
  SemanticDiffConnector,
  SemanticDiffConnectorRange,
} from './semanticDiffConnectors';

interface MountedLine {
  element: HTMLElement;
  run: number;
  /**
   * May be an annotation line that's attached to the row above or a no-newline
   * row
   */
  end: HTMLElement;
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
  const connectors: Connector[] = [];
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
  const firstRect = getRowRect(first.element, rects);
  const lastRect = getRowRect(last.end, rects);
  return {
    top: firstRect.top - originTop,
    bottom: lastRect.bottom - originTop,
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
        ? getRowRect(line.element, rects).top
        : getRowRect(line.end, rects).bottom) - originTop;
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
