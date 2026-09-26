import type { LineRange } from '../types';

const CLOSING_DELIMITER_ONLY = /^[}\])]+[;,]?$/;

/**
 * The minimal line access folding needs; structurally satisfied by the
 * editor's TextDocument and by adapters over a split-line cache.
 */
export interface FoldableLineSource {
  lineCount: number;
  getLineText(lineNumber: number): string;
}

/**
 * Stores hidden ranges as numeric arrays with prefix counts so visibility and
 * document-to-visible-line mappings do not scan every folded range.
 */
export class LineRangeIndex {
  readonly #starts: number[] = [];
  readonly #ends: number[] = [];
  readonly #prefixHiddenCounts: number[] = [0];
  readonly #visibleStarts: number[] = [];

  constructor(ranges: readonly LineRange[] = []) {
    let previousStart = -Infinity;
    let rangesAreOrdered = true;

    for (const range of ranges) {
      if (range.startLine < 0 || range.endLine < range.startLine) {
        continue;
      }
      if (range.startLine < previousStart) {
        rangesAreOrdered = false;
        break;
      }

      previousStart = range.startLine;
      this.#appendRange(range.startLine, range.endLine);
    }

    if (rangesAreOrdered) {
      return;
    }

    this.#starts.length = 0;
    this.#ends.length = 0;
    this.#prefixHiddenCounts.length = 1;
    this.#visibleStarts.length = 0;

    const sortedRanges = ranges
      .filter(
        (range) => range.startLine >= 0 && range.endLine >= range.startLine
      )
      .sort((left, right) => {
        const startDifference = left.startLine - right.startLine;
        return startDifference === 0
          ? right.endLine - left.endLine
          : startDifference;
      });

    for (const range of sortedRanges) {
      this.#appendRange(range.startLine, range.endLine);
    }
  }

  #appendRange(startLine: number, endLine: number): void {
    const previousIndex = this.#ends.length - 1;
    if (previousIndex >= 0 && startLine <= this.#ends[previousIndex] + 1) {
      const previousEnd = this.#ends[previousIndex];
      if (endLine > previousEnd) {
        this.#ends[previousIndex] = endLine;
        this.#prefixHiddenCounts[previousIndex + 1] += endLine - previousEnd;
      }
      return;
    }

    const hiddenBefore =
      this.#prefixHiddenCounts[this.#prefixHiddenCounts.length - 1];
    this.#starts.push(startLine);
    this.#ends.push(endLine);
    this.#visibleStarts.push(startLine - hiddenBefore);
    this.#prefixHiddenCounts.push(hiddenBefore + endLine - startLine + 1);
  }

  #containingRangeIndex(line: number): number {
    const index = upperBound(this.#starts, line) - 1;
    return index >= 0 && line <= this.#ends[index] ? index : -1;
  }

  isHidden(line: number): boolean {
    return this.#containingRangeIndex(line) >= 0;
  }

  containingRange(line: number): LineRange | undefined {
    const index = this.#containingRangeIndex(line);
    if (index < 0) {
      return undefined;
    }
    return {
      startLine: this.#starts[index],
      endLine: this.#ends[index],
    };
  }

  lineAfterHiddenRange(line: number): number | undefined {
    const index = this.#containingRangeIndex(line);
    return index < 0 ? undefined : this.#ends[index] + 1;
  }

  hiddenCountBefore(lineExclusive: number): number {
    const index = upperBound(this.#starts, lineExclusive - 1) - 1;
    if (index < 0) {
      return 0;
    }

    const hiddenBefore = this.#prefixHiddenCounts[index];
    return (
      hiddenBefore +
      Math.min(
        this.#ends[index] - this.#starts[index] + 1,
        lineExclusive - this.#starts[index]
      )
    );
  }

  visibleLineCount(total: number): number {
    const normalizedTotal = Math.max(0, Math.trunc(total));
    return normalizedTotal - this.hiddenCountBefore(normalizedTotal);
  }

  lineAtVisibleIndex(index: number, total: number): number | undefined {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.visibleLineCount(total)
    ) {
      return undefined;
    }

    const precedingRangeCount = upperBound(this.#visibleStarts, index);
    return index + this.#prefixHiddenCounts[precedingRangeCount];
  }

  nearestVisibleLine(
    line: number,
    direction: 'up' | 'down',
    total: number
  ): number | undefined {
    const normalizedTotal = Math.max(0, Math.trunc(total));
    if (normalizedTotal === 0) {
      return undefined;
    }

    let candidate = Math.trunc(line);
    if (direction === 'down') {
      if (candidate < 0) {
        candidate = 0;
      } else if (candidate >= normalizedTotal) {
        return undefined;
      }
    } else if (candidate >= normalizedTotal) {
      candidate = normalizedTotal - 1;
    } else if (candidate < 0) {
      return undefined;
    }

    const rangeIndex = this.#containingRangeIndex(candidate);
    if (rangeIndex < 0) {
      return candidate;
    }

    const nearest =
      direction === 'down'
        ? this.#ends[rangeIndex] + 1
        : this.#starts[rangeIndex] - 1;
    return nearest >= 0 && nearest < normalizedTotal ? nearest : undefined;
  }
}

export function isFoldingClosingDelimiter(text: string): boolean {
  return CLOSING_DELIMITER_ONLY.test(text.trim());
}

/**
 * Finds indentation folds by comparing adjacent nonblank lines. Blank lines
 * inside a block are included, while blank lines after its last content line
 * and standalone closing delimiters are left visible.
 */
export function computeIndentFoldingRanges(
  textDocument: FoldableLineSource,
  tabSize = 2
): LineRange[] {
  const integerTabSize = Math.trunc(tabSize);
  const normalizedTabSize =
    Number.isFinite(integerTabSize) && integerTabSize > 0 ? integerTabSize : 2;
  const ranges: Array<{ startLine: number; endLine: number }> = [];
  const openRanges: Array<{
    indent: number;
    range: { startLine: number; endLine: number };
  }> = [];
  let previousLine = -1;
  let previousIndent = 0;

  for (let line = 0; line < textDocument.lineCount; line++) {
    const text = textDocument.getLineText(line);
    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      continue;
    }

    let indent = 0;
    for (const character of text) {
      if (character === ' ') {
        indent++;
      } else if (character === '\t') {
        indent += normalizedTabSize - (indent % normalizedTabSize);
      } else {
        break;
      }
    }

    if (previousLine >= 0) {
      while (openRanges.length > 0) {
        const openRange = openRanges[openRanges.length - 1];
        if (openRange.indent < indent) {
          break;
        }

        openRanges.pop();
        openRange.range.endLine =
          openRange.indent === indent &&
          CLOSING_DELIMITER_ONLY.test(trimmedText)
            ? line - 1
            : previousLine;
      }

      if (indent > previousIndent) {
        const range = {
          startLine: previousLine,
          endLine: line,
        };
        ranges.push(range);
        openRanges.push({ indent: previousIndent, range });
      }
    }

    previousLine = line;
    previousIndent = indent;
  }

  if (previousLine >= 0) {
    for (const openRange of openRanges) {
      openRange.range.endLine = previousLine;
    }
  }

  return ranges;
}

/**
 * Converts folded headers to their hidden bodies and coalesces overlapping or
 * adjacent bodies into ranges suitable for visibility queries.
 */
export function mergeHiddenLineRanges(
  foldRanges: readonly LineRange[],
  foldedStartLines: ReadonlySet<number>
): LineRange[] {
  const merged: Array<{ startLine: number; endLine: number }> = [];

  for (const foldRange of foldRanges) {
    if (
      !foldedStartLines.has(foldRange.startLine) ||
      foldRange.endLine <= foldRange.startLine
    ) {
      continue;
    }

    const startLine = foldRange.startLine + 1;
    const previous = merged[merged.length - 1];
    if (previous != null && startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, foldRange.endLine);
    } else {
      merged.push({ startLine, endLine: foldRange.endLine });
    }
  }

  return merged;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (values[middle] <= target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

// Indentation fold candidates derived from a split-line cache, keyed by the
// lines array identity so edits and file swaps invalidate the cache naturally.
interface FoldableRangeCache {
  lines: readonly string[];
  ranges: LineRange[];
  rangesByStart: Map<number, LineRange>;
}

export interface FoldManagerCallbacks {
  /**
   * Whether fold interception is currently active. Read-only File components
   * return false while an editor session owns folding or the `folding`
   * option is off.
   */
  isEnabled(): boolean;
  /**
   * A fold toggle or folded-block ellipsis was activated for the zero-based
   * header line. `restoreFocus` is true for keyboard activations, asking the
   * host to move focus back to the re-rendered toggle.
   */
  onToggleFold(startLine: number, restoreFocus: boolean): void;
}

/**
 * Owns interactive code-fold state for read-only file components: the
 * indentation fold candidates for the current contents, which fold headers
 * the user has collapsed, and the capture-phase listeners that intercept
 * clicks on rendered fold controls before line-selection handlers see them.
 * An attached editor bypasses this manager entirely and drives fold state
 * through its own document.
 */
export class FoldManager {
  private foldedStarts = new Set<number>();
  private cache: FoldableRangeCache | undefined;
  private pre: HTMLElement | undefined;

  constructor(private callbacks?: FoldManagerCallbacks) {}

  get foldedStartLines(): ReadonlySet<number> {
    return this.foldedStarts;
  }

  isFolded(startLine: number): boolean {
    return this.foldedStarts.has(startLine);
  }

  hasFolds(): boolean {
    return this.foldedStarts.size > 0;
  }

  /** Indentation fold candidates for `lines`, cached per lines identity. */
  getFoldableRanges(lines: readonly string[]): LineRange[] {
    return this.getRangeCache(lines).ranges;
  }

  /** Fold candidates for `lines` keyed by their zero-based header line. */
  getFoldableRangesByStart(lines: readonly string[]): Map<number, LineRange> {
    return this.getRangeCache(lines).rangesByStart;
  }

  private getRangeCache(lines: readonly string[]): FoldableRangeCache {
    if (this.cache?.lines !== lines) {
      const ranges = computeIndentFoldingRanges({
        lineCount: lines.length,
        getLineText: (line) => lines[line] ?? '',
      });
      this.cache = {
        lines,
        ranges,
        rangesByStart: new Map(ranges.map((range) => [range.startLine, range])),
      };
    }
    return this.cache;
  }

  /** Toggle a fold header; returns false when the line is not foldable. */
  toggleFold(startLine: number, lines: readonly string[]): boolean {
    if (!this.getFoldableRangesByStart(lines).has(startLine)) {
      return false;
    }
    if (!this.foldedStarts.delete(startLine)) {
      this.foldedStarts.add(startLine);
    }
    return true;
  }

  /**
   * Hidden line ranges derived from the collapsed folds, after dropping folds
   * whose header is no longer foldable in the current contents.
   */
  getHiddenLineRanges(lines: readonly string[]): LineRange[] {
    if (this.foldedStarts.size === 0) {
      return [];
    }
    const { ranges, rangesByStart } = this.getRangeCache(lines);
    for (const startLine of this.foldedStarts) {
      if (!rangesByStart.has(startLine)) {
        this.foldedStarts.delete(startLine);
      }
    }
    return mergeHiddenLineRanges(ranges, this.foldedStarts);
  }

  /** Clear all collapsed folds; returns whether anything was folded. */
  reset(): boolean {
    if (this.foldedStarts.size === 0) {
      return false;
    }
    this.foldedStarts.clear();
    return true;
  }

  /**
   * Listen for fold-control activation on the rendered code. Capture phase so
   * a handled toggle press never reaches the line-selection listeners the
   * InteractionManager attaches to the same element.
   */
  setup(pre: HTMLElement): void {
    if (this.pre === pre) {
      return;
    }
    this.cleanUp();
    this.pre = pre;
    pre.addEventListener('click', this.handleClick, true);
    pre.addEventListener('pointerdown', this.handlePointerDown, true);
  }

  /** Detach listeners. Fold state is kept; use reset() to clear it. */
  cleanUp(): void {
    this.pre?.removeEventListener('click', this.handleClick, true);
    this.pre?.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.pre = undefined;
  }

  private handlePointerDown = (event: Event): void => {
    if (
      this.callbacks?.isEnabled() !== true ||
      foldButtonFromEvent(event) == null
    ) {
      return;
    }
    // Match editor fold buttons: no focus-on-press and no selection drag.
    event.preventDefault();
    event.stopPropagation();
  };

  private handleClick = (event: Event): void => {
    const callbacks = this.callbacks;
    if (callbacks?.isEnabled() !== true) {
      return;
    }
    const button = foldButtonFromEvent(event);
    if (button == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const lineIndex = Number(
      button.closest<HTMLElement>('[data-line-index]')?.dataset.lineIndex
    );
    if (Number.isInteger(lineIndex)) {
      const restoreFocus = event instanceof MouseEvent && event.detail === 0;
      callbacks.onToggleFold(lineIndex, restoreFocus);
    }
  };
}

function foldButtonFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest<HTMLElement>(
    '[data-fold-toggle], [data-fold-ellipsis]'
  );
}
