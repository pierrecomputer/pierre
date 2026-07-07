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
    position
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
  for (let line = bracketPosition.line; line < textDocument.lineCount; line++) {
    const lineText = textDocument.getLineText(line);
    const startCharacter =
      line === bracketPosition.line ? bracketPosition.character : 0;
    for (
      let character = startCharacter;
      character < lineText.length;
      character++
    ) {
      if (isInIgnoredTokenRange(tokenizer, { line, character })) {
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
  for (let line = bracketPosition.line; line >= 0; line--) {
    const lineText = textDocument.getLineText(line);
    const startCharacter =
      line === bracketPosition.line
        ? bracketPosition.character
        : lineText.length - 1;
    for (let character = startCharacter; character >= 0; character--) {
      if (isInIgnoredTokenRange(tokenizer, { line, character })) {
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
  if (ranges === null) {
    return false;
  }
  return ranges.some(
    ([start, end]) => position.character >= start && position.character < end
  );
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
