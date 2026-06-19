const LINE_FEED = 10; // \n
const CARRIAGE_RETURN = 13; // \r

/**
 * Computes line start offsets for a string.
 */
export function computeLineOffsets(contents: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < contents.length; i++) {
    const char = contents.charCodeAt(i);
    if (char === LINE_FEED || char === CARRIAGE_RETURN) {
      if (
        char === CARRIAGE_RETURN &&
        i + 1 < contents.length &&
        contents.charCodeAt(i + 1) === LINE_FEED
      ) {
        i++;
      }
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Counts line breaks in a string, treating `\n`, `\r`, and `\r\n` the same way
 * {@link computeLineOffsets} does (a `\r\n` pair is one break). Mirrors that
 * scan but counts in a single pass instead of building and discarding an
 * offsets array, so sizing the changed-line range for large edits stays cheap.
 * A unit test asserts it stays in lockstep with `computeLineOffsets`.
 */
export function countLineBreaks(contents: string): number {
  let count = 0;
  for (let i = 0; i < contents.length; i++) {
    const char = contents.charCodeAt(i);
    if (char === LINE_FEED || char === CARRIAGE_RETURN) {
      // Skip the `\n` of a `\r\n` pair so it counts as one break, not two.
      if (
        char === CARRIAGE_RETURN &&
        i + 1 < contents.length &&
        contents.charCodeAt(i + 1) === LINE_FEED
      ) {
        i++;
      }
      count++;
    }
  }
  return count;
}

/**
 * Splits file contents into lines aligned with {@link computeLineOffsets}.
 * Unlike splitFileContents, a trailing newline produces a final empty line.
 */
export function linesFromFileContents(contents: string): string[] {
  const offsets = computeLineOffsets(contents);
  const lines = Array.from({ length: offsets.length }, (_, i) => {
    const start = offsets[i];
    const end = offsets[i + 1] ?? contents.length;
    return contents.slice(start, end);
  });
  return lines;
}
