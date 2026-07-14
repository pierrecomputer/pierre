import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../src/editor/pieceTable';
import { TextDocument } from '../src/editor/textDocument';
import type { Position } from '../src/types';

function lineTexts(text: string): string[] {
  if (text === '') {
    return [''];
  }

  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start <= text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

/** Trailing CR/LF removed, matching `PieceTable.getLineText` / `getTextSlice(..., true)`. */
function trimLineEndings(text: string): string {
  let end = text.length;
  while (end > 0 && isLineEnding(text.charCodeAt(end - 1))) {
    end--;
  }
  return text.slice(0, end);
}

function isLineEnding(c: number): boolean {
  return c === 10 || c === 13;
}

function positionAt(text: string, offset: number): Position {
  const clampedOffset = Math.min(Math.max(offset, 0), text.length);
  let line = 0;
  let lineStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 10) {
      continue;
    }

    const lineEnd = i + 1;
    if (clampedOffset < lineEnd) {
      return { line, character: clampedOffset - lineStart };
    }
    line++;
    lineStart = lineEnd;
  }

  return {
    line,
    character: clampedOffset - lineStart,
  };
}

function offsetAt(text: string, position: Position): number {
  if (position.line < 0 || text.length === 0) {
    return 0;
  }

  const lines = lineTexts(text);
  if (position.line >= lines.length) {
    return text.length;
  }

  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    offset += lines[i].length;
  }

  const lineLength = lines[position.line].length;
  return offset + Math.min(Math.max(position.character, 0), lineLength);
}

function expectTableToMatchText(table: PieceTable, text: string): void {
  const lines = lineTexts(text);

  expect(table.getText()).toBe(text);
  expect(table.lineCount).toBe(lines.length);

  for (let line = 0; line < lines.length; line++) {
    expect(table.getLineText(line)).toBe(trimLineEndings(lines[line]));
  }

  for (let offset = 0; offset <= text.length; offset++) {
    expect(table.positionAt(offset)).toEqual(positionAt(text, offset));
  }

  for (let line = 0; line < lines.length; line++) {
    const lineLength = lines[line].length;
    for (let character = 0; character <= lineLength; character++) {
      expect(table.offsetAt({ line, character })).toBe(
        offsetAt(text, { line, character })
      );
    }
  }
}

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Reference implementation of `PieceTable.applyEdits` on a plain string: edits
 * are sorted ascending and applied with a moving copy cursor, so overlapping or
 * out-of-order edits clamp the same way the piece table does.
 */
function applyEditsToString(
  text: string,
  edits: { start: number; end: number; text: string }[]
): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of sorted) {
    const start = Math.min(Math.max(edit.start, cursor), text.length);
    const end = Math.min(Math.max(edit.end, start), text.length);
    out += text.slice(cursor, start) + edit.text;
    cursor = end;
  }
  return out + text.slice(cursor);
}

describe('PieceTable', () => {
  test('returns the original text', () => {
    const table = new PieceTable('hello');

    expect(table.getText()).toBe('hello');
    expect(table.lineCount).toBe(1);
  });

  test('reads text ranges by positions', () => {
    const table = new PieceTable('aa\nbb\ncc');

    expect(
      table.getText({
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      })
    ).toBe('bb');
  });

  test('getLineText omits trailing CR/LF', () => {
    const table = new PieceTable('first\r\nsecond\n');

    expect(table.getLineText(0)).toBe('first');
    expect(table.getLineText(1)).toBe('second');
    expect(table.getLineText(2)).toBe('');
    expect(() => table.getLineText(99)).toThrow('Line index out of range: 99');
  });

  test('getLineLength matches getLineText without slicing', () => {
    const table = new PieceTable('first\r\nsecond\n');

    expect(table.getLineLength(0)).toBe(table.getLineText(0).length);
    expect(table.getLineLength(1)).toBe(table.getLineText(1).length);
    expect(table.getLineLength(2)).toBe(0);
    expect(table.getLineLength(0, true)).toBe(7);
    expect(table.getLineLength(1, true)).toBe(7);
    expect(() => table.getLineLength(99)).toThrow(
      'Line index out of range: 99'
    );
  });

  test('maps between offsets and positions', () => {
    const table = new PieceTable('ab\nc');

    expect(table.positionAt(0)).toEqual({ line: 0, character: 0 });
    expect(table.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(table.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(table.positionAt(table.getText().length)).toEqual({
      line: 1,
      character: 1,
    });
    expect(table.offsetAt({ line: 1, character: 0 })).toBe(3);
    expect(table.offsetAt({ line: 1, character: 99 })).toBe(4);
  });

  test('inserts at the start, middle, and end', () => {
    const table = new PieceTable('bc');

    table.insert('a', 0);
    table.insert('X', 2);
    table.insert('d', table.getText().length);

    expect(table.getText()).toBe('abXcd');
  });

  test('deletes across original and added pieces', () => {
    const table = new PieceTable('hello world');

    table.insert(' brave', 5);
    table.delete(5, 6);

    expect(table.getText()).toBe('hello world');
  });

  test('handles mixed edits over multiple lines', () => {
    const table = new PieceTable('one\ntwo\nthree');

    table.insert(' zero', 3);
    table.delete(9, 3);
    table.insert('TWO', table.offsetAt({ line: 1, character: 0 }));

    expect(table.getText()).toBe('one zero\nTWO\nthree');
    expect(table.lineCount).toBe(3);
    expect(table.getLineText(1)).toBe('TWO');
  });

  test('handles CRLF split across piece boundaries', () => {
    const table = new PieceTable('a\r\nb');

    table.insert('X', 2);
    table.delete(2, 1);

    expect(table.getText()).toBe('a\r\nb');
    expect(table.lineCount).toBe(2);
    expect(table.getLineText(0)).toBe('a');
    expect(table.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(table.positionAt(3)).toEqual({ line: 1, character: 0 });
  });

  test('handles an empty document', () => {
    const table = new PieceTable('');

    expect(table.getText()).toBe('');
    expect(table.lineCount).toBe(1);
    expect(table.getLineText(0)).toBe('');
    expect(table.positionAt(99)).toEqual({ line: 0, character: 0 });
    expect(table.offsetAt({ line: 99, character: 99 })).toBe(0);
  });

  test('clamps insert and delete offsets', () => {
    const table = new PieceTable('middle');

    table.insert('start-', -10);
    table.insert('-end', 999);
    table.delete(-10, 6);
    table.delete(6, 999);

    expectTableToMatchText(table, 'middle');
  });

  test('reads ranges spanning original and added pieces', () => {
    const table = new PieceTable('abcd');

    table.insert('XX', 2);

    expectTableToMatchText(table, 'abXXcd');
    expect(
      table.getText({
        start: { line: 0, character: 1 },
        end: { line: 0, character: 5 },
      })
    ).toBe('bXXc');
  });

  test('reads single characters from piece boundaries', () => {
    const table = new PieceTable('ab\nef');

    table.insert('CD', 3);

    expect(table.charAt(0)).toBe('a');
    expect(table.charAt(3)).toBe('C');
    expect(table.charAt(4)).toBe('D');
    expect(table.charAt(5)).toBe('e');
    expect(table.charAt(-1)).toBe('');
    expect(table.charAt(table.getText().length)).toBe('');
  });

  test('searches text across piece boundaries', () => {
    const table = new PieceTable('a\nb');

    table.insert('\r', 1);

    expect(table.includes('\r\n')).toBe(true);
    expect(table.includes('missing')).toBe(false);
    expect(table.includes('')).toBe(true);
  });

  test('finds the next non-overlapping match across piece boundaries', () => {
    const table = new PieceTable('foo x fo');

    table.insert('o foo', table.getText().length);

    expect(table.findNextNonOverlappingSubstring('foo', [[0, 3]])).toBe(6);
    expect(
      table.findNextNonOverlappingSubstring('foo', [
        [0, 3],
        [6, 9],
      ])
    ).toBe(10);
    expect(
      table.findNextNonOverlappingSubstring('foo', [
        [6, 9],
        [10, 13],
      ])
    ).toBe(0);
    expect(
      table.findNextNonOverlappingSubstring('foo', [
        [0, 3],
        [6, 9],
        [10, 13],
      ])
    ).toBeUndefined();
  });

  test('search returns every match across lines with one reused pattern', () => {
    // Two matches share line 1 (offsets advance within the line) while lines 0
    // and 2 match from their start (the pattern resets between lines). This is
    // the behavior that must hold when the compiled regex is reused per line
    // instead of recompiled.
    const table = new PieceTable('foo\nfoofoo\nbar foo');
    const searchParams = {
      text: 'foo',
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    expect(table.search(searchParams)).toEqual([
      [0, 3],
      [4, 7],
      [7, 10],
      [15, 18],
    ]);
  });

  test('search does not match newline-spanning plain queries', () => {
    const table = new PieceTable('foo\nbar\nfoo');
    const searchParams = {
      text: 'foo\nbar',
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    expect(table.search(searchParams)).toEqual([]);
  });

  test('search does not match literal newline regex patterns', () => {
    const table = new PieceTable('foo\nbar\nfoo');
    const searchParams = {
      text: 'foo\\nbar',
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    };

    expect(table.search(searchParams)).toEqual([]);
  });

  test('tracks trailing newline as an empty final line', () => {
    const table = new PieceTable('a\n');

    expectTableToMatchText(table, 'a\n');
    expect(table.getLineText(1)).toBe('');
    expect(table.positionAt(2)).toEqual({ line: 1, character: 0 });
  });

  test('updates line metadata for inserted multiline text', () => {
    const table = new PieceTable('before\nafter');

    table.insert('\ninserted\r\nlines', 6);

    expectTableToMatchText(table, 'before\ninserted\r\nlines\nafter');
  });

  test('deletes across several pieces', () => {
    const table = new PieceTable('0123456789');

    table.insert('aa', 2);
    table.insert('bb', 6);
    table.insert('cc', 12);
    table.delete(0, table.getText().length - 1);

    expectTableToMatchText(table, '9');
  });

  test('deletes all content', () => {
    const table = new PieceTable('a\nb');

    table.insert('c', 1);
    table.delete(0, table.getText().length);

    expectTableToMatchText(table, '');
    expect(table.getLineText(0)).toBe('');
  });

  test('matches plain string edits across many insertions and deletions', () => {
    const table = new PieceTable('start\r\nmiddle\nend');
    const random = createRandom(42);
    const inserts = ['a', 'BC', '\n', '\r\nx', '🙂', ''];
    let text = 'start\r\nmiddle\nend';

    for (let i = 0; i < 80; i++) {
      if (random() < 0.6) {
        const insert = inserts[Math.floor(random() * inserts.length)];
        const offset = Math.floor(random() * (text.length + 1));
        table.insert(insert, offset);
        text = text.slice(0, offset) + insert + text.slice(offset);
      } else {
        const offset = Math.floor(random() * (text.length + 1));
        const length = Math.floor(random() * 5);
        table.delete(offset, length);
        text = text.slice(0, offset) + text.slice(offset + length);
      }
    }

    expectTableToMatchText(table, text);
  });

  test('applyEdits applies a single replacement', () => {
    const table = new PieceTable('hello world');

    table.applyEdits([{ start: 6, end: 11, text: 'there' }]);

    expectTableToMatchText(table, 'hello there');
  });

  test('applyEdits applies multiple non-overlapping edits in one pass', () => {
    const table = new PieceTable('one two three');
    const edits = [
      { start: 0, end: 3, text: 'ONE' },
      { start: 4, end: 7, text: '2' },
      { start: 8, end: 13, text: 'III' },
    ];

    table.applyEdits(edits);

    expect(table.getText()).toBe('ONE 2 III');
    expectTableToMatchText(table, applyEditsToString('one two three', edits));
  });

  test('applyEdits mixes inserts, deletes, and replacements', () => {
    const original = 'alpha\nbeta\ngamma';
    const table = new PieceTable(original);
    const edits = [
      { start: 0, end: 0, text: '> ' }, // pure insert
      { start: 6, end: 10, text: '' }, // pure delete ("beta")
      { start: 11, end: 16, text: 'GAMMA' }, // replace ("gamma")
    ];

    table.applyEdits(edits);

    expectTableToMatchText(table, applyEditsToString(original, edits));
  });

  test('applyEdits matches the string oracle across random batched edits', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const random = createRandom(seed * 7 + 3);
      let text = 'function demo() {\n  return 42;\n}\n';
      const table = new PieceTable(text);
      // No lone-`\r`-producing inserts here: the position oracle below splits
      // on `\n` only. CRLF handling is fuzzed separately against the real
      // computeLineOffsets oracle.
      const inserts = ['x', 'YZ', '\n', '  ', '🙂', 'abc'];

      for (let round = 0; round < 60; round++) {
        // Build 1..4 sorted, non-overlapping edits over the current text.
        const editCount = 1 + Math.floor(random() * 4);
        const edits: { start: number; end: number; text: string }[] = [];
        let nextStart = 0;
        for (let i = 0; i < editCount && nextStart <= text.length; i++) {
          const span = Math.max(1, text.length - nextStart);
          const start = Math.min(
            nextStart + Math.floor(random() * span),
            text.length
          );
          const maxDelete = Math.min(4, text.length - start);
          const end = start + Math.floor(random() * (maxDelete + 1));
          const insert =
            random() < 0.5
              ? inserts[Math.floor(random() * inserts.length)]
              : '';
          edits.push({ start, end, text: insert });
          nextStart = end + 1; // keep edits ascending and non-overlapping
        }

        const expected = applyEditsToString(text, edits);
        table.applyEdits(edits);
        expect(table.getText()).toBe(expected);
        text = expected;
      }

      expectTableToMatchText(table, text);
    }
  });

  test('matches the string oracle across many scattered single edits', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const random = createRandom(seed * 131 + 17);
      let text = 'the quick brown fox\njumps over\nthe lazy dog\n';
      const table = new PieceTable(text);
      const inserts = ['q', 'Hi', '\n', '🙂', '', '   '];

      for (let i = 0; i < 600; i++) {
        const roll = random();
        if (roll < 0.55) {
          const insert = inserts[Math.floor(random() * inserts.length)];
          const offset = Math.floor(random() * (text.length + 1));
          table.insert(insert, offset);
          text = text.slice(0, offset) + insert + text.slice(offset);
        } else if (roll < 0.9) {
          const offset = Math.floor(random() * (text.length + 1));
          const length = Math.floor(random() * 6);
          table.delete(offset, length);
          text = text.slice(0, offset) + text.slice(offset + length);
        } else {
          // single-edit applyEdits is the production per-keystroke path
          const offset = Math.floor(random() * (text.length + 1));
          const length = Math.min(
            Math.floor(random() * 4),
            text.length - offset
          );
          const insert = inserts[Math.floor(random() * inserts.length)];
          table.applyEdits([
            { start: offset, end: offset + length, text: insert },
          ]);
          text = text.slice(0, offset) + insert + text.slice(offset + length);
        }
        expect(table.getText()).toBe(text);
      }

      expectTableToMatchText(table, text);
    }
  });

  test('preserves CR/LF content across random edits that split pairs', () => {
    // Edits can slice a `\r\n` pair across a piece boundary, so this stresses
    // the split/merge content path (getText walks pieces in order; getTextSlice
    // uses findPieceAtOffset and parent links). Line counting is buffer-based
    // and pinned by the explicit CRLF tests, so it is not re-derived here.
    for (let seed = 1; seed <= 5; seed++) {
      const random = createRandom(seed * 977 + 5);
      let text = 'a\r\nb\nc\r\n';
      const table = new PieceTable(text);
      const inserts = ['\r\n', '\r', '\n', 'd', 'EF', '\r\ng', ''];

      for (let i = 0; i < 400; i++) {
        if (random() < 0.6) {
          const insert = inserts[Math.floor(random() * inserts.length)];
          const offset = Math.floor(random() * (text.length + 1));
          table.insert(insert, offset);
          text = text.slice(0, offset) + insert + text.slice(offset);
        } else {
          const offset = Math.floor(random() * (text.length + 1));
          const length = Math.floor(random() * 4);
          table.delete(offset, length);
          text = text.slice(0, offset) + text.slice(offset + length);
        }

        expect(table.getText()).toBe(text);
        expect(table.getTextSlice(0, text.length)).toBe(text);
      }
    }
  });
});

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

// Independent line-splitting oracle. Line breaks are `\n`, lone `\r`, and
// `\r\n` counted as ONE break — the same policy as computeLineOffsets, which
// is the buffer-level source of truth the PieceTable is supposed to agree
// with at the document level. Returns the start offset of every line.
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

function oracleOffsetAt(text: string, position: Position): number {
  if (position.line < 0 || text.length === 0) {
    return 0;
  }
  const starts = oracleLineStarts(text);
  const lineStart = starts[position.line];
  const lineEnd =
    position.line + 1 < starts.length ? starts[position.line + 1] : text.length;
  const character = Math.min(
    Math.max(position.character, 0),
    lineEnd - lineStart
  );
  return lineStart + character;
}

// Full line-metadata cross-check: content, line count, and both directions of
// the offset<->position mapping over the entire document.
function expectLineMetadataToMatch(table: PieceTable, text: string): void {
  expect(table.getText()).toBe(text);

  const starts = oracleLineStarts(text);
  expect(table.lineCount).toBe(starts.length);

  for (let offset = 0; offset <= text.length; offset++) {
    expect(table.positionAt(offset)).toEqual(oraclePositionAt(text, offset));
  }

  for (let line = 0; line < starts.length; line++) {
    const lineEnd = line + 1 < starts.length ? starts[line + 1] : text.length;
    for (let character = 0; character <= lineEnd - starts[line]; character++) {
      expect(table.offsetAt({ line, character })).toBe(
        oracleOffsetAt(text, { line, character })
      );
    }
  }
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

describe('PieceTable CRLF and lone-CR line breaks', () => {
  test('lone \\r mixed with \\r\\n breaks reads back byte-for-byte untouched', () => {
    // DIVERGENCE: a model that normalizes line endings would rewrite a lone
    // \r to the document's dominant EOL on read. pierre-fe is diff-oriented
    // and must preserve the original bytes exactly, so getText() returns the
    // lone \r untouched.
    const original = 'north\r\nsouth east\rwest\r\ncenter';
    const table = new PieceTable(original);

    expect(table.getText()).toBe(original);
  });

  test('lone \\r mixed with \\r\\n breaks still counts as its own line break', () => {
    // The other half of the contract: even though the lone \r byte is
    // preserved (see the divergence above), it is still a line break for line
    // counting and position mapping.
    const original = 'north\r\nsouth east\rwest\r\ncenter';
    const table = new PieceTable(original);

    expect(table.lineCount).toBe(4);
    expect(table.getLineText(0)).toBe('north');
    expect(table.getLineText(1)).toBe('south east');
    expect(table.getLineText(2)).toBe('west');
    expect(table.getLineText(3)).toBe('center');
    // Offset 18 sits right after the lone \r: the start of line 2.
    expect(table.positionAt(18)).toEqual({ line: 2, character: 0 });
    expect(table.offsetAt({ line: 2, character: 0 })).toBe(18);
  });

  test('deleting exactly the \\r of a \\r\\n pair leaves a valid \\n break', () => {
    const table = new PieceTable('cat\r\ndog');

    table.delete(3, 1);

    expect(table.getText()).toBe('cat\ndog');
    expect(table.lineCount).toBe(2);
  });

  // KNOWN BUG: deleting the \n out of \r\n leaves a lone \r that the piece's
  // buffer-based line metadata no longer counts as a break (the buffer counted
  // \r\n as one break ending after the \n, which is now outside the piece), so
  // lineCount collapses to 1 even though the text still has two lines.
  test.failing(
    'deleting exactly the \\n of a \\r\\n pair leaves a lone \\r break',
    () => {
      const table = new PieceTable('cat\r\ndog');

      table.delete(4, 1);

      expect(table.getText()).toBe('cat\rdog');
      expect(table.lineCount).toBe(2);
    }
  );

  // KNOWN BUG: a \r and a \n inserted separately land as distinct chunks in
  // the add buffer, each counted as its own line break, so the \r\n pair they
  // form in the document is double-counted and lineCount reads 3 instead of 2.
  test.failing(
    '\\r\\n assembled from two separate inserts counts as one break',
    () => {
      const table = new PieceTable('ab');

      table.insert('\r', 1);
      table.insert('\n', 2);

      expect(table.getText()).toBe('a\r\nb');
      expect(table.lineCount).toBe(2);
    }
  );

  // KNOWN BUG: inserting between the \r and \n of an existing pair splits the
  // piece, but the buffer's line metadata still records one break ending after
  // the \n, so the now-lone \r is not counted and lineCount reads 2 instead of 3.
  test.failing(
    'inserting between \\r and \\n promotes the \\r to its own break',
    () => {
      const table = new PieceTable('a\r\nb');

      table.insert('X', 2);

      expect(table.getText()).toBe('a\rX\nb');
      expect(table.lineCount).toBe(3);
    }
  );

  // KNOWN BUG: CRLF pairs split or formed across piece boundaries corrupt the
  // piece-level line-break counts (see the two directed repros above), so
  // lineCount and positionAt/offsetAt drift from the string oracle under
  // CR/LF-biased editing even while getText() stays correct.
  test.failing(
    'line metadata matches a string oracle across CRLF-biased random edits',
    () => {
      const random = createRandom(20260713);
      const inserts = ['\r', '\n', '\r\n', '\n\r', '\r\nq', 'j\r', 'zz', ''];
      let text = 'aa\r\nbb\ncc\r\ndd';
      const table = new PieceTable(text);

      for (let i = 0; i < 200; i++) {
        if (random() < 0.65) {
          const insert = inserts[Math.floor(random() * inserts.length)];
          const offset = Math.floor(random() * (text.length + 1));
          table.insert(insert, offset);
          text = text.slice(0, offset) + insert + text.slice(offset);
        } else {
          const offset = Math.floor(random() * (text.length + 1));
          const length = Math.floor(random() * 4);
          table.delete(offset, length);
          text = text.slice(0, offset) + text.slice(offset + length);
        }

        expectLineMetadataToMatch(table, text);
      }
    }
  );
});

describe('mixed-EOL positionAt/offsetAt round trip', () => {
  test('PieceTable: offsetAt of positionAt is the identity at every offset, even inside CRLF pairs', () => {
    // DIVERGENCE: conventional editor buffers never let a line lookup land
    // between the \r and \n of a CRLF pair — positions snap to a break
    // boundary. PieceTable is offset-faithful instead: positionAt reports the
    // raw split point and its own offsetAt maps it straight back, so the
    // round trip is the identity and trivially idempotent. Self-consistent at
    // this layer; the clamp policy lives one layer up in
    // TextDocument.normalizePosition.
    const table = new PieceTable(MIXED);

    expectLinePositionsToMatchOracle(table, MIXED);
    for (let offset = 0; offset <= MIXED.length; offset++) {
      expect(table.offsetAt(table.positionAt(offset))).toBe(offset);
    }
  });

  test('PieceTable.positionAt reports offsets between \\r and \\n faithfully', () => {
    // DIVERGENCE: these positions point strictly inside a CRLF pair — their
    // character exceeds the line's visible content length. A boundary-snapping
    // mapping cannot produce them; PieceTable does, by design (see the
    // identity round trip above).
    const table = new PieceTable(MIXED);

    expect(table.positionAt(4)).toEqual({ line: 0, character: 4 });
    expect(table.getLineLength(0)).toBe(3);
    expect(table.positionAt(14)).toEqual({ line: 3, character: 1 });
    expect(table.getLineLength(3)).toBe(0);
    expect(table.positionAt(25)).toEqual({ line: 7, character: 1 });
    expect(table.getLineLength(7)).toBe(0);
  });

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

  test('TextDocument: offsetAt of positionAt is idempotent and snaps break-interior offsets to content end', () => {
    // Unlike the PieceTable layer, the TextDocument round trip is not the
    // identity: offsets between the \r and \n of a CRLF pair snap back to the
    // end of the line's visible content (offsetAt normalizes what positionAt
    // emitted). The mapping settles after one application — a second round
    // trip is a fixpoint — which is the conventional stability guarantee for
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

describe('out-of-range line and position contract', () => {
  test('PieceTable.offsetAt: negative line maps to 0, line at or past lineCount throws', () => {
    // DIVERGENCE: a stricter contract would reject out-of-range lines on BOTH
    // sides. PieceTable is asymmetric on a non-empty document: a negative
    // line silently returns offset 0, while a line at or past lineCount
    // throws.
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

  test('TextDocument.offsetAt silently clamps every out-of-range position', () => {
    // DIVERGENCE: a stricter contract would throw on out-of-range positions.
    // TextDocument never throws: normalizePosition clamps the line into
    // [0, lineCount) and the character into the line's visible content before
    // resolving, so any position resolves to a valid offset.
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

  test('oversized character: PieceTable clamps into the break span, TextDocument to line content', () => {
    // DIVERGENCE (layer contrast): for a character past the end of a line,
    // PieceTable clamps to the line's full span INCLUDING its line break —
    // landing on the next line's start offset — while TextDocument clamps to
    // the visible content end before the break. A stricter contract would
    // throw instead.
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

describe('arbitrary-range slices on a fragmented table', () => {
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

describe('building a document by repeated appends', () => {
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

describe('repeated block inserts at one fixed offset', () => {
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

describe('slice bound clipping', () => {
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

  test('TextDocument.getText returns empty for an inverted range while applyEdits swaps it', () => {
    // DIVERGENCE (layer contrast): a stricter contract would clip inverted
    // slice bounds to empty and reject inverted change ranges outright.
    // pierre-fe reads and writes disagree with each other by design: getText
    // with an inverted range resolves to a reversed offset pair and yields '',
    // but applyEdits swaps the inverted start/end (#resolveEdit) and applies
    // the replacement.
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

describe('very long single line', () => {
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
