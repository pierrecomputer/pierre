import type { CodeViewItem, FileDiffMetadata, SelectionSide } from '../types';
import { computeLineOffsets } from '../utils/computeFileOffsets';
import {
  type DiffLineMetadata,
  iterateOverDiff,
} from '../utils/iterateOverDiff';
import type { SearchParams } from './index';
import { compileSearchQuery, matchSearchLine } from './lineSearch';

// Amortize clock reads over enough text that they cost less than line matching.
export const CODE_VIEW_SEARCH_CLOCK_CHECK_CHARACTERS = 65_536;

export interface CodeViewSearchLineMetadata {
  itemId: string;
  itemType: CodeViewItem<unknown>['type'];
  side: SelectionSide | undefined;
  lineNumber: number;
  lineIndex: number;
}

export interface CodeViewSearchMatch extends CodeViewSearchLineMetadata {
  startCharacter: number;
  endCharacter: number;
}

export interface CodeViewSearchFile {
  type: 'file';
  itemId: string;
  contents: string;
}

export interface CodeViewSearchDiff {
  type: 'diff';
  itemId: string;
  fileDiff: FileDiffMetadata;
  additionContents?: string;
  diffStyle: 'split' | 'unified';
  additionsOnly: boolean;
}

export type CodeViewSearchItem = CodeViewSearchFile | CodeViewSearchDiff;

export type CodeViewSearchItemProvider = (
  position: number
) => CodeViewSearchItem;

export type CodeViewSearchLineVisitor = (
  text: string,
  side: SelectionSide | undefined,
  lineNumber: number,
  lineIndex: number
) => boolean;

// Retains text and its line offsets while walking one item's source lines.
export class CodeViewSearchTextCursor {
  private readonly offsets: number[];
  private nextLine = 0;

  constructor(
    private readonly contents: string,
    private readonly side?: SelectionSide
  ) {
    this.offsets = computeLineOffsets(contents);
  }

  // Reads one line without its ending and rejects an index outside the text.
  readLine(lineIndex: number): string {
    const { contents, offsets } = this;
    const start = offsets[lineIndex];
    if (start == null) {
      throw new Error(
        `CodeViewSearchTextCursor.readLine: line index ${lineIndex} is out of range`
      );
    }
    let end = offsets[lineIndex + 1] ?? contents.length;
    while (end > start) {
      const charCode = contents.charCodeAt(end - 1);
      if (charCode !== 10 && charCode !== 13) break;
      end--;
    }
    return contents.slice(start, end);
  }

  // Returns true only after reaching the end. A visitor returning true stops
  // and returns false, even on the last line; the next call resumes after it.
  walk(visitLine: CodeViewSearchLineVisitor): boolean {
    const { offsets, side } = this;
    while (this.nextLine < offsets.length) {
      const lineIndex = this.nextLine++;
      if (visitLine(this.readLine(lineIndex), side, lineIndex + 1, lineIndex)) {
        return false;
      }
    }
    return true;
  }
}

// Retains the next diff row and side so a walk can stop between split columns.
export class CodeViewSearchDiffCursor {
  private readonly diff: FileDiffMetadata;
  private readonly additions: CodeViewSearchTextCursor | undefined;
  private readonly diffStyle: 'split' | 'unified';
  private readonly additionsOnly: boolean;
  private nextRow = 0;
  private nextSide: SelectionSide = 'deletions';

  constructor(item: CodeViewSearchDiff) {
    const { fileDiff, additionContents, diffStyle, additionsOnly } = item;
    this.diff = fileDiff;
    this.additions =
      additionContents != null
        ? new CodeViewSearchTextCursor(additionContents, 'additions')
        : undefined;
    this.diffStyle = diffStyle;
    this.additionsOnly = additionsOnly;
  }

  // Returns true only after reaching the end. A visitor returning true stops
  // and returns false, even on the last line; the next call resumes after it.
  walk(visitLine: CodeViewSearchLineVisitor): boolean {
    const { diff, additions, diffStyle, additionsOnly } = this;
    let completed = true;
    const visitSide = (
      side: SelectionSide,
      line: DiffLineMetadata | undefined
    ): boolean => {
      if (line == null) return false;
      const { lineIndex, lineNumber } = line;
      if (side === 'additions' && additions != null) {
        return visitLine(
          additions.readLine(lineIndex),
          side,
          lineNumber,
          lineIndex
        );
      }
      const text = (
        side === 'additions' ? diff.additionLines : diff.deletionLines
      )[lineIndex];
      return text != null
        ? visitLine(trimLineEnding(text), side, lineNumber, lineIndex)
        : false;
    };
    iterateOverDiff({
      diff,
      diffStyle,
      expandedHunks: true,
      startingLine: this.nextRow,
      callback: ({ additionLine, deletionLine }) => {
        let stopped: boolean;
        if (additionsOnly || diffStyle === 'unified') {
          this.nextRow++;
          stopped =
            additionsOnly ||
            (additionLine != null &&
              diff.additionLines[additionLine.lineIndex] != null)
              ? visitSide('additions', additionLine)
              : visitSide('deletions', deletionLine);
        } else {
          if (this.nextSide === 'deletions') {
            this.nextSide = 'additions';
            if (visitSide('deletions', deletionLine)) {
              completed = false;
              return true;
            }
          }
          this.nextSide = 'deletions';
          this.nextRow++;
          stopped = visitSide('additions', additionLine);
        }
        if (stopped) {
          completed = false;
          return true;
        }
        return false;
      },
    });
    return completed;
  }
}

export interface CodeViewSearchLineSpan {
  lineNumber: number;
  startIndex: number;
  endIndex: number;
}

export interface CodeViewSearchItemProgress {
  position: number;
  cursor: CodeViewSearchTextCursor | CodeViewSearchDiffCursor;
  matches: CodeViewSearchMatch[];
  additionLines: CodeViewSearchLineSpan[] | undefined;
  deletionLines: CodeViewSearchLineSpan[] | undefined;
  visitLine: CodeViewSearchLineVisitor;
}

export interface CodeViewSearchMatchEntry {
  position: number;
  // Index of this item's first match within its run.
  startIndex: number;
  matches: CodeViewSearchMatch[];
  additionLines: CodeViewSearchLineSpan[] | undefined;
  deletionLines: CodeViewSearchLineSpan[] | undefined;
}

// Searches ordered items for one query and keeps each item's matches private
// until that item is complete or the match limit is reached.
export class CodeViewSearchScan {
  private readonly pattern: RegExp | undefined;
  private readonly wholeWord: boolean;
  private readonly beforeStart: CodeViewSearchMatchEntry[] = [];
  private readonly afterStart: CodeViewSearchMatchEntry[] = [];
  private readonly entriesByPosition = new Map<
    number,
    CodeViewSearchMatchEntry
  >();
  private current: CodeViewSearchItemProgress | undefined;
  private nextItem = 0;
  private matchCount = 0;
  private scannedCharacters = 0;
  private deadline: number | undefined;
  private matches: CodeViewSearchMatch[] | undefined;

  constructor(
    searchParams: SearchParams,
    private readonly itemCount: number,
    private readonly getItem: CodeViewSearchItemProvider,
    private readonly limit: number,
    private readonly startingItemIndex = 0
  ) {
    this.pattern = compileSearchQuery(searchParams);
    this.wholeWord = searchParams.wholeWord;
  }

  get finished(): boolean {
    const { pattern, matchCount, limit, current, nextItem, itemCount } = this;
    return (
      pattern == null ||
      matchCount >= limit ||
      (current == null && nextItem >= itemCount)
    );
  }

  // Works until all items are done, the limit is reached, or the budget runs out.
  // Returns true when there are new matches to show or the scan finished.
  // The next call carries on from the next unsearched line of the current item.
  advance(budgetMs?: number): boolean {
    const { pattern } = this;
    if (this.finished || pattern == null) return false;
    let changed = false;
    this.deadline = budgetMs == null ? undefined : performance.now() + budgetMs;
    this.scannedCharacters = 0;
    while (!this.finished) {
      const progress = this.current ?? this.prepareItem(pattern);
      const { cursor, visitLine } = progress;
      const completed = cursor.walk(visitLine);
      if (completed || this.matchCount >= this.limit) {
        if (this.recordItemMatches(progress)) changed = true;
        this.current = undefined;
      }
      if (!completed) return changed || this.finished;
    }
    return true;
  }

  // The matches found so far in item order.
  getMatches(): CodeViewSearchMatch[] {
    const { beforeStart, afterStart, matches: cachedMatches } = this;
    if (cachedMatches != null) return cachedMatches;
    const matches: CodeViewSearchMatch[] = [];
    for (const entries of [beforeStart, afterStart]) {
      for (const entry of entries) {
        for (const match of entry.matches) matches.push(match);
      }
    }
    this.matches = matches;
    return matches;
  }

  // A match's index in the joined list.
  getMatchIndex(
    position: number,
    match: CodeViewSearchMatch
  ): number | undefined {
    const { entriesByPosition, beforeStart, startingItemIndex } = this;
    const entry = entriesByPosition.get(position);
    if (entry == null) return undefined;
    const { matches, startIndex } = entry;
    const index = this.findItemMatchIndex(
      entry,
      match.lineNumber,
      match.startCharacter,
      match.side ?? 'additions'
    );
    if (index == null || !areCodeViewSearchMatchesEqual(matches[index], match))
      return undefined;
    const lastBefore = beforeStart.at(-1);
    const precedingCount =
      position >= startingItemIndex && lastBefore != null
        ? lastBefore.startIndex + lastBefore.matches.length
        : 0;
    return precedingCount + startIndex + index;
  }

  // The first matched item at or after a position.
  getFirstMatchedEntryAtOrAfter(
    position: number
  ): CodeViewSearchMatchEntry | undefined {
    const { beforeStart, afterStart, startingItemIndex } = this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    let start = 0;
    let end = entries.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (entries[middle].position < position) start = middle + 1;
      else end = middle;
    }
    return (
      entries[start] ??
      (position < startingItemIndex ? afterStart[0] : undefined)
    );
  }

  // Whether any item from `start` up to, not including, `end` is unsearched.
  hasPendingItems(start: number, end: number): boolean {
    if (this.finished) return false;
    const { nextItem, current, startingItemIndex, itemCount } = this;
    const completedCount = nextItem - (current != null ? 1 : 0);
    const afterPosition = startingItemIndex + completedCount;
    if (afterPosition < itemCount) {
      return (
        Math.max(start, afterPosition) < Math.min(end, itemCount) ||
        Math.max(start, 0) < Math.min(end, startingItemIndex)
      );
    }
    return (
      Math.max(start, afterPosition - itemCount) <
      Math.min(end, startingItemIndex)
    );
  }

  // Whether an item is still unsearched.
  isItemPending(position: number): boolean {
    return this.hasPendingItems(position, position + 1);
  }

  getItemMatches(position: number): readonly CodeViewSearchMatch[] | undefined {
    const { entriesByPosition } = this;
    return entriesByPosition.get(position)?.matches;
  }

  // The matching span for one source line.
  getLineMatches(
    position: number,
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): CodeViewSearchLineSpan | undefined {
    const { entriesByPosition } = this;
    const entry = entriesByPosition.get(position);
    const lines =
      side === 'deletions' ? entry?.deletionLines : entry?.additionLines;
    if (lines == null) return undefined;
    const line = lines[this.findLineIndex(lines, lineNumber)];
    return line?.lineNumber === lineNumber ? line : undefined;
  }

  // The first match at or after a source line and character.
  getFirstMatchAtOrAfter(
    position: number,
    lineNumber: number,
    character: number,
    side: SelectionSide = 'additions'
  ): CodeViewSearchMatch | undefined {
    const { entriesByPosition } = this;
    const entry = entriesByPosition.get(position);
    if (entry == null) return undefined;
    const index = this.findItemMatchIndex(entry, lineNumber, character, side);
    return index != null ? entry.matches[index] : undefined;
  }

  // The first matching line at or after a source line number.
  private findLineIndex(
    lines: readonly CodeViewSearchLineSpan[],
    lineNumber: number
  ): number {
    let start = 0;
    let end = lines.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (lines[middle].lineNumber < lineNumber) start = middle + 1;
      else end = middle;
    }
    return start;
  }

  // The first item-local match index at or after a source position.
  private findItemMatchIndex(
    entry: CodeViewSearchMatchEntry,
    lineNumber: number,
    character: number,
    side: SelectionSide
  ): number | undefined {
    const { matches, additionLines, deletionLines } = entry;
    const lines = side === 'deletions' ? deletionLines : additionLines;
    if (lines == null) return undefined;
    const lineIndex = this.findLineIndex(lines, lineNumber);
    const line = lines[lineIndex];
    if (line == null) return undefined;
    if (line.lineNumber > lineNumber) return line.startIndex;
    let start = line.startIndex;
    let end = line.endIndex;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (matches[middle].startCharacter < character) start = middle + 1;
      else end = middle;
    }
    return start < line.endIndex ? start : lines[lineIndex + 1]?.startIndex;
  }

  // Adds a completed item's nonempty matches to its run.
  private recordItemMatches(progress: CodeViewSearchItemProgress): boolean {
    const { position, matches, additionLines, deletionLines } = progress;
    if (matches.length === 0) return false;
    const { beforeStart, afterStart, startingItemIndex, entriesByPosition } =
      this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    const previous = entries.at(-1);
    const entry = {
      position,
      startIndex:
        previous != null ? previous.startIndex + previous.matches.length : 0,
      matches,
      additionLines,
      deletionLines,
    };
    entries.push(entry);
    entriesByPosition.set(position, entry);
    this.matches = undefined;
    return true;
  }

  // Prepares source offsets once for the next item supplied by CodeView.
  private prepareItem(pattern: RegExp): CodeViewSearchItemProgress {
    const { getItem, itemCount, wholeWord, limit, startingItemIndex } = this;
    const position = (this.nextItem++ + startingItemIndex) % itemCount;
    const item = getItem(position);
    const { type, itemId } = item;
    const cursor =
      type === 'file'
        ? new CodeViewSearchTextCursor(item.contents)
        : item.additionContents != null && item.additionsOnly
          ? new CodeViewSearchTextCursor(item.additionContents, 'additions')
          : new CodeViewSearchDiffCursor(item);
    const matches: CodeViewSearchMatch[] = [];
    let side: SelectionSide | undefined;
    let lineNumber = 0;
    let lineIndex = 0;
    const visitMatch = (
      startCharacter: number,
      endCharacter: number
    ): boolean => {
      matches.push({
        itemId,
        itemType: type,
        side,
        lineNumber,
        lineIndex,
        startCharacter,
        endCharacter,
      });
      return ++this.matchCount >= limit;
    };
    const visitLine: CodeViewSearchLineVisitor = (
      text,
      nextSide,
      nextLineNumber,
      nextLineIndex
    ) => {
      side = nextSide;
      lineNumber = nextLineNumber;
      lineIndex = nextLineIndex;
      const startIndex = matches.length;
      const capped = matchSearchLine(pattern, text, wholeWord, visitMatch);
      if (matches.length > startIndex) {
        const lines =
          nextSide === 'deletions'
            ? (progress.deletionLines ??= [])
            : (progress.additionLines ??= []);
        lines.push({
          lineNumber: nextLineNumber,
          startIndex,
          endIndex: matches.length,
        });
      }
      const { deadline } = this;
      if (deadline == null) return capped;
      this.scannedCharacters += text.length + 1;
      if (this.scannedCharacters < CODE_VIEW_SEARCH_CLOCK_CHECK_CHARACTERS)
        return capped;
      this.scannedCharacters = 0;
      return capped || performance.now() >= deadline;
    };
    const progress: CodeViewSearchItemProgress = {
      position,
      cursor,
      matches,
      additionLines: undefined,
      deletionLines: undefined,
      visitLine,
    };
    this.current = progress;
    return progress;
  }
}

// Removes source line endings before matching line-relative coordinates.
function trimLineEnding(text: string): string {
  let end = text.length;
  while (end > 0) {
    const charCode = text.charCodeAt(end - 1);
    if (charCode !== 10 && charCode !== 13) {
      break;
    }
    end--;
  }
  return end === text.length ? text : text.slice(0, end);
}

export function areCodeViewSearchMatchesEqual(
  a: CodeViewSearchMatch,
  b: CodeViewSearchMatch
): boolean {
  return (
    a.itemId === b.itemId &&
    a.itemType === b.itemType &&
    a.side === b.side &&
    a.lineNumber === b.lineNumber &&
    a.lineIndex === b.lineIndex &&
    a.startCharacter === b.startCharacter &&
    a.endCharacter === b.endCharacter
  );
}

export function areOptionalCodeViewSearchMatchesEqual(
  a: CodeViewSearchMatch | undefined,
  b: CodeViewSearchMatch | undefined
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return areCodeViewSearchMatchesEqual(a, b);
}
