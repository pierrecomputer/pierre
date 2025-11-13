import type { HunkLineType } from '../types';

export interface ParseLineTypeReturn {
  line: string;
  type: HunkLineType;
  longLine: boolean;
}

export function parseLineType(
  line: string,
  maxLineLength: number
): ParseLineTypeReturn {
  const firstChar = line[0];
  if (
    firstChar !== '+' &&
    firstChar !== '-' &&
    firstChar !== ' ' &&
    firstChar !== '\\'
  ) {
    throw new Error(
      `parseLineType: Invalid firstChar: "${firstChar}", full line: "${line}"`
    );
  }
  return {
    line: line.substring(1),
    type:
      firstChar === ' '
        ? 'context'
        : firstChar === '\\'
          ? 'metadata'
          : firstChar === '+'
            ? 'addition'
            : 'deletion',
    longLine: line.length - 1 >= maxLineLength,
  };
}
