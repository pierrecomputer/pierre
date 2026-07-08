import type { Position, Range, TextDocument } from './textDocument';
import type { EditorTokenizer } from './tokenzier';

const OPEN_BRACKETS = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);

const CLOSE_BRACKETS = new Map(
  [...OPEN_BRACKETS].map(([open, close]) => [close, open])
);

const MAX_BRACKET_SCAN_LINES = 1_000;
const MAX_BRACKET_SCAN_CHARACTERS = 50_000;

interface BracketPosition extends Position {
  char: string;
}

export function findBracketMatchRanges<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  tokenizer: EditorTokenizer,
  position: Position
): [open: Range, close: Range] | undefined {
  const bracketPosition = findAdjacentBracket(
    textDocument,
    tokenizer,
    textDocument.normalizePosition(position)
  );
  if (bracketPosition === undefined) {
    return undefined;
  }

  const closingBracket = OPEN_BRACKETS.get(bracketPosition.char);
  const openingBracket = CLOSE_BRACKETS.get(bracketPosition.char);
  if (closingBracket !== undefined) {
    const matchPosition = findClosingBracket(
      textDocument,
      tokenizer,
      bracketPosition,
      closingBracket
    );
    return createBracketMatchRanges(bracketPosition, matchPosition);
  }
  if (openingBracket !== undefined) {
    const matchPosition = findOpeningBracket(
      textDocument,
      tokenizer,
      bracketPosition,
      openingBracket
    );
    return createBracketMatchRanges(matchPosition, bracketPosition);
  }
  return undefined;
}

function findAdjacentBracket<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  tokenizer: EditorTokenizer,
  position: Position
): BracketPosition | undefined {
  const previousPosition = getPreviousCharacterPosition(textDocument, position);
  if (previousPosition !== undefined) {
    const previousBracket = getBracketAtPosition(
      textDocument,
      tokenizer,
      previousPosition
    );
    if (previousBracket !== undefined) {
      return previousBracket;
    }
  }
  return getBracketAtPosition(textDocument, tokenizer, position);
}

function getPreviousCharacterPosition<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  position: Position
): Position | undefined {
  if (position.character > 0) {
    return { line: position.line, character: position.character - 1 };
  }
  if (position.line <= 0) {
    return undefined;
  }
  const previousLine = position.line - 1;
  const previousLineLength = textDocument.getLineText(previousLine).length;
  if (previousLineLength === 0) {
    return undefined;
  }
  return { line: previousLine, character: previousLineLength - 1 };
}

function getBracketAtPosition<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  tokenizer: EditorTokenizer,
  position: Position
): BracketPosition | undefined {
  const lineText = textDocument.getLineText(position.line);
  const char = lineText[position.character];
  if (
    char === undefined ||
    (!OPEN_BRACKETS.has(char) && !CLOSE_BRACKETS.has(char)) ||
    isInIgnoredTokenRange(tokenizer, position)
  ) {
    return undefined;
  }
  return { ...position, char };
}

function findClosingBracket<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  tokenizer: EditorTokenizer,
  bracketPosition: BracketPosition,
  closingBracket: string
): BracketPosition | undefined {
  let depth = 0;
  let scannedLines = 0;
  let scannedCharacters = 0;
  for (let line = bracketPosition.line; line < textDocument.lineCount; line++) {
    if (scannedLines >= MAX_BRACKET_SCAN_LINES) {
      return undefined;
    }
    scannedLines++;
    const lineText = textDocument.getLineText(line);
    const ignoredRanges = tokenizer.getStringCommentRegexpRangesInLine(line);
    const ignoredRangeCursor = { index: 0 };
    const startCharacter =
      line === bracketPosition.line ? bracketPosition.character : 0;
    for (
      let character = startCharacter;
      character < lineText.length;
      character++
    ) {
      if (scannedCharacters >= MAX_BRACKET_SCAN_CHARACTERS) {
        return undefined;
      }
      scannedCharacters++;
      if (
        isCharacterIgnoredForward(ignoredRanges, character, ignoredRangeCursor)
      ) {
        continue;
      }
      const char = lineText[character];
      if (char === bracketPosition.char) {
        depth++;
      } else if (char === closingBracket) {
        depth--;
        if (depth === 0) {
          return { line, character, char };
        }
      }
    }
  }
  return undefined;
}

function findOpeningBracket<LAnnotation>(
  textDocument: TextDocument<LAnnotation>,
  tokenizer: EditorTokenizer,
  bracketPosition: BracketPosition,
  openingBracket: string
): BracketPosition | undefined {
  let depth = 0;
  let scannedLines = 0;
  let scannedCharacters = 0;
  for (let line = bracketPosition.line; line >= 0; line--) {
    if (scannedLines >= MAX_BRACKET_SCAN_LINES) {
      return undefined;
    }
    scannedLines++;
    const lineText = textDocument.getLineText(line);
    const ignoredRanges = tokenizer.getStringCommentRegexpRangesInLine(line);
    const ignoredRangeCursor = {
      index: ignoredRanges === null ? -1 : ignoredRanges.length - 1,
    };
    const startCharacter =
      line === bracketPosition.line
        ? bracketPosition.character
        : lineText.length - 1;
    for (let character = startCharacter; character >= 0; character--) {
      if (scannedCharacters >= MAX_BRACKET_SCAN_CHARACTERS) {
        return undefined;
      }
      scannedCharacters++;
      if (
        isCharacterIgnoredBackward(ignoredRanges, character, ignoredRangeCursor)
      ) {
        continue;
      }
      const char = lineText[character];
      if (char === bracketPosition.char) {
        depth++;
      } else if (char === openingBracket) {
        depth--;
        if (depth === 0) {
          return { line, character, char };
        }
      }
    }
  }
  return undefined;
}

function isInIgnoredTokenRange(
  tokenizer: EditorTokenizer,
  position: Position
): boolean {
  const ranges = tokenizer.getStringCommentRegexpRangesInLine(position.line);
  return isCharacterInIgnoredRanges(ranges, position.character);
}

function isCharacterInIgnoredRanges(
  ranges: [start: number, end: number][] | null,
  character: number
): boolean {
  if (ranges === null) {
    return false;
  }
  for (const [start, end] of ranges) {
    if (character < start) {
      return false;
    }
    if (character < end) {
      return true;
    }
  }
  return false;
}

function isCharacterIgnoredForward(
  ranges: [start: number, end: number][] | null,
  character: number,
  cursor: { index: number }
): boolean {
  if (ranges === null) {
    return false;
  }
  while (cursor.index < ranges.length && character >= ranges[cursor.index][1]) {
    cursor.index++;
  }
  const range = ranges[cursor.index];
  return range !== undefined && character >= range[0];
}

function isCharacterIgnoredBackward(
  ranges: [start: number, end: number][] | null,
  character: number,
  cursor: { index: number }
): boolean {
  if (ranges === null) {
    return false;
  }
  while (cursor.index >= 0 && character < ranges[cursor.index][0]) {
    cursor.index--;
  }
  const range = ranges[cursor.index];
  return range !== undefined && character < range[1];
}

function createBracketMatchRanges(
  firstPosition: Position | undefined,
  secondPosition: Position | undefined
): [open: Range, close: Range] | undefined {
  if (firstPosition === undefined || secondPosition === undefined) {
    return;
  }
  return [
    createCharacterRange(firstPosition),
    createCharacterRange(secondPosition),
  ];
}

function createCharacterRange(position: Position): Range {
  return {
    start: { line: position.line, character: position.character },
    end: { line: position.line, character: position.character + 1 },
  };
}
