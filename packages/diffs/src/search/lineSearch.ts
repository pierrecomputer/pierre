import type { SearchParams } from './index';

// TODO(ije): use Intl.Segmenter instead of regex for word separators
const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';

// Compiles a query once; empty, invalid, or newline-spanning queries match nothing.
export function compileSearchQuery(
  searchParams: SearchParams
): RegExp | undefined {
  if (
    searchParams.text.length === 0 ||
    isNewlineSpanningSearch(searchParams.text, searchParams.regex)
  ) {
    return undefined;
  }
  try {
    return compileSearchRegExp(
      searchParams.text,
      searchParams.regex,
      searchParams.caseSensitive
    );
  } catch {
    return undefined;
  }
}

// Visits nonempty UTF-16 ranges in line text. The text may still have its line
// ending when the pattern is plain text, which can never match one. The
// visitor returns true to stop; the function returns whether it was stopped.
// The pattern carries state, so a visitor must not match another line with it.
export function matchSearchLine(
  pattern: RegExp,
  lineText: string,
  wholeWord: boolean,
  visitMatch: (startCharacter: number, endCharacter: number) => boolean
): boolean {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(lineText)) != null) {
    const start = match.index;
    const length = match[0].length;
    if (length === 0) {
      pattern.lastIndex = advancePastEmptyMatch(lineText, start);
      continue;
    }
    const end = start + length;
    if (
      (!wholeWord || isWholeWordInLine(lineText, start, end)) &&
      visitMatch(start, end)
    ) {
      return true;
    }
    if (start === pattern.lastIndex) {
      pattern.lastIndex = advancePastEmptyMatch(lineText, start);
    }
  }
  return false;
}

// Rejects literal or escaped line breaks because matches stay within one line.
function isNewlineSpanningSearch(text: string, isRegex: boolean): boolean {
  return (
    text.includes('\n') ||
    text.includes('\r') ||
    // Each pair represents a literal backslash. Only an unpaired one escapes n or r.
    (isRegex && /\\[nr]/.test(text.replaceAll('\\\\', '')))
  );
}

// Quotes regex metacharacters so a literal query matches its exact text.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Builds a global pattern for searching or recovering replacement captures.
function compileSearchRegExp(
  source: string,
  isRegex: boolean,
  caseSensitive: boolean
): RegExp {
  const body = isRegex ? source : escapeRegExp(source);
  const flags = `g${caseSensitive ? '' : 'i'}${isRegex ? 'm' : ''}`;
  return new RegExp(body, flags);
}

// Recognizes the separators used by whole-word search, including line endings.
function isWordSeparatorCharCode(charCode: number): boolean {
  if (charCode <= 32 || charCode === 127) {
    return true;
  }
  const ch = String.fromCharCode(charCode);
  return WORD_SEPARATORS.includes(ch);
}

// Checks adjacent characters, treating either edge of the line as a separator.
function isWholeWordInLine(text: string, start: number, end: number): boolean {
  return (
    (start === 0 || isWordSeparatorCharCode(text.charCodeAt(start - 1))) &&
    (end === text.length || isWordSeparatorCharCode(text.charCodeAt(end)))
  );
}

// Skips an empty match without stopping between the halves of a surrogate pair.
function advancePastEmptyMatch(text: string, index: number): number {
  if (index + 1 < text.length) {
    const first = text.charCodeAt(index);
    const second = text.charCodeAt(index + 1);
    if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      second >= 0xdc00 &&
      second <= 0xdfff
    ) {
      return index + 2;
    }
  }
  return index + 1;
}
