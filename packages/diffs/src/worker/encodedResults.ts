import type { ElementContent } from 'hast';

import type { ThemedDiffResult, ThemedFileResult } from '../types';
import type { EncodedThemedDiffResult, EncodedThemedFileResult } from './types';

export function encodeFileResult(
  result: ThemedFileResult
): EncodedThemedFileResult {
  return { ...result, code: encodeLines(result.code) };
}

export function encodeDiffResult(
  result: ThemedDiffResult
): EncodedThemedDiffResult {
  return {
    ...result,
    code: {
      deletionLines: encodeLines(result.code.deletionLines),
      additionLines: encodeLines(result.code.additionLines),
    },
  };
}

export function decodeFileResult(
  result: EncodedThemedFileResult
): ThemedFileResult {
  return { ...result, code: decodeLines(result.code) };
}

export function decodeDiffResult(
  result: EncodedThemedDiffResult
): ThemedDiffResult {
  return {
    ...result,
    code: {
      deletionLines: decodeLines(result.code.deletionLines),
      additionLines: decodeLines(result.code.additionLines),
    },
  };
}

function encodeLines(lines: ElementContent[]): string[] {
  return lines.map((line) => JSON.stringify(line));
}

// Parses a line the first time it is read and keeps the parsed node, so only
// lines that actually render pay for parsing. Accessors on a plain array keep
// cached results cloneable with structuredClone.
function decodeLines(encodedLines: string[]): ElementContent[] {
  // A worker copied from an older release still sends hast nodes.
  if (typeof encodedLines[0] !== 'string') {
    return encodedLines as unknown as ElementContent[];
  }
  const lines = new Array<ElementContent>(encodedLines.length);
  for (let index = 0; index < encodedLines.length; index++) {
    const store = (line: ElementContent) => {
      Object.defineProperty(lines, index, {
        value: line,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return line;
    };
    Object.defineProperty(lines, index, {
      get: () => store(JSON.parse(encodedLines[index]) as ElementContent),
      set: store,
      enumerable: true,
      configurable: true,
    });
  }
  return lines;
}
