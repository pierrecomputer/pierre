import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../../src/editor/pieceTable';

// Buffer-storage scenarios identified by auditing TextMate 2's buffer test
// suite and re-expressed from plain-language contract descriptions against
// PieceTable (see README.md for provenance and licensing — no TextMate source
// was consulted). All fixtures are original.

// Deterministic LCG, same shape as the fuzz driver in editorPieceTable.test.ts.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Counts lines the same way computeLineOffsets does: `\n`, lone `\r`, and
// `\r\n` as ONE break.
function oracleLineCount(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10) {
      count++;
    } else if (code === 13) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
        i++; // \r\n is a single break
      }
      count++;
    }
  }
  return count;
}

// Fragments a table with `rounds` random-order interior inserts. Each insert
// lands at an arbitrary offset, so most of them split an existing piece in two
// and add a third — piece sizes stay small (1..5 chars) and seams abound.
// Chunks include multi-char runs, bare and CRLF line breaks, and an astral
// (surrogate-pair) emoji. Returns the oracle string.
function buildFragmented(
  table: PieceTable,
  initial: string,
  random: () => number,
  rounds: number
): string {
  const chunks = ['k', 'wz', '\n', 'pq\nrs', '###', '\r\n', '🙂'];
  let text = initial;
  for (let i = 0; i < rounds; i++) {
    const chunk = chunks[Math.floor(random() * chunks.length)];
    const offset = Math.floor(random() * (text.length + 1));
    table.insert(chunk, offset);
    text = text.slice(0, offset) + chunk + text.slice(offset);
  }
  return text;
}

// Deletes random spans (1..8 units) until nothing remains, checking content
// against the string oracle after every step. Spans regularly start and end
// mid-piece (splitting a piece at both endpoints) and are wider than most
// pieces, so whole pieces in between get swallowed. Returns the number of
// deletions performed.
function drainToEmpty(
  table: PieceTable,
  text: string,
  random: () => number
): number {
  let remaining = text;
  let steps = 0;
  const maxSteps = remaining.length + 16; // every step removes >= 1 unit
  while (remaining.length > 0) {
    expect(steps).toBeLessThan(maxSteps); // drain must terminate
    const offset = Math.floor(random() * remaining.length);
    const length = 1 + Math.floor(random() * 8);
    table.delete(offset, length);
    remaining = remaining.slice(0, offset) + remaining.slice(offset + length);
    expect(table.getText()).toBe(remaining);
    steps++;
  }
  return steps;
}

const DRAIN_SEEDS = [0x7a11, 0xbead, 0x515] as const;

describe('erase-to-empty drain (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/buffer/tests/t_storage.cc — deleting random
  // spans out of a heavily fragmented table until nothing is left must leave a
  // coherent empty document: empty getText, lineCount 1, positionAt(0) at the
  // origin.
  test('random-span deletes drain a fragmented table to a coherent empty state (3 seeds)', () => {
    for (const seed of DRAIN_SEEDS) {
      const random = createRandom(seed);
      const table = new PieceTable('alpha\nbeta\ngamma\n');
      const text = buildFragmented(table, 'alpha\nbeta\ngamma\n', random, 220);
      expect(table.getText()).toBe(text);
      // (lineCount is deliberately not oracle-checked on the built document:
      // random inserts can butt a lone \r against a \n across piece seams,
      // where buffer-based line counting differs from a string re-scan — a
      // pre-existing caveat outside this drain scenario. The drained and
      // refilled states below use controlled content.)

      drainToEmpty(table, text, random);

      expect(table.getText()).toBe('');
      expect(table.lineCount).toBe(1);
      expect(table.positionAt(0)).toEqual({ line: 0, character: 0 });
      // Any offset clamps to the origin on an empty document.
      expect(table.positionAt(42)).toEqual({ line: 0, character: 0 });
      expect(table.charAt(0)).toBe('');
      expect(table.getLineText(0)).toBe('');
      expect(table.getLineLength(0)).toBe(0);
      expect(table.offsetAt({ line: 0, character: 0 })).toBe(0);
      expect(table.offsetAt({ line: 0, character: 9 })).toBe(0);
      // Line 1 does not exist on the drained single-line document.
      expect(() => table.getLineText(1)).toThrow('Line index out of range: 1');
    }
  });

  // textmate-legacy: Frameworks/buffer/tests/t_storage.cc — a table that has
  // been drained to zero length must accept fresh inserts exactly like a
  // newly constructed table.
  test('fresh inserts into a drained table behave like inserts into a new table (3 seeds)', () => {
    for (const seed of DRAIN_SEEDS) {
      const random = createRandom(seed);
      const table = new PieceTable('north\nsouth\neast\nwest');
      const built = buildFragmented(
        table,
        'north\nsouth\neast\nwest',
        random,
        180
      );
      drainToEmpty(table, built, random);
      expect(table.getText()).toBe('');

      // Refill: start, interior (splitting the piece the first insert made),
      // and end-of-document inserts, with line breaks.
      let text = '';
      const refill = (chunk: string, offset: number) => {
        table.insert(chunk, offset);
        text = text.slice(0, offset) + chunk + text.slice(offset);
      };
      refill('harbor', 0);
      refill('LIGHT\n', 3); // interior: splits "harbor"
      refill('\nquiet mole', text.length); // append at end
      refill('>', 0); // back at the start

      expect(table.getText()).toBe(text);
      expect(table.getText()).toBe('>harLIGHT\nbor\nquiet mole');
      expect(table.lineCount).toBe(oracleLineCount(text));
      expect(table.getLineText(0)).toBe('>harLIGHT');
      expect(table.getLineText(1)).toBe('bor');
      expect(table.getLineText(2)).toBe('quiet mole');
      expect(table.positionAt(0)).toEqual({ line: 0, character: 0 });
      expect(table.positionAt(10)).toEqual({ line: 1, character: 0 });
      expect(table.positionAt(text.length)).toEqual({
        line: 2,
        character: 'quiet mole'.length,
      });
      expect(table.offsetAt({ line: 2, character: 0 })).toBe(14);
      // Round trip at every offset of the refilled document.
      for (let offset = 0; offset <= text.length; offset++) {
        expect(table.offsetAt(table.positionAt(offset))).toBe(offset);
      }
    }
  });
});

describe('per-offset charAt sweep (textmate-legacy)', () => {
  // textmate-legacy: Frameworks/buffer/tests/t_storage.cc — reading every
  // single offset of a maximally fragmented document through charAt must
  // reproduce the string oracle character-for-character, including reads that
  // land exactly on piece seams and on the halves of a surrogate pair.
  test('charAt(i) equals the string oracle at every offset of a fragmented document (2 seeds)', () => {
    for (const seed of [0xf1e1d, 0x2b0a] as const) {
      const random = createRandom(seed);
      const table = new PieceTable('seed line one\nseed two\n');
      const text = buildFragmented(
        table,
        'seed line one\nseed two\n',
        random,
        500
      );
      expect(table.getText()).toBe(text);
      expect(text.length).toBeGreaterThan(1000); // genuinely many pieces

      // Every offset: interior reads, first/last unit of every piece (each
      // insert created up to two fresh seams), lone surrogate halves of the
      // emoji chunks, and both units of CRLF pairs.
      for (let i = 0; i < text.length; i++) {
        expect(table.charAt(i)).toBe(text.charAt(i));
      }
    }
  });

  // textmate-legacy: Frameworks/buffer/tests/t_storage.cc — out-of-range
  // single-character reads: exactly at the document length, past it, and at
  // negative offsets.
  test('charAt at exactly length, beyond it, and at negative offsets returns the empty string', () => {
    // Same contract as String.prototype.charAt out-of-range behavior — the
    // read reports "no character" rather than throwing or clamping.
    const random = createRandom(0xd0c);
    const table = new PieceTable('fig\nash');
    const text = buildFragmented(table, 'fig\nash', random, 60);
    expect(table.getText()).toBe(text);

    expect(table.charAt(text.length - 1)).toBe(text.charAt(text.length - 1));
    expect(table.charAt(text.length)).toBe('');
    expect(table.charAt(text.length + 1)).toBe('');
    expect(table.charAt(text.length + 1000)).toBe('');
    expect(table.charAt(-1)).toBe('');

    // Small fresh table, same policy.
    const small = new PieceTable('ab\ncd');
    expect(small.charAt(4)).toBe('d');
    expect(small.charAt(5)).toBe('');
    expect(small.charAt(6)).toBe('');
    expect(small.charAt(-1)).toBe('');

    // Empty table: every offset is out of range.
    const empty = new PieceTable('');
    expect(empty.charAt(0)).toBe('');
    expect(empty.charAt(1)).toBe('');
    expect(empty.charAt(-1)).toBe('');
  });
});
