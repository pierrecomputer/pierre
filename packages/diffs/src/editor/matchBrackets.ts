import type { EditorSelection } from './selection';
import { isCollapsedSelection } from './selection';
import type { Range, TextDocument } from './textDocument';

const OPEN_BRACKETS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

const CLOSE_BRACKETS = new Map(
  [...OPEN_BRACKETS].map(([open, close]) => [close, open])
);

export function findBracketMatchRanges<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  selection: EditorSelection
): Range[] | undefined {
  if (!isCollapsedSelection(selection)) {
    return;
  }

  const offset = textDocument.offsetAt(selection.start);
  const previousOffset = offset - 1;
  let text: string | undefined;
  let ignoredOffsets: Uint8Array | undefined;
  const getMatchRanges = (bracketOffset: number) => {
    text ??= textDocument.getText();
    ignoredOffsets ??= getBracketIgnoredOffsets(text);
    return findBracketMatchRangesAtOffset(
      textDocument,
      text,
      bracketOffset,
      ignoredOffsets
    );
  };
  if (previousOffset >= 0) {
    const previousChar = textDocument.charAt(previousOffset);
    if (OPEN_BRACKETS.has(previousChar) || CLOSE_BRACKETS.has(previousChar)) {
      const ranges = getMatchRanges(previousOffset);
      if (ranges !== undefined) {
        return ranges;
      }
    }
  }
  const nextChar = textDocument.charAt(offset);
  if (OPEN_BRACKETS.has(nextChar) || CLOSE_BRACKETS.has(nextChar)) {
    return getMatchRanges(offset);
  }
  return undefined;
}

function findBracketMatchRangesAtOffset<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  text: string,
  bracketOffset: number,
  ignoredOffsets: Uint8Array
): Range[] | undefined {
  if (ignoredOffsets[bracketOffset] === 1) {
    return undefined;
  }

  const bracket = text[bracketOffset];
  const closingBracket = OPEN_BRACKETS.get(bracket);
  const openingBracket = CLOSE_BRACKETS.get(bracket);
  if (closingBracket !== undefined) {
    const matchOffset = findClosingBracket(
      text,
      bracketOffset,
      bracket,
      closingBracket,
      ignoredOffsets
    );
    return createBracketMatchRanges(textDocument, bracketOffset, matchOffset);
  }
  if (openingBracket !== undefined) {
    const matchOffset = findOpeningBracket(
      text,
      bracketOffset,
      openingBracket,
      bracket,
      ignoredOffsets
    );
    return createBracketMatchRanges(textDocument, matchOffset, bracketOffset);
  }
  return undefined;
}

function getBracketIgnoredOffsets(text: string): Uint8Array {
  const ignoredOffsets = new Uint8Array(text.length);
  let offset = 0;
  while (offset < text.length) {
    const char = text[offset];
    const nextChar = text[offset + 1];

    // TODO(@ije): use token type of shiki to match string/comment/etc.
    // see https://github.com/shikijs/shiki/pull/1293
    if (char === '/' && nextChar === '/') {
      offset = markIgnoredLineComment(text, offset, ignoredOffsets);
    } else if (char === '/' && nextChar === '*') {
      offset = markIgnoredBlockComment(text, offset, ignoredOffsets);
    } else if (char === "'" || char === '"' || char === '`') {
      offset = markIgnoredQuotedText(text, offset, char, ignoredOffsets);
    } else {
      offset++;
    }
  }
  return ignoredOffsets;
}

function markIgnoredLineComment(
  text: string,
  startOffset: number,
  ignoredOffsets: Uint8Array
): number {
  let offset = startOffset;
  while (offset < text.length) {
    const char = text[offset];
    if (char === '\n' || char === '\r') {
      return offset;
    }
    ignoredOffsets[offset] = 1;
    offset++;
  }
  return offset;
}

function markIgnoredBlockComment(
  text: string,
  startOffset: number,
  ignoredOffsets: Uint8Array
): number {
  let offset = startOffset;
  while (offset < text.length) {
    ignoredOffsets[offset] = 1;
    if (text[offset] === '*' && text[offset + 1] === '/') {
      ignoredOffsets[offset + 1] = 1;
      return offset + 2;
    }
    offset++;
  }
  return offset;
}

function markIgnoredQuotedText(
  text: string,
  startOffset: number,
  quote: string,
  ignoredOffsets: Uint8Array
): number {
  let offset = startOffset;
  while (offset < text.length) {
    ignoredOffsets[offset] = 1;
    const char = text[offset];
    if (char === '\\') {
      offset++;
      if (offset < text.length) {
        ignoredOffsets[offset] = 1;
      }
    } else if (offset > startOffset && char === quote) {
      return offset + 1;
    } else if (quote !== '`' && (char === '\n' || char === '\r')) {
      return offset;
    }
    offset++;
  }
  return offset;
}

function findClosingBracket(
  text: string,
  bracketOffset: number,
  openingBracket: string,
  closingBracket: string,
  ignoredOffsets: Uint8Array
): number | undefined {
  let depth = 0;
  for (let offset = bracketOffset; offset < text.length; offset++) {
    if (ignoredOffsets[offset] === 1) {
      continue;
    }
    const char = text[offset];
    if (char === openingBracket) {
      depth++;
    } else if (char === closingBracket) {
      depth--;
      if (depth === 0) {
        return offset;
      }
    }
  }
  return undefined;
}

function findOpeningBracket(
  text: string,
  bracketOffset: number,
  openingBracket: string,
  closingBracket: string,
  ignoredOffsets: Uint8Array
): number | undefined {
  let depth = 0;
  for (let offset = bracketOffset; offset >= 0; offset--) {
    if (ignoredOffsets[offset] === 1) {
      continue;
    }
    const char = text[offset];
    if (char === closingBracket) {
      depth++;
    } else if (char === openingBracket) {
      depth--;
      if (depth === 0) {
        return offset;
      }
    }
  }
  return undefined;
}

function createBracketMatchRanges<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  firstOffset: number | undefined,
  secondOffset: number | undefined
): Range[] | undefined {
  if (firstOffset === undefined || secondOffset === undefined) {
    return;
  }
  return [firstOffset, secondOffset].map((offset) => ({
    start: textDocument.positionAt(offset),
    end: textDocument.positionAt(offset + 1),
  }));
}
