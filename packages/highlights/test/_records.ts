import type { HighlightsHighlighter } from '../lib/highlighter';

/** A raw byte-offset run retained as an independent line-splitting oracle. */
export type StyleRun = [number, number, number];

/** Read raw byte records from the test-only Wasm entry before line conversion. */
export function tokenizeRecords(
  highlighter: HighlightsHighlighter,
  langId: number,
  inputLength: number
): Uint32Array {
  highlighter.dv.setUint8(0, langId);
  highlighter.dv.setUint8(1, 3);
  highlighter.dv.setUint32(2, inputLength, true);
  highlighter.buffer[65536 + inputLength] = 0;
  try {
    (highlighter.instance.exports.highlightByteRecords as () => void)();
  } finally {
    highlighter.bindMemory();
  }
  return new Uint32Array(
    highlighter.memory.buffer,
    highlighter.dv.getUint32(6, true),
    highlighter.dv.getUint32(10, true) >> 2
  );
}

/**
 * Split `(end, tokenId)` records into per-line style runs.
 *
 * A positive `maxLineLength` matches Shiki's `tokenizeMaxLineLength`: lines at
 * or above the limit become one unthemed run to avoid creating too many spans.
 */
export function splitRecordLines(
  code: string,
  recs: Uint32Array,
  count: number,
  resume?: { byte: number; char: number },
  maxLineLength?: number
): StyleRun[][] {
  const lines: StyleRun[][] = [];
  let line: StyleRun[] = [];
  let byte = resume?.byte ?? 0;
  let char = resume?.char ?? 0;
  // Start of the line being built; resume positions are line starts.
  let lineStart = char;
  const max = maxLineLength ?? 0;
  // Finish the pending line at endChar, excluding its terminator.
  const endLine = (endChar: number) => {
    lines.push(
      max > 0 && endChar - lineStart >= max ? [[lineStart, endChar, 0]] : line
    );
    line = [];
  };
  // Records are sorted by end; binary-search the first end greater than `byte`.
  let rec = 0;
  if (byte > 0) {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (recs[mid * 2] > byte) hi = mid;
      else lo = mid + 1;
    }
    rec = lo;
  }
  const ascii = isAscii(code, byte, char, recs, count);
  // The resume point includes any multibyte prefix. Its byte-to-UTF-16 delta
  // converts record byte ends to string offsets.
  const charDelta = char - byte;
  for (; rec < count; rec++) {
    const bEnd = recs[rec * 2];
    if (bEnd <= byte) continue;
    const hl = recs[rec * 2 + 1];
    let cEnd;
    if (ascii) {
      cEnd = bEnd + charDelta;
    } else {
      cEnd = char;
      let b = byte;
      while (b < bEnd) {
        const cp = code.codePointAt(cEnd) ?? 0;
        if (cp <= 0x7f) b += 1;
        else if (cp <= 0x7ff) b += 2;
        else if (cp <= 0xffff) b += 3;
        else b += 4;
        cEnd += cp > 0xffff ? 2 : 1;
      }
    }
    // Split records that cross line endings.
    let start = char;
    for (;;) {
      const nl = code.indexOf('\n', start);
      if (nl === -1 || nl >= cEnd) break;
      let cut = nl;
      if (cut > start && code.charCodeAt(cut - 1) === 13) cut--;
      if (cut > start) line.push([start, cut, hl]);
      endLine(cut);
      lineStart = nl + 1;
      start = nl + 1;
    }
    if (cEnd > start) line.push([start, cEnd, hl]);
    byte = bEnd;
    char = cEnd;
  }
  endLine(char);
  return lines;
}

/**
 * Check the remaining range for ASCII in O(1).
 *
 * The final record ends at the input byte length. Equal remaining byte and
 * UTF-16 lengths mean the offsets also match, so no character walk is needed.
 */
function isAscii(
  code: string,
  byte: number,
  char: number,
  recs: Uint32Array,
  count: number
): boolean {
  if (count === 0) return true;
  return recs[(count - 1) * 2] - byte === code.length - char;
}
