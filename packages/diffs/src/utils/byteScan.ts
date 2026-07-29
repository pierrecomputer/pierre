// oxfmt-ignore
export const TAB:             number = '\t'.charCodeAt(0), // 9
             NEWLINE:         number = '\n'.charCodeAt(0), // 10
             VERTICAL_TAB:    number = '\v'.charCodeAt(0), // 11
             FORM_FEED:       number = '\f'.charCodeAt(0), // 12
             CARRIAGE_RETURN: number = '\r'.charCodeAt(0), // 13
             SPACE:           number = ' '.charCodeAt(0),  // 32
             PLUS:            number = '+'.charCodeAt(0),  // 43
             MINUS:           number = '-'.charCodeAt(0),  // 45
             BACKSLASH:       number = '\\'.charCodeAt(0); // 92

// True when the bytes at `index` spell the ASCII `text`, compared byte by byte
// so neither a slice of `bytes` nor an encoding of `text` is ever allocated
export function matchesAscii(
  bytes: Uint8Array,
  index: number,
  end: number,
  text: string
): boolean {
  if (index + text.length > end) {
    return false;
  }
  for (let offset = 0; offset < text.length; offset++) {
    if (bytes[index + offset] !== text.charCodeAt(offset)) {
      return false;
    }
  }
  return true;
}

// End of the line starting at `index`, exclusive and including the newline.
// A newline at or beyond `end` is treated as absent, so a streaming buffer can
// pass its live cursor as `end` and ignore not-yet-consumed bytes
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/packages/diffs/src/utils/parsePatchFiles.ts#L764-L770
export function lineEndExclusive(
  bytes: Uint8Array,
  index: number,
  end: number
): number {
  const newlineIndex = bytes.indexOf(NEWLINE, index);
  return newlineIndex === -1 || newlineIndex >= end ? end : newlineIndex + 1;
}

// First line start at or after `from` (itself a line start) whose bytes begin
// with the ASCII `prefix`, or `end` when there is none
export function findNextLineStartingWith(
  bytes: Uint8Array,
  from: number,
  end: number,
  prefix: string
): number {
  let lineStart = from;
  while (lineStart < end) {
    if (matchesAscii(bytes, lineStart, end, prefix)) {
      return lineStart;
    }
    lineStart = lineEndExclusive(bytes, lineStart, end);
  }
  return end;
}

// True when the byte range is an empty line: just a `\n`, a `\r\n`, or nothing
export function isBlankLine(
  bytes: Uint8Array,
  start: number,
  end: number
): boolean {
  const lineLength = end - start;
  if (lineLength === 1) {
    return bytes[start] === NEWLINE || bytes[start] === CARRIAGE_RETURN;
  }
  if (lineLength === 2) {
    return bytes[start] === CARRIAGE_RETURN && bytes[start + 1] === NEWLINE;
  }
  return lineLength === 0;
}

// True when `bytes` holds anything other than ASCII whitespace, used to drop the
// blank runs between format-patch files. It stands in for the string splitter's
// `/\S/` test but scans the bytes directly, so a file slice never has to be
// decoded to a string just to be checked. (`/\S/` would also match Unicode
// whitespace; only ASCII can appear in these separators, so checking the six
// ASCII whitespace bytes gives the same answer here)
// Adapted from: https://github.com/pierrecomputer/pierre/blob/844cf495ae18d43c45cc8bd4455224480017241a/apps/diffshub/lib/streamGitPatchFiles.ts#L7
export function hasNonWhitespace(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (
      byte !== SPACE &&
      byte !== TAB &&
      byte !== NEWLINE &&
      byte !== CARRIAGE_RETURN &&
      byte !== FORM_FEED &&
      byte !== VERTICAL_TAB
    ) {
      return true;
    }
  }
  return false;
}
