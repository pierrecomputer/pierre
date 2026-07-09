import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../src/editor/pieceTable';

/**
 * Asserts that an incrementally-edited table is indistinguishable from a table
 * freshly constructed from the same text. Construction runs the trusted
 * `computeLineOffsets` path, so this pins every line/offset query the
 * incremental split/merge path must match — including the CR/LF-at-a-piece-
 * boundary cases that motivated these tests.
 */
function expectMatchesFreshConstruction(table: PieceTable, text: string): void {
  const fresh = new PieceTable(text);

  expect(table.getText()).toBe(text);
  expect(table.getText()).toBe(fresh.getText());
  expect(table.lineCount).toBe(fresh.lineCount);

  for (let line = 0; line < fresh.lineCount; line++) {
    expect(table.getLineText(line)).toBe(fresh.getLineText(line));
    expect(table.getLineText(line, true)).toBe(fresh.getLineText(line, true));
    expect(table.getLineLength(line)).toBe(fresh.getLineLength(line));
    expect(table.getLineLength(line, true)).toBe(
      fresh.getLineLength(line, true)
    );
  }

  for (let offset = 0; offset <= text.length; offset++) {
    expect(table.positionAt(offset)).toEqual(fresh.positionAt(offset));
  }

  for (let line = 0; line < fresh.lineCount; line++) {
    const lineLength = fresh.getLineLength(line, true);
    for (let character = 0; character <= lineLength; character++) {
      expect(table.offsetAt({ line, character })).toBe(
        fresh.offsetAt({ line, character })
      );
    }
  }

  for (let start = 0; start <= text.length; start++) {
    for (let end = start; end <= text.length; end++) {
      expect(table.getTextSlice(start, end)).toBe(
        fresh.getTextSlice(start, end)
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

describe('PieceTable CR/LF at piece boundaries', () => {
  test('undercount: an insert that splits a CRLF pair adds a line', () => {
    // "a\r\nb" (2 lines) -> insert between \r and \n -> "a\rX\nb" (3 lines):
    // the \r and \n are now lone breaks on either side of "X".
    const table = new PieceTable('a\r\nb');

    table.insert('X', 2);

    expect(table.getText()).toBe('a\rX\nb');
    expect(table.lineCount).toBe(3);
    expect(table.positionAt(2)).toEqual({ line: 1, character: 0 });
    expect(table.getLineText(0)).toBe('a');
    expect(table.getLineText(1)).toBe('X');
    expect(table.getLineText(2)).toBe('b');
    expect(table.search(makeQuery('X'))).toEqual([[2, 3]]);
    expectMatchesFreshConstruction(table, 'a\rX\nb');
  });

  test('overcount: an inserted CR that forms a CRLF pair removes a line', () => {
    // "a\nb" (2 lines) -> insert \r before the \n -> "a\r\nb" (still 2 lines):
    // the added \r and original \n now read as a single \r\n break.
    const table = new PieceTable('a\nb');

    table.insert('\r', 1);

    expect(table.getText()).toBe('a\r\nb');
    expect(table.lineCount).toBe(2);
    expect(table.positionAt(2)).toEqual({ line: 0, character: 2 });
    expect(table.positionAt(3)).toEqual({ line: 1, character: 0 });
    expect(table.getLineText(0)).toBe('a');
    expect(table.getLineText(1)).toBe('b');
    expectMatchesFreshConstruction(table, 'a\r\nb');
  });

  test('getLineText keeps an interior lone CR that is not at the slice end', () => {
    // The trailing-EOL trim in getTextSlice must only strip the end of the
    // whole slice, not the end of every per-piece chunk. "a\rX\nb" line 0 is
    // "a\r"; trimming to the slice end yields "a", never "aX".
    const table = new PieceTable('a\r\nb');

    table.insert('X', 2);

    expect(table.getLineText(0)).toBe('a');
    expect(table.getLineText(0, true)).toBe('a\r');
    expect(table.getText()).toBe('a\rX\nb');
  });

  test('getLineLength does not depend on the getLineText cache', () => {
    // getLineLength has a fresh path and a cache-fed path (populated by
    // getLineText). Both must agree once a lone CR sits mid-line.
    const table = new PieceTable('a\r\nb');
    table.insert('X', 2);

    const fresh = table.getLineLength(0, false);
    table.getLineText(0);
    const cached = table.getLineLength(0, false);

    expect(fresh).toBe(1);
    expect(cached).toBe(1);
  });

  test('deleting the inserted char between a split CRLF rejoins the pair', () => {
    const table = new PieceTable('a\r\nb');

    table.insert('X', 2); // "a\rX\nb" (3 lines)
    table.delete(2, 1); // back to "a\r\nb" (2 lines)

    expect(table.getText()).toBe('a\r\nb');
    expect(table.lineCount).toBe(2);
    expectMatchesFreshConstruction(table, 'a\r\nb');
  });

  test('deleting an interior char that forms a CRLF removes a line', () => {
    // "a\rZ\nb" (3 lines): delete Z so the \r and \n become adjacent -> a
    // single \r\n break -> "a\r\nb" (2 lines).
    const table = new PieceTable('a\rZ\nb');

    table.delete(2, 1);

    expect(table.getText()).toBe('a\r\nb');
    expect(table.lineCount).toBe(2);
    expectMatchesFreshConstruction(table, 'a\r\nb');
  });

  test('applyResolvedEdits with a raw CRLF newText counts lines correctly', () => {
    // Mirrors an LSP server sending \r\n in newText with independently computed
    // offsets; the raw offset path must not miscount.
    const table = new PieceTable('line0\nline1');

    table.applyEdits([{ start: 5, end: 5, text: '\r\ninserted' }]);

    expectMatchesFreshConstruction(table, 'line0\r\ninserted\nline1');
    expect(table.lineCount).toBe(3);
  });

  test('matches fresh construction across random CR/LF-splitting edits', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const random = createRandom(seed * 2654435761 + 11);
      let text = 'a\r\nb\nc\r\rd\n';
      const table = new PieceTable(text);
      // Deliberately includes lone \r and \r\n so edits both split existing
      // pairs and form new ones across piece boundaries.
      const inserts = ['\r', '\n', '\r\n', 'x', 'YZ', '\r\nq', 'p\r', ''];

      for (let i = 0; i < 200; i++) {
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
        expect(table.lineCount).toBe(new PieceTable(text).lineCount);
      }

      expectMatchesFreshConstruction(table, text);
    }
  });
});

function makeQuery(text: string) {
  return {
    text,
    replaceText: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  };
}
