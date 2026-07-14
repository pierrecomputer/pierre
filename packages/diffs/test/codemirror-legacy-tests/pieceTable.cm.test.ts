import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../../src/editor/pieceTable';
import { TextDocument } from '../../src/editor/textDocument';
import type { Position } from '../../src/types';

// Rope/buffer semantics harvested from CodeMirror 6's Text tests (cm-state
// test-text.ts) and re-expressed against PieceTable and TextDocument. CM
// addresses documents by flat offsets; scenarios here are translated to
// 0-based {line, character} positions. See README.md for provenance.

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

// Deterministic LCG, same shape as the fuzz driver in editorPieceTable.test.ts.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Independent line-splitting oracle: `\n`, lone `\r`, and `\r\n` (counted as
// ONE break) — the same policy as computeLineOffsets. Returns the start offset
// of every line.
function oracleLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      starts.push(i + 1);
    } else if (code === 13) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        i++; // \r\n is a single break
      }
      starts.push(i + 1);
    }
  }
  return starts;
}

// Offset-faithful position mapping (PieceTable semantics): the line containing
// the offset, with the raw column — even when that column points into the
// line's terminating break.
function oraclePositionAt(text: string, offset: number): Position {
  const clamped = Math.min(Math.max(offset, 0), text.length);
  const starts = oracleLineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= clamped) {
    line++;
  }
  return { line, character: clamped - starts[line] };
}

// End offset of a line's visible content (trailing CR/LF trimmed), matching
// getLineLength(line) === contentEnd - starts[line].
function oracleContentEnd(
  text: string,
  starts: number[],
  line: number
): number {
  const spanEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
  let end = spanEnd;
  while (end > starts[line]) {
    const code = text.charCodeAt(end - 1);
    if (code !== 10 && code !== 13) {
      break;
    }
    end--;
  }
  return end;
}

// Full line-metadata cross-check against the oracle: line count, positionAt at
// every offset, and offsetAt at every line's boundaries (including the
// past-the-span clamp).
function expectLinePositionsToMatchOracle(
  table: PieceTable,
  text: string
): void {
  const starts = oracleLineStarts(text);
  expect(table.lineCount).toBe(starts.length);
  for (let offset = 0; offset <= text.length; offset++) {
    expect(table.positionAt(offset)).toEqual(oraclePositionAt(text, offset));
  }
  for (let line = 0; line < starts.length; line++) {
    const spanEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
    const span = spanEnd - starts[line];
    expect(table.offsetAt({ line, character: 0 })).toBe(starts[line]);
    expect(table.offsetAt({ line, character: span })).toBe(spanEnd);
    expect(table.offsetAt({ line, character: span + 9 })).toBe(spanEnd);
  }
}

function buildRandomSingleLine(length: number, seed: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  const random = createRandom(seed);
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(alphabet[Math.floor(random() * alphabet.length)]);
  }
  return chars.join('');
}

// Mixed line endings: a \r\n pair, lone \r breaks, a \r\r\n run (lone \r
// followed by a \r\n pair), a bare \n, and a second \r\n pair.
// Lines: 'ivy\r\n' 'oak\r' 'elm\r' '\r\n' 'fig\r' '\r' 'ash\n' '\r\n' 'end'
// Line starts: [0, 5, 9, 13, 15, 19, 20, 24, 26]; length 29.
// Offsets 4, 14, and 25 sit between the \r and \n of a CRLF pair.
const MIXED = 'ivy\r\noak\relm\r\r\nfig\r\rash\n\r\nend';

describe('mixed-EOL positionAt/offsetAt round trip (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  test('PieceTable: offsetAt of positionAt is the identity at every offset, even inside CRLF pairs', () => {
    // DIVERGENCE: CM (and VS Code) never let a line lookup land between the
    // \r and \n of a CRLF pair — positions snap to a break boundary.
    // PieceTable is offset-faithful instead: positionAt reports the raw split
    // point and its own offsetAt maps it straight back, so the round trip is
    // the identity and trivially idempotent. Self-consistent at this layer;
    // the clamp policy lives one layer up in TextDocument.normalizePosition.
    const table = new PieceTable(MIXED);

    expectLinePositionsToMatchOracle(table, MIXED);
    for (let offset = 0; offset <= MIXED.length; offset++) {
      expect(table.offsetAt(table.positionAt(offset))).toBe(offset);
    }
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  test('PieceTable.positionAt reports offsets between \\r and \\n faithfully', () => {
    // DIVERGENCE: these positions point strictly inside a CRLF pair — their
    // character exceeds the line's visible content length. CM cannot produce
    // them; PieceTable does, by design (see the identity round trip above).
    const table = new PieceTable(MIXED);

    expect(table.positionAt(4)).toEqual({ line: 0, character: 4 });
    expect(table.getLineLength(0)).toBe(3);
    expect(table.positionAt(14)).toEqual({ line: 3, character: 1 });
    expect(table.getLineLength(3)).toBe(0);
    expect(table.positionAt(25)).toEqual({ line: 7, character: 1 });
    expect(table.getLineLength(7)).toBe(0);
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  // KNOWN BUG: TextDocument.positionAt delegates to the raw piece-table
  // mapping and can return a position strictly inside a CRLF pair (character
  // beyond getLineLength) that its own offsetAt refuses to map back —
  // normalizePosition clamps it to the line's content end, so
  // offsetAt(positionAt(o)) silently loses a column. The commented-out clamp
  // tests at editorTextDocument.test.ts:150 and :169 record the intended
  // contract (positions clamp to visible content at this layer).
  test.failing(
    'TextDocument.positionAt never lands between the \\r and \\n of a CRLF pair',
    () => {
      const d = doc(MIXED);

      for (let offset = 0; offset <= MIXED.length; offset++) {
        const position = d.positionAt(offset);
        expect(position.character).toBeLessThanOrEqual(
          d.getLineLength(position.line)
        );
      }
    }
  );

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  test('TextDocument: offsetAt of positionAt is idempotent and snaps break-interior offsets to content end', () => {
    // Unlike the PieceTable layer, the TextDocument round trip is not the
    // identity: offsets between the \r and \n of a CRLF pair snap back to the
    // end of the line's visible content (offsetAt normalizes what positionAt
    // emitted). The mapping settles after one application — a second round
    // trip is a fixpoint — which is the stability CM guarantees for its
    // line/offset conversions.
    const d = doc(MIXED);
    const starts = oracleLineStarts(MIXED);
    const roundTrip = (offset: number) => d.offsetAt(d.positionAt(offset));

    for (let offset = 0; offset <= MIXED.length; offset++) {
      const { line } = oraclePositionAt(MIXED, offset);
      const expected = Math.min(offset, oracleContentEnd(MIXED, starts, line));
      const once = roundTrip(offset);
      expect(once).toBe(expected);
      expect(roundTrip(once)).toBe(once);
    }
    // The three break-interior offsets are the only ones that move.
    expect(roundTrip(4)).toBe(3);
    expect(roundTrip(14)).toBe(13);
    expect(roundTrip(25)).toBe(24);
  });
});

describe('out-of-range line and position contract (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by line number"
  test('PieceTable.offsetAt: negative line maps to 0, line at or past lineCount throws', () => {
    // DIVERGENCE: CM throws "Invalid line" on BOTH sides (line(0) and
    // line(lines + 1) with its 1-based lines). PieceTable is asymmetric on a
    // non-empty document: a negative line silently returns offset 0, while a
    // line at or past lineCount throws.
    const table = new PieceTable('fern\nmoss\nreed');

    expect(table.lineCount).toBe(3);
    expect(table.offsetAt({ line: -1, character: 0 })).toBe(0);
    expect(table.offsetAt({ line: -5, character: 7 })).toBe(0);
    expect(() => table.offsetAt({ line: 3, character: 0 })).toThrow(
      'Line index out of range: 3'
    );
    expect(() => table.offsetAt({ line: 99, character: 0 })).toThrow(
      'Line index out of range: 99'
    );
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  test('TextDocument.offsetAt silently clamps every out-of-range position', () => {
    // DIVERGENCE: CM's lineAt(-10) and lineAt(length + 1) throw "Invalid
    // position". TextDocument never throws: normalizePosition clamps the line
    // into [0, lineCount) and the character into the line's visible content
    // before resolving, so any position resolves to a valid offset.
    const d = doc('fern\nmoss\nreed');

    // Negative line clamps to line 0; the character still applies (clamped
    // to line 0's content length of 4).
    expect(d.offsetAt({ line: -5, character: 2 })).toBe(2);
    expect(d.offsetAt({ line: -5, character: 99 })).toBe(4);
    // Line past the end clamps to the last line; huge character clamps to
    // document end.
    expect(d.offsetAt({ line: 99, character: 99 })).toBe(14);
    expect(d.offsetAt({ line: 99, character: 0 })).toBe(10);
    // Negative character clamps to the line start.
    expect(d.offsetAt({ line: 1, character: -7 })).toBe(5);
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by line number"
  test('oversized character: PieceTable clamps into the break span, TextDocument to line content', () => {
    // DIVERGENCE (layer contrast): for a character past the end of a line,
    // PieceTable clamps to the line's full span INCLUDING its line break —
    // landing on the next line's start offset — while TextDocument clamps to
    // the visible content end before the break. CM would throw instead.
    const table = new PieceTable('fern\nmoss\nreed');
    const d = doc('fern\nmoss\nreed');

    expect(table.offsetAt({ line: 0, character: 99 })).toBe(5);
    expect(d.offsetAt({ line: 0, character: 99 })).toBe(4);
    expect(table.offsetAt({ line: 1, character: 99 })).toBe(10);
    expect(d.offsetAt({ line: 1, character: 99 })).toBe(9);
    // Last line (no break): both layers agree on document end.
    expect(table.offsetAt({ line: 2, character: 99 })).toBe(14);
    expect(d.offsetAt({ line: 2, character: 99 })).toBe(14);
  });
});

describe('arbitrary-range slices on a fragmented table (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "can retrieve pieces of text"
  test('random getTextSlice ranges match a plain-string oracle', () => {
    // 250 scattered single edits fragment the table into many pieces, then
    // 300 random slices — half short mid-tree spans, half arbitrary spans —
    // must match String.prototype.slice on the oracle. Slices starting
    // mid-tree exercise findPieceAtOffset plus the parent-pointer walk across
    // piece seams.
    const random = createRandom(0x5eed);
    let str = 'harbor lights\nquiet mole\ndrifting boats\nsalt air\n';
    const table = new PieceTable(str);
    const inserts = ['k', 'wz', '\n', '###', 'north\nsouth', ''];

    for (let i = 0; i < 250; i++) {
      if (random() < 0.6) {
        const insert = inserts[Math.floor(random() * inserts.length)];
        const offset = Math.floor(random() * (str.length + 1));
        table.insert(insert, offset);
        str = str.slice(0, offset) + insert + str.slice(offset);
      } else {
        const offset = Math.floor(random() * (str.length + 1));
        const length = Math.floor(random() * 4);
        table.delete(offset, length);
        str = str.slice(0, offset) + str.slice(offset + length);
      }
    }
    expect(table.getText()).toBe(str);

    for (let i = 0; i < 300; i++) {
      const from = Math.floor(random() * (str.length + 1));
      const to =
        i % 2 === 0
          ? Math.min(from + 2 + Math.floor(random() * 6), str.length)
          : from + Math.floor(random() * (str.length - from + 1));
      expect(table.getTextSlice(from, to)).toBe(str.slice(from, to));
    }

    expect(table.getTextSlice(0, str.length)).toBe(str);
    expect(table.getTextSlice(0, 0)).toBe('');
    expect(table.getTextSlice(str.length, str.length)).toBe('');
  });
});

describe('building a document by repeated appends (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "can build up a doc by repeated appending"
  test('600 newline-bearing appends at end of document keep content and line metadata', () => {
    // Every chunk lands at the current end of the document, so sequential
    // appends coalesce into a long run — this exercises TextBuffer.append's
    // offset-shifted lineOffsets bookkeeping through coalesceTwoPieces.
    const table = new PieceTable('');
    let expected = '';
    const lineStartOffsets: number[] = [];

    for (let i = 0; i < 600; i++) {
      const chunk = `item ${i} ok\n`;
      lineStartOffsets.push(expected.length);
      table.insert(chunk, expected.length);
      expected += chunk;
    }

    expect(table.getText()).toBe(expected);
    expect(table.lineCount).toBe(601);

    for (const line of [0, 1, 59, 300, 427, 599]) {
      expect(table.getLineText(line)).toBe(`item ${line} ok`);
      expect(table.offsetAt({ line, character: 0 })).toBe(
        lineStartOffsets[line]
      );
      expect(table.positionAt(lineStartOffsets[line])).toEqual({
        line,
        character: 0,
      });
    }
    expect(table.getLineText(600)).toBe('');

    // Boundary positions: document start, document end (the empty final
    // line), the last break, and the seam just before a sampled line start.
    expect(table.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(table.positionAt(expected.length)).toEqual({
      line: 600,
      character: 0,
    });
    expect(table.positionAt(expected.length - 1)).toEqual({
      line: 599,
      character: 'item 599 ok'.length,
    });
    expect(table.positionAt(lineStartOffsets[300] - 1)).toEqual({
      line: 299,
      character: 'item 299 ok'.length,
    });
    expect(table.offsetAt({ line: 600, character: 0 })).toBe(expected.length);
  });
});

describe('repeated block inserts at one fixed offset (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "rebalances on insert"
  test('12 multi-line ~600-char blocks at a fixed middle offset keep content and positions', () => {
    // Each insert lands at the same document offset, so every new block sits
    // BEFORE the previously inserted one and nothing can coalesce —
    // worst-case single-seam fragmentation. Blocks carry their iteration
    // number so the expected ordering (newest first) is actually verified.
    const baseLines: string[] = [];
    for (let i = 0; i < 30; i++) {
      baseLines.push(`ln${String(i).padStart(2, '0')}:` + 'x'.repeat(12));
    }
    const base = baseLines.join('\n');
    const mid = Math.floor(base.length / 2);
    const block = (i: number) =>
      `<b${String(i).padStart(2, '0')}>qrstuvwxyz\n`.repeat(38);

    const table = new PieceTable(base);
    let middle = '';
    for (let i = 0; i < 12; i++) {
      table.insert(block(i), mid);
      middle = block(i) + middle;
    }
    const expected = base.slice(0, mid) + middle + base.slice(mid);

    expect(table.getText()).toBe(expected);
    expectLinePositionsToMatchOracle(table, expected);
  });
});

describe('slice bound clipping (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "clips out-of-range boundaries"
  test('reversed, negative, and out-of-range slice bounds return the empty string', () => {
    const table = new PieceTable('grape\nmelon');

    expect(table.getTextSlice(5, 0)).toBe('');
    expect(table.getTextSlice(0, -10)).toBe('');
    expect(table.getTextSlice(-5, 0)).toBe('');
    expect(table.getTextSlice(1000, 1100)).toBe('');
    expect(table.getTextSlice(11, 11)).toBe('');
    // Partially out-of-range bounds clamp instead of clearing.
    expect(table.getTextSlice(3, 999)).toBe('pe\nmelon');
    expect(table.getTextSlice(-4, 4)).toBe('grap');

    const empty = new PieceTable('');
    expect(empty.getTextSlice(0, 10)).toBe('');
    expect(empty.getTextSlice(1000, 1100)).toBe('');
    expect(empty.getTextSlice(-5, 5)).toBe('');
    expect(empty.getTextSlice(5, 0)).toBe('');

    // TextDocument.getTextSlice delegates without extra clamping.
    const d = doc('grape\nmelon');
    expect(d.getTextSlice(5, 0)).toBe('');
    expect(d.getTextSlice(1000, 1100)).toBe('');
    expect(doc('').getTextSlice(1000, 1100)).toBe('');
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "clips out-of-range boundaries"
  test('TextDocument.getText returns empty for an inverted range while applyEdits swaps it', () => {
    // DIVERGENCE (layer contrast): CM clips inverted slice bounds to empty
    // and rejects inverted change ranges outright. pierre-fe reads and writes
    // disagree with each other by design: getText with an inverted range
    // resolves to a reversed offset pair and yields '', but applyEdits swaps
    // the inverted start/end (#resolveEdit) and applies the replacement.
    const d = doc('plum\npear');

    expect(
      d.getText({
        start: { line: 1, character: 3 },
        end: { line: 0, character: 2 },
      })
    ).toBe('');

    d.applyEdits([
      {
        range: {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 1 },
        },
        newText: 'LUM',
      },
    ]);
    expect(d.getText()).toBe('pLUM\npear');
  });
});

describe('very long single line (codemirror-legacy)', () => {
  // codemirror-legacy: cm-state/test/test-text.ts — "properly maintains content during editing"
  // (adapted: 50k chars with zero line breaks, fragmented, then split in two)
  test('PieceTable: a fragmented 50k-char line keeps single-line metadata until the first \\n', () => {
    let str = buildRandomSingleLine(50_000, 0xfab1e);
    const table = new PieceTable(str);
    const random = createRandom(0x10c);

    // Fragment the line with newline-free edits; the tree ends up with many
    // pieces whose subtreeLineBreakCount is 0 everywhere.
    for (let i = 0; i < 40; i++) {
      const insertOffset = Math.floor(random() * (str.length + 1));
      table.insert('QZJ', insertOffset);
      str = str.slice(0, insertOffset) + 'QZJ' + str.slice(insertOffset);
      const deleteOffset = Math.floor(random() * str.length);
      table.delete(deleteOffset, 2);
      str = str.slice(0, deleteOffset) + str.slice(deleteOffset + 2);
    }

    expect(table.getText()).toBe(str);
    expect(table.lineCount).toBe(1);
    expect(table.getLineLength(0)).toBe(str.length);
    expect(table.getLineLength(0, true)).toBe(str.length);

    for (const offset of [0, 1, 7, 4_999, 25_000, str.length - 1, str.length]) {
      expect(table.positionAt(offset)).toEqual({ line: 0, character: offset });
      expect(table.offsetAt({ line: 0, character: offset })).toBe(offset);
    }
    // Huge values clamp to the line/document end.
    expect(table.positionAt(str.length + 12_345)).toEqual({
      line: 0,
      character: str.length,
    });
    expect(table.offsetAt({ line: 0, character: 2 ** 31 })).toBe(str.length);

    // The FIRST line break splits the document into exactly two lines.
    const splitAt = Math.floor(str.length / 2);
    table.insert('\n', splitAt);
    expect(table.lineCount).toBe(2);
    expect(table.getLineLength(0)).toBe(splitAt);
    expect(table.getLineText(0)).toBe(str.slice(0, splitAt));
    expect(table.getLineText(1)).toBe(str.slice(splitAt));
    expect(table.positionAt(splitAt)).toEqual({ line: 0, character: splitAt });
    expect(table.positionAt(splitAt + 1)).toEqual({ line: 1, character: 0 });
    expect(table.offsetAt({ line: 1, character: 0 })).toBe(splitAt + 1);
    expect(table.positionAt(str.length + 1)).toEqual({
      line: 1,
      character: str.length - splitAt,
    });
  });

  // codemirror-legacy: cm-state/test/test-text.ts — "can get line info by position"
  // (adapted: huge character values against a single 50k-char line)
  test('TextDocument: huge positions clamp on the long line and the first \\n splits it', () => {
    let str = buildRandomSingleLine(50_000, 0xace1);
    const d = doc(str);
    const insertPlain = (offset: number, text: string) => {
      d.applyEdits([
        {
          range: {
            start: { line: 0, character: offset },
            end: { line: 0, character: offset },
          },
          newText: text,
        },
      ]);
      str = str.slice(0, offset) + text + str.slice(offset);
    };

    insertPlain(41_000, 'PQ');
    insertPlain(17, 'RS');
    insertPlain(23_456, 'TU');

    expect(d.lineCount).toBe(1);
    expect(d.getLineLength(0)).toBe(str.length);
    expect(d.positionAt(10 ** 9)).toEqual({
      line: 0,
      character: str.length,
    });
    expect(d.offsetAt({ line: 0, character: 10 ** 9 })).toBe(str.length);
    // An out-of-range line clamps to the single line 0, where character 99 is
    // perfectly valid on a 50k-char line.
    expect(d.offsetAt({ line: 99, character: 99 })).toBe(99);
    expect(d.offsetAt({ line: 99, character: 10 ** 9 })).toBe(str.length);

    const splitAt = 30_000;
    insertPlain(splitAt, '\n');
    expect(d.lineCount).toBe(2);
    expect(d.getLineLength(0)).toBe(splitAt);
    expect(d.getLineText(0)).toBe(str.slice(0, splitAt));
    expect(d.getLineText(1)).toBe(str.slice(splitAt + 1));
    expect(d.positionAt(splitAt + 1)).toEqual({ line: 1, character: 0 });
    expect(d.offsetAt({ line: 1, character: 0 })).toBe(splitAt + 1);
    expect(d.getText()).toBe(str);
  });
});
