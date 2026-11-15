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
  contents: string;
}

export interface CodeViewSearchDiff {
  type: 'diff';
  fileDiff: FileDiffMetadata;
  additionContents?: string;
  diffStyle: 'split' | 'unified';
  additionsOnly: boolean;
}

export type CodeViewSearchItem = CodeViewSearchFile | CodeViewSearchDiff;
export type CodeViewSearchItemProvider = (itemId: string) => CodeViewSearchItem;

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

interface CodeViewSearchItemProgress {
  itemId: string;
  cursor: CodeViewSearchTextCursor | CodeViewSearchDiffCursor;
  matches: CodeViewSearchMatch[];
  visitLine: CodeViewSearchLineVisitor;
}

// Searches ordered items for one query and keeps each item's matches private
// until that item is complete or the match limit is reached.
export class CodeViewSearchScan {
  private readonly pattern: RegExp | undefined;
  private readonly wholeWord: boolean;
  private readonly itemMatches = new Map<string, CodeViewSearchMatch[]>();
  private readonly lineMatches = new Map<
    string,
    Map<string, CodeViewSearchMatch[]>
  >();
  private current: CodeViewSearchItemProgress | undefined;
  private nextItem = 0;
  private matchCount = 0;
  private scannedCharacters = 0;
  private deadline: number | undefined;

  constructor(
    searchParams: SearchParams,
    private readonly itemIds: readonly string[],
    private readonly getItem: CodeViewSearchItemProvider,
    private readonly limit: number
  ) {
    this.pattern = compileSearchQuery(searchParams);
    this.wholeWord = searchParams.wholeWord;
  }

  get finished(): boolean {
    const { pattern, matchCount, limit, current, nextItem, itemIds } = this;
    return (
      pattern == null ||
      matchCount >= limit ||
      (current == null && nextItem >= itemIds.length)
    );
  }

  // Works until all items are done, the limit is reached, or the budget runs out.
  // The next call carries on from the next unsearched line of the current item.
  advance(budgetMs?: number): void {
    const { pattern } = this;
    if (this.finished || pattern == null) return;
    this.deadline = budgetMs == null ? undefined : performance.now() + budgetMs;
    this.scannedCharacters = 0;
    while (!this.finished) {
      const progress = this.current ?? this.prepareItem(pattern);
      const { cursor, itemId, matches, visitLine } = progress;
      const completed = cursor.walk(visitLine);
      if (completed || this.matchCount >= this.limit) {
        this.itemMatches.set(itemId, matches);
        this.current = undefined;
      }
      if (!completed) return;
    }
  }

  // Joins finished results in the caller's item order for panel navigation.
  getMatches(itemIds: readonly string[] = this.itemIds): CodeViewSearchMatch[] {
    const { itemMatches } = this;
    const matches: CodeViewSearchMatch[] = [];
    for (const id of itemIds) {
      const next = itemMatches.get(id);
      if (next != null) for (const match of next) matches.push(match);
    }
    return matches;
  }

  getItemMatches(itemId: string): readonly CodeViewSearchMatch[] | undefined {
    const { itemMatches } = this;
    return itemMatches.get(itemId);
  }

  // Builds an item's source-line lookup only when painting requests its first line.
  getLineMatches(
    itemId: string,
    lineNumber: number,
    side: SelectionSide = 'additions'
  ): readonly CodeViewSearchMatch[] | undefined {
    const { lineMatches, itemMatches } = this;
    let grouped = lineMatches.get(itemId);
    if (grouped == null) {
      const matches = itemMatches.get(itemId);
      if (matches == null) return undefined;
      grouped = new Map<string, CodeViewSearchMatch[]>();
      for (const match of matches) {
        const key = `${match.side ?? 'additions'}:${match.lineNumber}`;
        const line = grouped.get(key);
        if (line == null) grouped.set(key, [match]);
        else line.push(match);
      }
      lineMatches.set(itemId, grouped);
    }
    return grouped.get(`${side}:${lineNumber}`);
  }

  // Prepares source offsets once for the next item supplied by CodeView.
  private prepareItem(pattern: RegExp): CodeViewSearchItemProgress {
    const { getItem, itemIds, wholeWord, limit } = this;
    const itemId = itemIds[this.nextItem++];
    const item = getItem(itemId);
    const { type } = item;
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
      const capped = matchSearchLine(pattern, text, wholeWord, visitMatch);
      const { deadline } = this;
      if (deadline == null) return capped;
      this.scannedCharacters += text.length + 1;
      if (this.scannedCharacters < CODE_VIEW_SEARCH_CLOCK_CHECK_CHARACTERS)
        return capped;
      this.scannedCharacters = 0;
      return capped || performance.now() >= deadline;
    };
    this.current = { itemId, cursor, matches, visitLine };
    return this.current;
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

export function areCodeViewSearchMatchArraysEqual(
  a: readonly CodeViewSearchMatch[],
  b: readonly CodeViewSearchMatch[]
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    const aMatch = a[index];
    const bMatch = b[index];
    if (
      aMatch === undefined ||
      bMatch === undefined ||
      !areCodeViewSearchMatchesEqual(aMatch, bMatch)
    ) {
      return false;
    }
  }
  return true;
}
