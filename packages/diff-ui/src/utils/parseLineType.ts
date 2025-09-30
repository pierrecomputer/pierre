import type { HUNK_LINE_TYPE } from '../types';

export interface ParseLineTypeReturn {
  line: string;
  type: HUNK_LINE_TYPE;
}

export function parseLineType(line: string): ParseLineTypeReturn {
  const firstChar = line.substring(0, 1);
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
  };
}
