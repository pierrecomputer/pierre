import type { HunkLineType } from '../types';

export interface ParsedLine {
  line: string;
  type: Exclude<HunkLineType, 'expanded'>;
}

export function parseLineType(line: string): ParsedLine | undefined {
  const firstChar = line[0];
  if (
    firstChar !== '+' &&
    firstChar !== '-' &&
    firstChar !== ' ' &&
    firstChar !== '\\'
  ) {
    console.error(
      `parseLineType: Invalid firstChar: "${firstChar}", full line: "${line}"`
    );
    return undefined;
  }
  const processedLine = line.substring(1);
  return {
    // Empty patch rows still need a line ending to appear in the rendered hunk.
    line: processedLine === '' ? '\n' : processedLine,
    type:
      firstChar === ' '
        ? 'context'
        : firstChar === '\\'
          ? 'metadata'
          : firstChar === '+'
            ? 'addition'
            : 'deletion',
  };
}
