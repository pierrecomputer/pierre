import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('fortran: case-insensitive words, routines, and dot operators', () => {
  const kinds = tokenKinds(
    'fortran',
    'PROGRAM demo\nREAL :: x = 1.5D+2\nLOGICAL :: ready = .TRUE.\nIF (ready .AND. x .GE. 0) CALL work(x)\nEND PROGRAM demo'
  );
  for (const expected of [
    ['PROGRAM', 'keyword.declaration'],
    ['REAL', 'type.builtin'],
    ['1.5D+2', 'number'],
    ['.TRUE.', 'boolean'],
    ['.AND.', 'keyword.operator'],
    ['.GE.', 'keyword.operator'],
    ['work', 'function'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('fortran: doubled quotes, BOZ literals, and kind suffixes', () => {
  const kinds = tokenKinds(
    'fortran',
    "text = 'it''s fine'\nx = Z'FF'\ny = B\"1010\"\nz = 42_int64 + .5e-2"
  );
  for (const expected of [
    ["'it''s fine'", 'string'],
    ["Z'FF'", 'number'],
    ['B"1010"', 'number'],
    ['42_int64', 'number'],
    ['.5e-2', 'number'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('fortran: fixed-form comments and free-form C variables', () => {
  const kinds = tokenKinds(
    'fortran',
    'C fixed comment\n      INTEGER n\n* another comment\nc = 3\ncall work(c) ! trailing'
  );
  for (const expected of [
    ['C fixed comment', 'comment'],
    ['INTEGER', 'type.builtin'],
    ['* another comment', 'comment'],
    ['c', 'variable'],
    ['! trailing', 'comment'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('fortran-fixed-form: column-one C needs no blank after the marker', () => {
  const code =
    'Ccomment without a blank\n      INTEGER n\nc = 1\nC\n      contains\n      call work(c) ! trailing\n';
  for (const lang of ['fortran-fixed-form', 'f', 'for', 'f77'] as const) {
    const kinds = tokenKinds(lang, code);
    for (const expected of [
      ['Ccomment without a blank', 'comment'],
      ['INTEGER', 'type.builtin'],
      ['c = 1', 'comment'],
      ['C', 'comment'],
      ['contains', 'keyword'],
      ['call', 'keyword.control'],
      ['! trailing', 'comment'],
    ] satisfies [string, string][]) {
      expect(kinds).toContainEqual(expected);
    }
    assertLineFedParity(lang, code);
  }
});

test('fortran: free-form names keep column-one C words as code', () => {
  const code = 'c = 1\ncontains\ncall work(c)\nC separated comment\n';
  for (const lang of [
    'fortran',
    'fortran-free-form',
    'f90',
    'f95',
    'f03',
    'f08',
  ] as const) {
    const kinds = tokenKinds(lang, code);
    expect(kinds).toContainEqual(['c', 'variable']);
    expect(kinds).toContainEqual(['contains', 'keyword']);
    expect(kinds).toContainEqual(['call', 'keyword.control']);
    expect(kinds).toContainEqual(['C separated comment', 'comment']);
    expect(kinds).not.toContainEqual(['c = 1', 'comment']);
  }
});

test('fortran: markdown fences accept both long form names', () => {
  const body = 'Ccomment\n';
  expect(
    tokenKinds('markdown', `\`\`\`fortran-fixed-form\n${body}\`\`\`\n`)
  ).toEqual([
    ['```fortran-fixed-form', 'punctuation.delimiter'],
    ['Ccomment', 'comment'],
    ['```', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('markdown', `\`\`\`Fortran-Free-Form\n${body}\`\`\`\n`)
  ).toEqual([
    ['```Fortran-Free-Form', 'punctuation.delimiter'],
    ['Ccomment', 'variable'],
    ['```', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('markdown', `\`\`\`fortran-fixed-forms\n${body}\`\`\`\n`)
  ).toEqual([
    ['```fortran-fixed-forms', 'punctuation.delimiter'],
    ['Ccomment', 'text.literal'],
    ['```', 'punctuation.delimiter'],
  ]);
});

test('fortran: decimal exponents stay separate from dotted operators', () => {
  expect(tokenKinds('fortran', '1.d0 + 1.e+3 + 1._dp == 1.eq.2')).toEqual([
    ['1.d0', 'number'],
    ['+', 'operator'],
    ['1.e+3', 'number'],
    ['+', 'operator'],
    ['1._dp', 'number'],
    ['==', 'operator'],
    ['1', 'number'],
    ['.eq.', 'keyword.operator'],
    ['2', 'number'],
  ]);
});

test('fortran: multiline constructs match line-fed streaming', () => {
  for (const code of [
    'character(*) :: s = "one &\n! between lines\n  &two"\nprint *, s\n',
    'program p\r\nreal :: x = 1d-3\r\nend program p\r\n',
  ]) {
    assertLineFedParity('fortran', code);
  }
});

test('fortran: collision words and case variants match complete identifiers', () => {
  for (const [word, kind] of [
    ['where', 'keyword.control'],
    ['inquire', 'function'],
    ['endfile', 'function'],
  ] satisfies [string, string][]) {
    for (const variant of [word, word.toUpperCase()]) {
      expect(tokenKinds('fortran', variant)).toEqual([[variant, kind]]);
      expect(tokenKinds('fortran', `${variant}_x`)).toEqual([
        [`${variant}_x`, 'variable'],
      ]);
    }
  }
});

test('fortran: derived-type members do not become keywords', () => {
  expect(tokenKinds('fortran', 'item%kind = item%real')).toEqual([
    ['item', 'variable'],
    ['%', 'operator'],
    ['kind', 'property'],
    ['=', 'operator'],
    ['item', 'variable'],
    ['%', 'operator'],
    ['real', 'property'],
  ]);
});

test('fortran: procedure names survive comments and line breaks', () => {
  expect(
    tokenKinds('fortran', 'subroutine & ! continued\n  & work(x)')
  ).toEqual([
    ['subroutine', 'keyword.declaration'],
    ['&', 'operator'],
    ['! continued', 'comment'],
    ['&', 'operator'],
    ['work', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('fortran: exponent signs and custom dotted operators stay separate', () => {
  expect(tokenKinds('fortran', '1D-3-2 .custom. 4.Q+2')).toEqual([
    ['1D-3', 'number'],
    ['-', 'operator'],
    ['2', 'number'],
    ['.custom.', 'keyword.operator'],
    ['4.Q+2', 'number'],
  ]);
});

test('fortran: quotes and comment markers inside strings remain literal', () => {
  for (const literal of [
    "'don''t ! comment'",
    '"say ""hello"" !"',
    "'back\\slash'",
  ]) {
    expect(tokenKinds('fortran', literal)).toEqual([[literal, 'string']]);
  }
  expect(tokenKinds('fortran', '!$omp parallel do')).toEqual([
    ['!$omp parallel do', 'preproc'],
  ]);
});
