import { describe, expect, test } from 'bun:test';

import { PieceTable } from '../src/editor/pieceTable';
import type { Position } from '../src/editor/textDocument';

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
});
