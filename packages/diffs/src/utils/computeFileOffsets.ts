const LINE_FEED = 10; // \n
const CARRIAGE_RETURN = 13; // \r
const DENSE_LINE_BREAK_BLOCK_SIZE = 4;
const DENSE_LINE_BREAK_BLOCK_SPAN = 40;

/**
 * Computes line start offsets for a string.
 */
export function computeLineOffsets(contents: string): number[] {
  const offsets: number[] = [0];
  let carriageReturn = contents.indexOf('\r');
  let lineFeed = contents.indexOf('\n');
  let blockStart = 0;
  let blockBreaks = 0;
  while (carriageReturn !== -1 || lineFeed !== -1) {
    let nextOffset: number;
    if (
      carriageReturn !== -1 &&
      (lineFeed === -1 || carriageReturn < lineFeed)
    ) {
      if (lineFeed === carriageReturn + 1) {
        nextOffset = lineFeed + 1;
        carriageReturn = contents.indexOf('\r', nextOffset);
        lineFeed = contents.indexOf('\n', nextOffset);
      } else {
        nextOffset = carriageReturn + 1;
        carriageReturn = contents.indexOf('\r', nextOffset);
      }
    } else {
      nextOffset = lineFeed + 1;
      lineFeed = contents.indexOf('\n', nextOffset);
    }
    offsets.push(nextOffset);

    if (++blockBreaks === DENSE_LINE_BREAK_BLOCK_SIZE) {
      if (nextOffset - blockStart <= DENSE_LINE_BREAK_BLOCK_SPAN) {
        // Native searches win on source-like lines; a character scan is faster
        // once line breaks become unusually dense.
        for (let i = nextOffset; i < contents.length; i++) {
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
      blockStart = nextOffset;
      blockBreaks = 0;
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
