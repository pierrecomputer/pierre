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
    // NOTE(amadeus): If the line is empty, we should make it a
    // newline to force shiki to highlight the row. This should
    // only really ever apply as the last line of a hunk that was most likely
    // processed via a string and not a file since patch files will include a
    // newline here by default
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
