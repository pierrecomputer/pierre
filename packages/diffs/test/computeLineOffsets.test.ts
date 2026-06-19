import { describe, expect, test } from 'bun:test';

import {
  computeLineOffsets,
  countLineBreaks,
  linesFromFileContents,
} from '../src/utils/computeFileOffsets';

describe('computeLineOffsets', () => {
  test('returns a single start offset for empty contents', () => {
    const result = computeLineOffsets('');

    expect([...result]).toEqual([0]);
    expect(result.length).toBe(1);
  });

  test('computes offsets for single line', () => {
    const result = computeLineOffsets('hello');

    expect([...result]).toEqual([0]);
    expect(result.length).toBe(1);
  });

  test('computes offsets for LF files', () => {
    const withTerminalNewline = computeLineOffsets('a\nb\n');
    const withoutTerminalNewline = computeLineOffsets('a\nb');

    expect([...withTerminalNewline]).toEqual([0, 2, 4]);
    expect(withTerminalNewline.length).toBe(3);
    expect([...withoutTerminalNewline]).toEqual([0, 2]);
    expect(withoutTerminalNewline.length).toBe(2);
  });

  test('computes offsets for CRLF and lone CR line endings', () => {
    const crlf = computeLineOffsets('a\r\nb\r\n');
    const mixed = computeLineOffsets('a\rb\r\nc\n');

    expect([...crlf]).toEqual([0, 3, 6]);
    expect(crlf.length).toBe(3);
    expect([...mixed]).toEqual([0, 2, 5, 7]);
    expect(mixed.length).toBe(4);
  });

  test('treats newline-only contents as two offset boundaries', () => {
    const lines = computeLineOffsets('\n');

    expect([...lines]).toEqual([0, 1]);
    expect(lines.length).toBe(2);
  });
});

describe('countLineBreaks', () => {
  test('stays consistent with computeLineOffsets across line endings', () => {
    const cases = [
      '',
      'hello',
      'a\nb',
      'a\nb\n',
      'a\r\nb\r\n',
      '\rworld\rfoo',
      'a\rb\r\nc\n',
      '\n',
      '\r',
    ];

    for (const contents of cases) {
      expect(countLineBreaks(contents)).toBe(
        computeLineOffsets(contents).length - 1
      );
    }
  });

  test('counts a lone CR as one break and CRLF as one break', () => {
    expect(countLineBreaks('')).toBe(0);
    expect(countLineBreaks('no breaks')).toBe(0);
    expect(countLineBreaks('\r')).toBe(1);
    expect(countLineBreaks('a\rb\rc')).toBe(2);
    expect(countLineBreaks('a\r\nb')).toBe(1);
    expect(countLineBreaks('a\nb\nc')).toBe(2);
  });
});

describe('linesFromFileContents', () => {
  test('matches computeLineOffsets line count', () => {
    const cases = ['', 'hello', 'hello\n', 'a\nb\n', 'a\nb', '\n'];

    for (const contents of cases) {
      expect(linesFromFileContents(contents).length).toBe(
        computeLineOffsets(contents).length
      );
    }
  });

  test('preserves newlines so windowed joins reconstruct the file', () => {
    const contents = 'hello\n';
    const lines = linesFromFileContents(contents);

    expect(lines).toEqual(['hello\n', '']);
    expect(lines.slice(0, lines.length).join('')).toBe(contents);
  });
});
