import type { SelectionSide } from '../types';

export interface SearchHighlightRange {
  side: SelectionSide | undefined;
  lineNumber: number;
  startCharacter: number;
  endCharacter: number;
  current: boolean;
}

interface SearchHighlights {
  match: Highlight;
  current: Highlight;
}

const highlightsByDocument = new WeakMap<Document, SearchHighlights>();

// Paint matches over existing text nodes. Each surface owns its ranges, while
// the document shares two registry entries styled inside every code shadow root.
export class SearchHighlighter {
  private ranges: { range: Range; highlight: Highlight }[] = [];
  private currentRange: Range | undefined;

  private constructor(private readonly highlights: SearchHighlights) {}

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
        view.CSS.registerProperty({
          name,
          syntax: '<color>',
          inherits: true,
          initialValue: 'transparent',
        });
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

  clear(): void {
    for (const { range, highlight } of this.ranges) {
      highlight.delete(range);
    }
    this.ranges.length = 0;
    this.currentRange = undefined;
  }

  // Reveal the current match horizontally inside its code column. Instant
  // scrolling overrides scroll-behavior without moving the vertical viewport.
  revealCurrentMatch(): boolean {
    const range = this.currentRange;
    const code =
      range?.startContainer.parentElement?.closest<HTMLElement>('[data-code]');
    if (range == null || code == null || code.clientWidth === 0) return false;
    if (code.scrollWidth <= code.clientWidth) return true;
    const rect = range.getBoundingClientRect();
    const viewport = code.getBoundingClientRect();
    const gutter = code.querySelector<HTMLElement>(':scope > [data-gutter]');
    const left = Math.max(
      viewport.left + code.clientLeft,
      gutter?.getBoundingClientRect().right ?? viewport.left
    );
    const right = viewport.left + code.clientLeft + code.clientWidth;
    const delta =
      rect.left < left || rect.width > right - left
        ? rect.left - left
        : Math.max(0, rect.right - right);
    code.scrollTo({ left: code.scrollLeft + delta, behavior: 'instant' });
    return true;
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
      const side =
        row.dataset.lineType === 'change-deletion' ||
        row.closest('[data-deletions]') != null
          ? 'deletions'
          : 'additions';
      const lineMatches = getMatches(Number(row.dataset.line), side);
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
        const highlight = match.current
          ? this.highlights.current
          : this.highlights.match;
        highlight.add(range);
        this.ranges.push({ range, highlight });
        if (match.current) this.currentRange ??= range;
        range = undefined;
        index++;
      }
      offset = end;
    }
  }
}
