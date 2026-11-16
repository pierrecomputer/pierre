import type { CodeViewItem, FileDiffMetadata, SelectionSide } from '../types';
import {
  type DiffLineMetadata,
  iterateOverDiff,
} from '../utils/iterateOverDiff';
import type { SearchParams } from './index';
import { compileSearchQuery, matchSearchLine } from './lineSearch';

// Amortize clock reads over enough text that they cost less than line matching.
export const CODE_VIEW_SEARCH_CLOCK_CHECK_CHARACTERS = 65_536;

// How far ahead a walk looks for `\r` in one go.
export const CODE_VIEW_SEARCH_CARRIAGE_RETURN_LOOKAHEAD = 65_536;

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

// Walks one text line by line. Lines are found as they are read, so starting
// on a very large text costs nothing up front.
export class CodeViewSearchTextCursor {
  // Where each line found so far starts.
  private readonly offsets: number[] = [0];
  // Whether the last line found is the last line of the text.
  private ended = false;
  // The next `\n` ahead of the lines read so far. -1 when there is none
  // left, and undefined before it has been looked for.
  private lineFeed: number | undefined;
  // The next `\r` found ahead of the lines read so far, or -1.
  private carriageReturn = -1;
  // Text before this index has been checked for `\r`.
  private checkedTo = 0;
  private nextLine = 0;

  constructor(
    private readonly contents: string,
    private readonly side?: SelectionSide
  ) {}

  // Reads one line without its ending and rejects an index outside the text.
  readLine(lineIndex: number): string {
    const { contents, offsets } = this;
    while (lineIndex >= offsets.length && !this.ended) {
      this.readNewLine();
    }
    const start = offsets[lineIndex];
    if (start == null) {
      throw new Error(
        `CodeViewSearchTextCursor.readLine: line index ${lineIndex} is out of range`
      );
    }
    if (lineIndex === offsets.length - 1 && !this.ended) {
      return this.readNewLine();
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
      // A walk is nearly always at the last line found, so it reads that one
      // directly.
      const text =
        lineIndex === offsets.length - 1 && !this.ended
          ? this.readNewLine()
          : this.readLine(lineIndex);
      if (visitLine(text, side, lineIndex + 1, lineIndex)) {
        return false;
      }
    }
    return true;
  }

  // Reads the last line found so far, and finds where the next one starts.
  // A line ends at `\n`, `\r\n` or a lone `\r`, as in `computeLineOffsets`.
  private readNewLine(): string {
    const { contents, offsets } = this;
    const start = offsets[offsets.length - 1];
    // Looked for again only once the walk has passed the last one found, so
    // no part of the text is searched for `\n` twice.
    let { lineFeed } = this;
    if (lineFeed == null || (lineFeed !== -1 && lineFeed < start)) {
      lineFeed = contents.indexOf('\n', start);
      this.lineFeed = lineFeed;
    }
    const end = lineFeed === -1 ? contents.length : lineFeed;
    const carriageReturn = this.findCarriageReturn(start, end);
    if (carriageReturn === -1) {
      if (lineFeed === -1) this.ended = true;
      else offsets.push(lineFeed + 1);
      return contents.slice(start, end);
    }
    // The `\r` of a `\r\n` pair ends the line with it. Any other `\r` ends
    // the line by itself, and what follows it is the next line.
    offsets.push(
      lineFeed !== -1 && carriageReturn === end - 1
        ? lineFeed + 1
        : carriageReturn + 1
    );
    return contents.slice(start, carriageReturn);
  }

  // The first `\r` from `start` up to `end`, or -1. It looks well ahead of
  // the line in one go, so a text with no `\r` in it is not checked line by
  // line.
  private findCarriageReturn(start: number, end: number): number {
    const { contents, checkedTo } = this;
    if (this.carriageReturn < start && checkedTo < end) {
      const from = Math.max(checkedTo, start);
      const to = Math.min(
        contents.length,
        Math.max(end, from + CODE_VIEW_SEARCH_CARRIAGE_RETURN_LOOKAHEAD)
      );
      const index = contents.slice(from, to).indexOf('\r');
      this.carriageReturn = index === -1 ? -1 : from + index;
      this.checkedTo = index === -1 ? to : from + index + 1;
    }
    const { carriageReturn } = this;
    return carriageReturn >= start && carriageReturn < end
      ? carriageReturn
      : -1;
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
  // Index of this item's first match in the joined results.
  startIndex: number;
  matches: CodeViewSearchMatch[];
  additionLines: CodeViewSearchLineSpan[] | undefined;
  deletionLines: CodeViewSearchLineSpan[] | undefined;
}

// A run of positions. `end` is not included.
export interface CodeViewSearchPositionRange {
  start: number;
  end: number;
}

// Searches ordered items for one query, a slice at a time. An item's matches
// are shown once that item is complete or the match limit is reached.
export class CodeViewSearchScan {
  // Finds where an item's matches belong in a sorted run.
  private static findEntryIndex(
    entries: readonly CodeViewSearchMatchEntry[],
    position: number
  ): number {
    const last = entries.at(-1);
    if (last == null || last.position < position) return entries.length;
    let start = 0;
    let end = entries.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (entries[middle].position < position) start = middle + 1;
      else end = middle;
    }
    return start;
  }

  private readonly pattern: RegExp | undefined;
  private readonly wholeWord: boolean;
  private readonly beforeStart: CodeViewSearchMatchEntry[] = [];
  private readonly afterStart: CodeViewSearchMatchEntry[] = [];
  // Where each partly searched item got to, by position.
  private progress = new Map<number, CodeViewSearchItemProgress>();
  // The positions that are not finished yet, in order.
  private readonly unsearched: CodeViewSearchPositionRange[];
  private matchCount = 0;
  private scannedCharacters = 0;
  private deadline: number | undefined;
  private matches: CodeViewSearchMatch[] | undefined;

  constructor(
    searchParams: SearchParams,
    private itemCount: number,
    private readonly getItem: CodeViewSearchItemProvider,
    private readonly limit: number,
    private startingItemIndex = 0
  ) {
    this.pattern = compileSearchQuery(searchParams);
    this.wholeWord = searchParams.wholeWord;
    this.unsearched = itemCount > 0 ? [{ start: 0, end: itemCount }] : [];
  }

  // Whether the scan holds as many matches as the limit allows.
  get atLimit(): boolean {
    const { matchCount, limit } = this;
    return matchCount >= limit;
  }

  // Whether there is nothing left to search, or the limit stopped the scan.
  get finished(): boolean {
    const { pattern, atLimit, unsearched } = this;
    return pattern == null || atLimit || unsearched.length === 0;
  }

  // Searches an item again after its text changed. What was found in it so
  // far is dropped now, and it goes back among the items still to search.
  rescanItem(position: number): void {
    this.dropItemProgress(position);
    this.dropItemMatches(position);
    this.markUnsearched(position);
  }

  // Adds items at the end of the view to the search.
  addItems(count: number): void {
    const { itemCount, unsearched } = this;
    const last = unsearched.at(-1);
    if (last?.end === itemCount) last.end += count;
    else if (count > 0) {
      unsearched.push({ start: itemCount, end: itemCount + count });
    }
    this.itemCount = itemCount + count;
  }

  // Takes an item out of the search. Every later item moves down one position.
  removeItem(position: number): void {
    this.dropItemMatches(position);
    this.dropItemProgress(position);
    const {
      progress,
      beforeStart,
      afterStart,
      unsearched,
      startingItemIndex,
      itemCount,
    } = this;
    const shiftedProgress = new Map<number, CodeViewSearchItemProgress>();
    for (const [pendingPosition, itemProgress] of progress) {
      const nextPosition =
        pendingPosition > position ? pendingPosition - 1 : pendingPosition;
      itemProgress.position = nextPosition;
      shiftedProgress.set(nextPosition, itemProgress);
    }
    this.progress = shiftedProgress;
    for (const entries of [beforeStart, afterStart]) {
      const first = CodeViewSearchScan.findEntryIndex(entries, position + 1);
      for (let index = first; index < entries.length; index++) {
        entries[index].position--;
      }
    }
    const firstRange = this.findUnsearchedRangeIndex(position);
    for (let index = firstRange; index < unsearched.length; index++) {
      const range = unsearched[index];
      if (range.start > position) range.start--;
      range.end--;
    }
    const range = unsearched[firstRange];
    if (range != null && range.start === range.end)
      unsearched.splice(firstRange, 1);
    if (position < startingItemIndex) {
      this.startingItemIndex = startingItemIndex - 1;
    }
    this.itemCount = itemCount - 1;
  }

  // Works until all items are done, the limit is reached, or the budget runs
  // out. It takes the first unfinished item at or after `from`, wrapping
  // around at the end, and carries on from where that item was left if it was
  // started before.
  // Returns true when there are new matches to show or the scan finished.
  advance(budgetMs?: number, from: number = this.startingItemIndex): boolean {
    const { pattern, progress } = this;
    if (this.finished || pattern == null) return false;
    let changed = false;
    this.deadline = budgetMs == null ? undefined : performance.now() + budgetMs;
    this.scannedCharacters = 0;
    while (!this.finished) {
      const position = this.getNextPosition(from);
      let itemProgress = progress.get(position);
      if (itemProgress == null) {
        if (this.dropItemMatches(position)) changed = true;
        itemProgress = this.prepareItem(pattern, position);
      }
      const { cursor, visitLine } = itemProgress;
      const completed = cursor.walk(visitLine);
      const { atLimit } = this;
      if (completed || atLimit) {
        if (this.recordItemMatches(itemProgress)) changed = true;
        progress.delete(position);
        if (completed) {
          this.markSearched(position);
        }
        // Matches of items set aside count toward the limit but are not
        // shown. They are given back, and those items start over later.
        if (atLimit) {
          let { matchCount } = this;
          for (const pending of progress.values()) {
            matchCount -= pending.matches.length;
          }
          this.matchCount = matchCount;
          progress.clear();
        }
      } else {
        progress.set(position, itemProgress);
        return changed;
      }
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
        entry.startIndex = matches.length;
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
    this.getMatches();
    const entry = this.getEntry(position);
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
    return startIndex + index;
  }

  // The first matched item at or after a position.
  getFirstMatchedEntryAtOrAfter(
    position: number
  ): CodeViewSearchMatchEntry | undefined {
    const { beforeStart, afterStart, startingItemIndex } = this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    const index = CodeViewSearchScan.findEntryIndex(entries, position);
    return (
      entries[index] ??
      (position < startingItemIndex ? afterStart[0] : undefined)
    );
  }

  // Whether any item from `start` up to, not including, `end` is unsearched.
  hasPendingItems(start: number, end: number): boolean {
    const { finished, unsearched } = this;
    const range = unsearched[this.findUnsearchedRangeIndex(start)];
    return !finished && range != null && Math.max(start, range.start) < end;
  }

  // Whether an item is still unsearched.
  isItemPending(position: number): boolean {
    return !this.finished && this.isUnsearched(position);
  }

  getItemMatches(position: number): readonly CodeViewSearchMatch[] | undefined {
    return this.getEntry(position)?.matches;
  }

  // The matching span for one source line.
  getLineMatches(
    position: number,
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): CodeViewSearchLineSpan | undefined {
    const entry = this.getEntry(position);
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
    const entry = this.getEntry(position);
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

  // Whether an item has not been searched to its end yet.
  private isUnsearched(position: number): boolean {
    const range = this.unsearched[this.findUnsearchedRangeIndex(position)];
    return range != null && range.start <= position;
  }

  // Finds the first unsearched range that ends after a position.
  private findUnsearchedRangeIndex(position: number): number {
    const { unsearched } = this;
    let start = 0;
    let end = unsearched.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (unsearched[middle].end <= position) {
        start = middle + 1;
      } else {
        end = middle;
      }
    }
    return start;
  }

  // The first unfinished position at or after `from`, else the first of all.
  private getNextPosition(from: number): number {
    const { unsearched } = this;
    const index = this.findUnsearchedRangeIndex(from);
    return index < unsearched.length
      ? Math.max(unsearched[index].start, from)
      : unsearched[0].start;
  }

  // Puts a position back among the ones still to search.
  private markUnsearched(position: number): void {
    const { unsearched } = this;
    const index = this.findUnsearchedRangeIndex(position);
    const next = unsearched[index];
    if (next != null && next.start <= position) {
      return;
    }
    const previous = unsearched[index - 1];
    if (previous != null && previous.end === position) {
      previous.end++;
      if (next != null && next.start === previous.end) {
        previous.end = next.end;
        unsearched.splice(index, 1);
      }
    } else if (next != null && next.start === position + 1) {
      next.start--;
    } else {
      unsearched.splice(index, 0, { start: position, end: position + 1 });
    }
  }

  // Takes a finished position out of the unsearched ranges.
  private markSearched(position: number): void {
    const { unsearched } = this;
    const index = this.findUnsearchedRangeIndex(position);
    const range = unsearched[index];
    if (position === range.start) {
      range.start++;
      if (range.start === range.end) {
        unsearched.splice(index, 1);
      }
    } else if (position + 1 === range.end) {
      range.end--;
    } else {
      unsearched.splice(
        index,
        1,
        { start: range.start, end: position },
        { start: position + 1, end: range.end }
      );
    }
  }

  // Throws away what a partly searched item has found so far.
  private dropItemProgress(position: number): void {
    const { progress, matchCount } = this;
    const itemProgress = progress.get(position);
    if (itemProgress != null) {
      this.matchCount = matchCount - itemProgress.matches.length;
      progress.delete(position);
    }
  }

  // Finds an item's completed matches.
  private getEntry(position: number): CodeViewSearchMatchEntry | undefined {
    const { beforeStart, afterStart, startingItemIndex } = this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    const entry = entries[CodeViewSearchScan.findEntryIndex(entries, position)];
    return entry?.position === position ? entry : undefined;
  }

  // Drops an item's matches from the results and the count. Returns whether
  // it had any.
  private dropItemMatches(position: number): boolean {
    const { beforeStart, afterStart, startingItemIndex, matchCount } = this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    const index = CodeViewSearchScan.findEntryIndex(entries, position);
    const entry = entries[index];
    if (entry?.position !== position) return false;
    this.matchCount = matchCount - entry.matches.length;
    entries.splice(index, 1);
    this.matches = undefined;
    return true;
  }

  // Inserts a completed item's nonempty matches into item order.
  private recordItemMatches(progress: CodeViewSearchItemProgress): boolean {
    const { position, matches, additionLines, deletionLines } = progress;
    if (matches.length === 0) {
      return false;
    }
    const { beforeStart, afterStart, startingItemIndex } = this;
    const entries = position < startingItemIndex ? beforeStart : afterStart;
    const index = CodeViewSearchScan.findEntryIndex(entries, position);
    entries.splice(index, 0, {
      position,
      startIndex: 0,
      matches,
      additionLines,
      deletionLines,
    });
    this.matches = undefined;
    return true;
  }

  // Starts on an item: reads its text and sets up the walk over its lines.
  private prepareItem(
    pattern: RegExp,
    position: number
  ): CodeViewSearchItemProgress {
    const { getItem, wholeWord, limit } = this;
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
