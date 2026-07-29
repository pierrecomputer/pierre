import { describe, expect, test } from 'bun:test';

import {
  type DiffLines,
  EMPTY_DIFF_LINES,
  finishLines,
  isWellFormed,
  joinLines,
  lineAt,
  linesToArray,
  plainLines,
} from '../src/utils/diffLines';

// `DiffLines` is an arena-or-plain union, so a field assertion has to narrow
// first. These mirror the runtime `'lines' in value` check the module uses.
function arena(dl: DiffLines) {
  if ('lines' in dl) {
    throw new Error('expected an arena DiffLines, got the string fallback');
  }
  return dl;
}

function plain(dl: DiffLines) {
  if (!('lines' in dl)) {
    throw new Error('expected the string fallback, got an arena DiffLines');
  }
  return dl;
}

describe('diffLines', () => {
  test('empty list seals to a valid empty arena', () => {
    const dl = finishLines([]);
    expect(dl.length).toBe(0);
    expect('lines' in dl).toBe(false); // arena path
    expect(lineAt(dl, 0)).toBeUndefined();
  });

  test('ascii content round-trips through the byte arena', () => {
    const lines = ['const x = 1;\n', 'return x;\n'];
    const dl = finishLines(lines);
    expect('lines' in dl).toBe(false); // arena path, not the string fallback
    expect(lineAt(dl, 0)).toBe('const x = 1;\n');
    expect(linesToArray(dl)).toEqual(lines);
  });

  test('out-of-range reads return undefined', () => {
    const dl = finishLines(['a']);
    expect(lineAt(dl, -1)).toBeUndefined();
    expect(lineAt(dl, 1)).toBeUndefined();
  });

  test('multibyte UTF-8 (accents, CJK) uses the arena and round-trips', () => {
    const lines = ['cœur de pierre précieuse\n', '日本語のテスト\n'];
    const dl = finishLines(lines);
    expect('lines' in dl).toBe(false);
    expect(linesToArray(dl)).toEqual(lines);
    // Multibyte content takes more bytes than UTF-16 code units.
    const charTotal = lines.reduce((n, l) => n + l.length, 0);
    expect(arena(dl).bytes.length).toBeGreaterThan(charTotal);
  });

  test('valid surrogate pairs (emoji, astral) still use the arena', () => {
    // Regression guard: a valid pair is well-formed and survives a UTF-8
    // round-trip, so it must NOT be forced onto the string[] fallback.
    const lines = ['hi 😀 there\n', 'math 𝕏 sym\n'];
    expect(isWellFormed(lines[0])).toBe(true);
    expect(isWellFormed(lines[1])).toBe(true);
    const dl = finishLines(lines);
    expect('lines' in dl).toBe(false);
    expect(linesToArray(dl)).toEqual(lines);
  });

  test('a lone surrogate falls back to the exact strings', () => {
    const lines = ['ok\n', 'bad \uD800 here\n'];
    expect(isWellFormed(lines[1])).toBe(false);
    const dl = finishLines(lines);
    expect('lines' in dl).toBe(true); // fallback path
    expect(lineAt(dl, 1)).toBe('bad \uD800 here\n'); // preserved verbatim
    expect(linesToArray(dl)).toEqual(lines);
  });

  test('knownLossless skips the per-line check on the common path', () => {
    const lines = ['a\n', 'b\n'];
    const dl = finishLines(lines, true);
    expect('lines' in dl).toBe(false);
    expect(linesToArray(dl)).toEqual(lines);
  });

  test('a leading BOM is preserved, not silently stripped', () => {
    const dl = finishLines(['﻿first\n', 'second\n']);
    expect(lineAt(dl, 0)).toBe('﻿first\n');
  });

  test('offset width scales with the file byte length (u8/u16/u32)', () => {
    const small = finishLines(['ab']); // upper bound < 256 bytes
    expect(arena(small).offsets.BYTES_PER_ELEMENT).toBe(1);
    const medium = finishLines(['x'.repeat(300)]); // 256..65535
    expect(arena(medium).offsets.BYTES_PER_ELEMENT).toBe(2);
    const large = finishLines(['y'.repeat(70_000)]); // >= 65536
    expect(arena(large).offsets.BYTES_PER_ELEMENT).toBe(4);
    expect(lineAt(large, 0)).toBe('y'.repeat(70_000));
  });

  test('plainLines wraps strings without encoding into the arena', () => {
    const dl = plainLines(['one\n', 'two\n']);
    expect('lines' in dl).toBe(true); // string fallback, no byte arena
    expect(plain(dl).lines).toEqual(['one\n', 'two\n']);
    expect(dl.length).toBe(2);
    expect(lineAt(dl, 1)).toBe('two\n');
  });

  test('EMPTY_DIFF_LINES is a valid empty list', () => {
    expect(EMPTY_DIFF_LINES.length).toBe(0);
    expect(lineAt(EMPTY_DIFF_LINES, 0)).toBeUndefined();
  });

  test('joinLines concatenates the arena (the editor whole-side accessor)', () => {
    const lines = ['const x = 1;\n', 'return x;\n'];
    const dl = finishLines(lines);
    expect('lines' in dl).toBe(false); // arena path
    // The default empty separator decodes the whole arena in one pass.
    expect(joinLines(dl)).toBe('const x = 1;\nreturn x;\n');
  });

  test('joinLines round-trips multibyte content from the arena', () => {
    const dl = finishLines(['cœur de pierre précieuse\n', '日本語のテスト\n']);
    expect('lines' in dl).toBe(false);
    expect(joinLines(dl)).toBe('cœur de pierre précieuse\n日本語のテスト\n');
  });

  test('joinLines reads the string fallback when the arena is unused', () => {
    const dl = plainLines(['a\n', 'b\n']);
    expect(joinLines(dl)).toBe('a\nb\n');
  });
});
