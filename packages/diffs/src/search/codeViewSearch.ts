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
  // Index of this item's first match in the joined results.
  startIndex: number;
  matches: CodeViewSearchMatch[];
  additionLines: CodeViewSearchLineSpan[] | undefined;
  deletionLines: CodeViewSearchLineSpan[] | undefined;
}

// Searches ordered items for one query and keeps each item's matches private
// until that item is complete or the match limit is reached.
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
  // Positions of changed items that are waiting to be searched again.
  private changedItems = new Set<number>();
  private current: CodeViewSearchItemProgress | undefined;
  private nextAfter: number;
  private nextBefore = 0;
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
    this.nextAfter = startingItemIndex;
  }

  // Whether the scan holds as many matches as the limit allows.
  get atLimit(): boolean {
    const { matchCount, limit } = this;
    return matchCount >= limit;
  }

  // Whether a changed item is waiting to be searched again.
  get hasChangedItems(): boolean {
    const { changedItems } = this;
    return changedItems.size > 0;
  }

  get finished(): boolean {
    const {
      pattern,
      atLimit,
      current,
      changedItems,
      nextAfter,
      nextBefore,
      itemCount,
      startingItemIndex,
    } = this;
    return (
      pattern == null ||
      atLimit ||
      (current == null &&
        changedItems.size === 0 &&
        nextAfter >= itemCount &&
        nextBefore >= startingItemIndex)
    );
  }

  // Searches an item again after its text changed. Its matches are dropped
  // now. An item the scan has not reached yet needs nothing.
  rescanItem(position: number): void {
    const { current, changedItems, matchCount } = this;
    if (current?.position === position) {
      this.matchCount = matchCount - current.matches.length;
      this.current = undefined;
    } else if (this.isUnreached(position)) {
      return;
    }
    this.dropItemMatches(position);
    changedItems.add(position);
  }

  // Adds items at the end of the view to the search.
  addItems(count: number): void {
    const { itemCount } = this;
    this.itemCount = itemCount + count;
  }

  // Takes an item out of the search. Every later item moves down one position.
  removeItem(position: number): void {
    this.dropItemMatches(position);
    const {
      current,
      changedItems,
      beforeStart,
      afterStart,
      matchCount,
      nextAfter,
      nextBefore,
      startingItemIndex,
      itemCount,
    } = this;
    if (current?.position === position) {
      this.matchCount = matchCount - current.matches.length;
      this.current = undefined;
    } else if (current != null && current.position > position) {
      current.position--;
    }
    const shifted = new Set<number>();
    for (const changed of changedItems) {
      if (changed !== position)
        shifted.add(changed > position ? changed - 1 : changed);
    }
    this.changedItems = shifted;
    for (const entries of [beforeStart, afterStart]) {
      const first = CodeViewSearchScan.findEntryIndex(entries, position + 1);
      for (let index = first; index < entries.length; index++) {
        entries[index].position--;
      }
    }
    if (position < nextAfter) {
      this.nextAfter = nextAfter - 1;
    }
    if (position < nextBefore) {
      this.nextBefore = nextBefore - 1;
    }
    if (position < startingItemIndex) {
      this.startingItemIndex = startingItemIndex - 1;
    }
    this.itemCount = itemCount - 1;
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
      let { current: progress } = this;
      if (progress == null) {
        progress = this.prepareItem(pattern);
        // An item the limit cut short still holds the matches it got to.
        if (this.dropItemMatches(progress.position)) changed = true;
      }
      const { cursor, visitLine } = progress;
      const completed = cursor.walk(visitLine);
      const { atLimit, changedItems } = this;
      if (completed || atLimit) {
        if (this.recordItemMatches(progress)) changed = true;
        this.current = undefined;
        // The limit cut this item short. It is searched again once there is room.
        if (!completed) changedItems.add(progress.position);
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
    const {
      finished,
      nextAfter,
      nextBefore,
      current,
      changedItems,
      startingItemIndex,
      itemCount,
    } = this;
    if (finished) {
      return false;
    }
    if (
      Math.max(start, nextAfter) < Math.min(end, itemCount) ||
      Math.max(start, nextBefore) < Math.min(end, startingItemIndex) ||
      (current != null && current.position >= start && current.position < end)
    )
      return true;
    for (const position of changedItems) {
      if (position >= start && position < end) {
        return true;
      }
    }
    return false;
  }

  // Whether an item is still unsearched.
  isItemPending(position: number): boolean {
    const { finished, changedItems, current } = this;
    return (
      !finished &&
      (changedItems.has(position) ||
        current?.position === position ||
        this.isUnreached(position))
    );
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

  // Whether the scan has not started on an item yet.
  private isUnreached(position: number): boolean {
    const { startingItemIndex, nextBefore, nextAfter } = this;
    return position >= (position < startingItemIndex ? nextBefore : nextAfter);
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

  // Starts on the next item: a changed one first, then the next one from the
  // starting position to the end, then the next one before it.
  private prepareItem(pattern: RegExp): CodeViewSearchItemProgress {
    const {
      getItem,
      wholeWord,
      limit,
      changedItems,
      nextAfter,
      nextBefore,
      itemCount,
    } = this;
    const changed = changedItems.values().next().value;
    let position: number;
    if (changed != null) {
      changedItems.delete(changed);
      position = changed;
    } else if (nextAfter < itemCount) {
      position = nextAfter;
      this.nextAfter = nextAfter + 1;
    } else {
      position = nextBefore;
      this.nextBefore = nextBefore + 1;
    }
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
