import { describe, expect, test } from 'bun:test';

import { parseQuotedDiffFileName } from '../src/utils/parseQuotedDiffFileName';

describe('parseQuotedDiffFileName', () => {
  test.each([
    ['empty', '""', ''],
    ['ASCII', '"src/example.ts"', 'src/example.ts'],
    ['whitespace', '" leading and trailing "', ' leading and trailing '],
    ['literal Unicode', '"src/日本語😀.ts"', 'src/日本語😀.ts'],
    ['quote', String.raw`"weird\"quote.ts"`, 'weird"quote.ts'],
    ['backslash', String.raw`"slash\\name.ts"`, 'slash\\name.ts'],
    ['named controls', String.raw`"\a\b\t\n\v\f\r"`, '\x07\b\t\n\v\f\r'],
    ['accent', String.raw`"docs/\303\274ber.md"`, 'docs/über.md'],
    ['invalid UTF-8 replacement', String.raw`"\374ber.md"`, '\uFFFDber.md'],
    [
      'Japanese',
      String.raw`"src/\346\227\245\346\234\254\350\252\236.ts"`,
      'src/日本語.ts',
    ],
    ['emoji', String.raw`"\360\237\230\200.ts"`, '😀.ts'],
    [
      'mixed Unicode',
      '"日本/' + String.raw`\303\274` + 'ber😀.ts"',
      '日本/über😀.ts',
    ],
    ['separate byte runs', String.raw`"\303\274\t\303\266"`, 'ü\tö'],
    [
      'octal controls and ASCII',
      String.raw`"\000\037\040\101\177"`,
      '\0\x1f A\x7f',
    ],
    ['leading BOM', String.raw`"\357\273\277file.ts"`, '\uFEFFfile.ts'],
    [
      'embedded BOM',
      String.raw`"dir/\357\273\277file.ts"`,
      'dir/\uFEFFfile.ts',
    ],
    [
      'literal octal text',
      String.raw`"\\303\\274.ts"`,
      String.raw`\303\274.ts`,
    ],
    ['literal named escape', String.raw`"\\n.ts"`, String.raw`\n.ts`],
    ['backslash before closing quote', String.raw`"path\\"`, 'path\\'],
  ])('decodes %s', (_, input, fileName) => {
    expect(parseQuotedDiffFileName(input)).toEqual({
      fileName,
      rawLength: input.length,
    });
  });

  test('stops at the closing quote before another filename or timestamp', () => {
    const token = String.raw`"a/\303\274\"name.ts"`;
    for (const suffix of [' "b/other.ts"', '\t2026-09-18 00:00:00\n']) {
      expect(parseQuotedDiffFileName(token + suffix)).toEqual({
        fileName: 'a/ü"name.ts',
        rawLength: token.length,
      });
    }
  });

  test.each([
    '',
    'plain.ts',
    String.raw`literal\303.ts`,
    ' "leading-space.ts"',
    '"',
    '"unterminated',
    '"trailing\\',
    String.raw`"escaped closing quote\"`,
    String.raw`"\q"`,
    String.raw`"\x41"`,
    String.raw`"\u0041"`,
    String.raw`"\1"`,
    String.raw`"\12"`,
    String.raw`"\128"`,
    String.raw`"\400"`,
    String.raw`"\777"`,
    String.raw`"\800"`,
    String.raw`"prefix\303\274\12"`,
    String.raw`"prefix\303\274\q"`,
  ])('returns no result for %j', (input) => {
    expect(parseQuotedDiffFileName(input)).toBeUndefined();
  });
});
