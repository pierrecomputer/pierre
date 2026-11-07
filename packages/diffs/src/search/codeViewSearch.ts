import type { CodeViewItem, SelectionSide } from '../types';
import {
  type SearchableDocument,
  searchDocument,
  type SearchParams,
} from './index';

// The search index CodeView builds over its items: one record per searchable
// line, the matches found in them, and the helpers that compare and group
// those matches for navigation and repaints.

export interface CodeViewSearchLineMetadata {
  itemId: string;
  itemType: CodeViewItem<unknown>['type'];
  side: SelectionSide | undefined;
  lineNumber: number;
  lineIndex: number;
}

export interface CodeViewSearchLine {
  text: string;
  metadata: CodeViewSearchLineMetadata;
}

export interface CodeViewSearchMatch extends CodeViewSearchLineMetadata {
  startCharacter: number;
  endCharacter: number;
}

export type CodeViewItemSearchMatches = Map<string, CodeViewSearchMatch[]>;

class CodeViewLineSearchDocument implements SearchableDocument {
  readonly lines: CodeViewSearchLine[];
  readonly lineStarts: number[] = [];
  readonly textLength: number;

  constructor(lines: readonly CodeViewSearchLine[]) {
    this.lines = lines.map(({ text, metadata }) => ({
      text: trimLineEnding(text),
      metadata,
    }));

    let offset = 0;
    for (const line of this.lines) {
      this.lineStarts.push(offset);
      offset += line.text.length + 1;
    }

    this.textLength = this.lines.length === 0 ? 0 : offset - 1;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  getLineText(line: number): string {
    return this.lines[line]?.text ?? '';
  }

  getLineStartOffset(line: number): number {
    return this.lineStarts[line] ?? this.textLength;
  }

  getMetadata(line: number): CodeViewSearchLineMetadata {
    const metadata = this.lines[line]?.metadata;
    if (metadata === undefined) {
      throw new Error('CodeViewLineSearchDocument.getMetadata: invalid line');
    }
    return metadata;
  }

  charAt(offset: number): string {
    if (offset < 0 || offset >= this.textLength || this.lines.length === 0) {
      return '';
    }

    const lineIndex = this.getLineIndexAtOffset(offset);
    const line = this.lines[lineIndex];
    const lineStart = this.getLineStartOffset(lineIndex);
    if (line === undefined) {
      return '';
    }

    const character = offset - lineStart;
    return character < line.text.length ? line.text.charAt(character) : '\n';
  }

  getLineIndexAtOffset(offset: number): number {
    let low = 0;
    let high = this.lineStarts.length - 1;
    let result = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const lineStart = this.lineStarts[mid] ?? 0;
      if (lineStart <= offset) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }
}

// Build source matches during the search pass instead of resolving each
// absolute match offset back to a line afterward.
export function collectCodeViewLineMatches(
  lines: readonly CodeViewSearchLine[],
  searchParams: SearchParams,
  limit: number
): CodeViewSearchMatch[] {
  if (lines.length === 0 || limit <= 0) {
    return [];
  }

  const document = new CodeViewLineSearchDocument(lines);
  const matches: CodeViewSearchMatch[] = [];
  searchDocument(
    document,
    searchParams,
    limit,
    (_range, _index, line, startCharacter, endCharacter) => {
      matches.push({
        ...document.getMetadata(line),
        startCharacter,
        endCharacter,
      });
    }
  );
  return matches;
}

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

// Index each result once by item and source line. Repaints can then look up
// mounted rows without walking all matches in a large file again.
export function groupCodeViewSearchMatchesByItem(
  matches: readonly CodeViewSearchMatch[]
): Map<string, CodeViewItemSearchMatches> {
  const grouped = new Map<string, CodeViewItemSearchMatches>();
  for (const match of matches) {
    let itemMatches = grouped.get(match.itemId);
    if (itemMatches == null) {
      itemMatches = new Map();
      grouped.set(match.itemId, itemMatches);
    }
    const key = `${match.side ?? 'additions'}:${match.lineNumber}`;
    const lineMatches = itemMatches.get(key);
    if (lineMatches == null) itemMatches.set(key, [match]);
    else lineMatches.push(match);
  }
  return grouped;
}
