import type { SelectionSide } from '../types';
import { findRangeAtPoint } from './findRangeAtPoint';

export interface SearchHighlightRange {
  startCharacter: number;
  endCharacter: number;
  current: boolean;
}

interface SearchHighlights {
  match: Highlight;
  current: Highlight;
}

// One painted match: its range, the highlight it was added to, the row it is
// in, and the character it starts at in that row's line.
interface PaintedRange {
  range: Range;
  highlight: Highlight;
  row: HTMLElement;
  startCharacter: number;
}

const highlightsByDocument = new WeakMap<Document, SearchHighlights>();

// The browser's own hit test for highlights. It is missing from the DOM types;
// Chrome 140, Firefox 150 and Safari 27.3 have it.
interface HighlightHitTest {
  highlightsFromPoint(
    x: number,
    y: number,
    options?: { shadowRoots?: ShadowRoot[] }
  ): { highlight: Highlight; ranges: AbstractRange[] }[];
}

function canHitTest(
  registry: HighlightRegistry
): registry is HighlightRegistry & HighlightHitTest {
  return 'highlightsFromPoint' in registry;
}

function isAlreadyRegisteredError(error: unknown): boolean {
  return error instanceof Error && error.name === 'InvalidModificationError';
}

// Paint matches over existing text nodes. Each surface owns its ranges, while
// the document shares two registry entries styled inside every code shadow root.
export class SearchHighlighter {
  static create(document: Document): SearchHighlighter | undefined {
    const view = document.defaultView;
    if (
      view?.CSS?.highlights == null ||
      typeof view.Highlight !== 'function' ||
      typeof view.CSS.registerProperty !== 'function'
    ) {
      return undefined;
    }
    let highlights = highlightsByDocument.get(document);
    if (highlights == null) {
      // Typed colors resolve light-dark() on the code surface before inheriting
      // into highlights, whose color-scheme can otherwise use the page's mode.
      for (const name of [
        '--diffs-search-match-color',
        '--diffs-search-current-color',
        '--diffs-search-text-color',
      ]) {
        try {
          view.CSS.registerProperty({
            name,
            syntax: '<color>',
            inherits: true,
            initialValue: 'transparent',
          });
        } catch (error) {
          // Another copy of this module, or the page, already registered the
          // property for this document; that registration serves the same
          // purpose.
          if (!isAlreadyRegisteredError(error)) {
            throw error;
          }
        }
      }
      highlights = {
        match: new view.Highlight(),
        current: new view.Highlight(),
      };
      highlights.current.priority = 1;
      view.CSS.highlights.set('diffs-search-match', highlights.match);
      view.CSS.highlights.set('diffs-search-current', highlights.current);
      highlightsByDocument.set(document, highlights);
    }
    return new SearchHighlighter(highlights);
  }

  static getLineNumber(row: HTMLElement): number {
    return Number(row.dataset.line);
  }

  // Unchanged rows on the old side of a split diff belong to deletions too.
  static getLineSide(row: HTMLElement): SelectionSide {
    return row.dataset.lineType === 'change-deletion' ||
      row.closest('[data-deletions]') != null
      ? 'deletions'
      : 'additions';
  }

  private ranges: PaintedRange[] = [];
  private readonly markedButtons: HTMLButtonElement[] = [];
  private currentRange: Range | undefined;

  private constructor(private readonly highlights: SearchHighlights) {}

  clear(): void {
    const { ranges, markedButtons } = this;
    for (const button of markedButtons) {
      button.removeAttribute('data-search-match');
    }
    markedButtons.length = 0;
    for (const { range, highlight } of ranges) {
      highlight.delete(range);
    }
    ranges.length = 0;
    this.currentRange = undefined;
  }

  /** The painted range of the current match, while one is mounted. */
  get currentMatchRange(): Range | undefined {
    return this.currentRange;
  }

  // The start character of the painted match under a point in a row, if there
  // is one. The browser says which highlight is at the point; where it cannot,
  // the row's ranges are measured instead.
  getMatchStartAtPoint(
    row: HTMLElement,
    clientX: number,
    clientY: number
  ): number | undefined {
    const { ranges, highlights } = this;
    const registry = row.ownerDocument.defaultView?.CSS.highlights;
    if (registry == null || !canHitTest(registry)) {
      return findRangeAtPoint(ranges, row, clientX, clientY)?.startCharacter;
    }
    const root = row.getRootNode();
    const hits = registry.highlightsFromPoint(clientX, clientY, {
      shadowRoots: root instanceof ShadowRoot ? [root] : [],
    });
    for (const { highlight, ranges: hitRanges } of hits) {
      if (highlight !== highlights.match && highlight !== highlights.current) {
        continue;
      }
      for (const hitRange of hitRanges) {
        const entry = ranges.find(
          (painted) => painted.range === hitRange && painted.row === row
        );
        if (entry != null) {
          return entry.startCharacter;
        }
      }
    }
    return undefined;
  }

  // Look up matches only for mounted rows, including each side of a split
  // diff. Hosts supply line lookups so painting never regroups offscreen hits.
  paint(
    root: ParentNode,
    getMatches: (
      lineNumber: number,
      side: SelectionSide
    ) => readonly SearchHighlightRange[] | undefined
  ): void {
    for (const row of root.querySelectorAll<HTMLElement>(
      '[data-line][data-line-type]'
    )) {
      const lineMatches = getMatches(
        SearchHighlighter.getLineNumber(row),
        SearchHighlighter.getLineSide(row)
      );
      if (lineMatches != null) {
        this.paintLine(row, lineMatches);
      }
    }
  }

  // Ranges can cross syntax-token spans. Character offsets and text-node
  // offsets both use UTF-16, so no token splitting or coordinate conversion is needed.
  private paintLine(
    row: HTMLElement,
    matches: readonly SearchHighlightRange[]
  ): void {
    const { highlights, ranges } = this;
    const document = row.ownerDocument;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let index = 0;
    let range: Range | undefined;
    let node: Node | null;
    while ((node = walker.nextNode()) != null && index < matches.length) {
      const end = offset + (node.textContent?.length ?? 0);
      while (index < matches.length) {
        const match = matches[index];
        if (match.startCharacter >= end) break;
        if (range == null) {
          range = document.createRange();
          range.setStart(node, match.startCharacter - offset);
        }
        if (match.endCharacter > end) break;
        range.setEnd(node, match.endCharacter - offset);
        const highlight = match.current ? highlights.current : highlights.match;
        highlight.add(range);
        ranges.push({
          range,
          highlight,
          row,
          startCharacter: match.startCharacter,
        });
        if (match.current) this.currentRange ??= range;
        range = undefined;
        index++;
      }
      offset = end;
    }
    if (index < matches.length) {
      // A match that does not fit in the row's text is in the hidden part of a
      // cut-off line. Its button stands in for it.
      const button = row.querySelector<HTMLButtonElement>('[data-expand-line]');
      if (button == null) {
        return;
      }
      const { current } = matches[index];
      button.setAttribute('data-search-match', current ? 'current' : '');
      this.markedButtons.push(button);
      if (current) {
        const buttonRange = document.createRange();
        buttonRange.selectNode(button);
        this.currentRange ??= buttonRange;
      }
    }
  }
}
