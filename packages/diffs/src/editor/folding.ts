import type { LineRange } from '../types';
import type { TextDocument } from './textDocument';

const CLOSING_DELIMITER_ONLY = /^[}\])]+[;,]?$/;

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
  textDocument: Pick<TextDocument<unknown>, 'lineCount' | 'getLineText'>,
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
