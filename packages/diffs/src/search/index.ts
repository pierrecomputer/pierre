import { compileSearchQuery, matchSearchLine } from './lineSearch';

export * from './lineSearch';
export * from './codeViewSearch';

export type MatchRange = [startOffset: number, endOffset: number];

export interface SearchParams {
  text: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export type SearchPanelMode = 'find' | 'replace';

/** Matching options a host can preset for a fresh panel. */
export type SearchOptionDefaults = Partial<
  Pick<SearchParams, 'caseSensitive' | 'wholeWord' | 'regex'>
>;

/** Search state reported after every change while a panel is open. */
export interface SearchPanelState extends SearchParams {
  /** Shown mode: `find` whenever replacement is unavailable. */
  mode: SearchPanelMode;
  /** Whether the host bound replacement for the current scope. */
  canReplace: boolean;
  matchCount: number;
  /** Zero-based index of the current match, or undefined when none is current. */
  currentMatchIndex: number | undefined;
}

// Called for each accepted match with both document offsets and line-relative
// coordinates so callers need not recover the line from the offsets.
export type SearchMatchVisitor = (
  match: MatchRange,
  index: number,
  line: number,
  startCharacter: number,
  endCharacter: number
) => void;

export interface SearchPosition {
  readonly line: number;
  readonly character: number;
}

/** What a replacement needs from a document to expand `$1`-style references. */
export interface ReplacementDocument {
  positionAt(offset: number): SearchPosition;
  offsetAt(position: SearchPosition): number;
  getLineText(line: number): string;
}

/**
 * What a document must expose to be searched. Matching runs one line at a
 * time, so patterns that span a newline never match.
 */
export interface SearchableDocument {
  readonly lineCount: number;
  /** Returns the line's text without its line ending. */
  getLineText(line: number): string;
  getLineStartOffset(line: number): number;
}

export const MAX_SEARCH_MATCHES = 100000;

// Collects matches in document order, stopping after the accepted cap.
export function searchDocument(
  document: SearchableDocument,
  searchParams: SearchParams,
  limit: number = MAX_SEARCH_MATCHES,
  onMatch?: SearchMatchVisitor
): MatchRange[] {
  const pattern = compileSearchQuery(searchParams);
  if (pattern == null) {
    return [];
  }

  const out: MatchRange[] = [];
  const { wholeWord } = searchParams;
  let line = 0;
  let lineStart = 0;
  const visitMatch = (
    startCharacter: number,
    endCharacter: number
  ): boolean => {
    const range: MatchRange = [
      lineStart + startCharacter,
      lineStart + endCharacter,
    ];
    out.push(range);
    onMatch?.(range, out.length - 1, line, startCharacter, endCharacter);
    return out.length >= limit;
  };

  for (; line < document.lineCount; line++) {
    const lineText = document.getLineText(line);
    lineStart = document.getLineStartOffset(line);
    if (matchSearchLine(pattern, lineText, wholeWord, visitMatch)) {
      break;
    }
  }
  return out;
}

/** Expands `$&`, `$1`, `$$`, etc. in a regex replace string using a match. */
export function buildSearchReplacementText(
  document: ReplacementDocument,
  searchParams: SearchParams,
  matchStart: number,
  matchEnd: number
): string {
  if (!searchParams.regex) {
    return searchParams.replaceText;
  }

  const position = document.positionAt(matchStart);
  const lineText = document.getLineText(position.line);
  const lineStart = document.offsetAt({ line: position.line, character: 0 });
  const relStart = matchStart - lineStart;

  const pattern = compileSearchQuery(searchParams);
  if (pattern == null) {
    return searchParams.replaceText;
  }

  // Re-run at the original line offset so lookaround can inspect context
  // outside the matched range while captures still come from this exact hit.
  pattern.lastIndex = relStart;
  const match = pattern.exec(lineText);
  if (
    match == null ||
    match.index !== relStart ||
    match[0].length !== matchEnd - matchStart
  ) {
    return searchParams.replaceText;
  }
  return expandReplaceString(searchParams.replaceText, match);
}

// Expands replacement tokens using the captures from the accepted regex match.
function expandReplaceString(
  replacement: string,
  match: RegExpExecArray
): string {
  return replacement.replace(/\$([$&]|\d+)/g, (_token, group: string) => {
    if (group === '$') {
      return '$';
    }
    if (group === '&') {
      return match[0] ?? '';
    }
    const index = Number(group);
    return match[index] ?? '';
  });
}
