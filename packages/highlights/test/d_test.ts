import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('d: modules, declarations, types, and definitions', () => {
  const tokens = tokenKinds('d', samples.d.code);
  for (const [text, kind] of [
    ['module', 'keyword.import'],
    ['geometry', 'namespace'],
    ['@safe', 'attribute'],
    ['struct', 'keyword.declaration'],
    ['Point', 'type'],
    ['len', 'function.definition'],
    ['main', 'function.definition'],
    ['string', 'type.builtin'],
    ['foreach', 'keyword.control'],
    ['writeln', 'function'],
    ['length', 'property'],
    ['__LINE__', 'constant.builtin'],
    ['$', 'variable.special'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(tokenKinds('d', 'import std.stdio : writeln;')).toEqual([
    ['import', 'keyword.import'],
    ['std', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['stdio', 'namespace'],
    [':', 'punctuation.delimiter'],
    ['writeln', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  // `enum` names a type, or a constant when `=` follows
  expect(tokenKinds('d', 'enum Mode { a }\nenum max = 3;')).toEqual([
    ['enum', 'keyword.declaration'],
    ['Mode', 'type'],
    ['{', 'punctuation.bracket'],
    ['a', 'variable'],
    ['}', 'punctuation.bracket'],
    ['enum', 'keyword.declaration'],
    ['max', 'variable'],
    ['=', 'operator'],
    ['3', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('d: template instantiation, members, and operators', () => {
  expect(tokenKinds('d', 'auto s = to!string(x.y) ~ a.b(); a != b;')).toEqual([
    ['auto', 'keyword'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['to', 'function'],
    ['!', 'operator'],
    ['string', 'type.builtin'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['y', 'property'],
    [')', 'punctuation.bracket'],
    ['~', 'operator'],
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['b', 'function.method'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['a', 'variable'],
    ['!=', 'operator'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  // a type before the name defines a function, even through `[]` and `*`
  expect(tokenKinds('d', 'int[] f(); T* g(); h();')).toContainEqual([
    'f',
    'function.definition',
  ]);
  expect(tokenKinds('d', 'int[] f(); T* g(); h();')).toContainEqual([
    'g',
    'function.definition',
  ]);
  expect(tokenKinds('d', 'int[] f(); T* g(); h();')).toContainEqual([
    'h',
    'function',
  ]);
});

test('d: comments, including nested and doc forms', () => {
  expect(
    tokenKinds(
      'd',
      '// a\n/// b\n/* c */\n/** d */\n/+ e /+ f +/ g +/\n/++ h +/'
    )
  ).toEqual([
    ['// a', 'comment'],
    ['/// b', 'comment.doc'],
    ['/* c */', 'comment'],
    ['/** d */', 'comment.doc'],
    ['/+ e /+ f +/ g +/', 'comment'],
    ['/++ h +/', 'comment.doc'],
  ]);
  expect(tokenKinds('d', '#!/usr/bin/env rdmd\n#line 10 "x.d"')).toEqual([
    ['#!/usr/bin/env rdmd', 'comment'],
    ['#line 10 "x.d"', 'preproc'],
  ]);
});

test('d: string forms, escapes, and suffixes', () => {
  expect(tokenKinds('d', '"a\\x41\\u00e9b"c')).toEqual([
    ['"a', 'string'],
    ['\\x41\\u00e9', 'string.escape'],
    ['b"c', 'string'],
  ]);
  for (const literal of [
    'r"C:\\dir"',
    '`raw\\n`',
    'x"0A 0B"',
    'q"(a (b) c)"',
    'q"[x]"',
    'q"/x/"',
    'q{ int x = { 1 }; }',
    "'\\n'",
  ]) {
    expect(tokenKinds('d', `${literal};`)).toEqual(
      literal === "'\\n'"
        ? [
            ["'", 'string'],
            ['\\n', 'string.escape'],
            ["'", 'string'],
            [';', 'punctuation.delimiter'],
          ]
        : [
            [literal, 'string'],
            [';', 'punctuation.delimiter'],
          ]
    );
  }
  expect(tokenKinds('d', 'auto c = d;')).toContainEqual(['d', 'variable']);
});

test('d: numbers with separators, suffixes, and hex floats', () => {
  for (const n of [
    '1_000',
    '0x1F_FFuL',
    '0b1010',
    '1.5e-3f',
    '2.0L',
    '3i',
    '0x1.8p3',
  ]) {
    expect(tokenKinds('d', n)).toEqual([[n, 'number']]);
  }
  expect(tokenKinds('d', 'a[0 .. 10]')).toEqual([
    ['a', 'variable'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    ['..', 'operator'],
    ['10', 'number'],
    [']', 'punctuation.bracket'],
  ]);
});

test('d: multi-line strings, token strings, and comments stream by line', () => {
  for (const code of [
    'string s = "first\nsecond \\"q\\" λ😀\nthird"w;\nint x;\n',
    'auto t = q{\n  int a = { 1 };\n  b();\n};\nint y;\n',
    'auto d = q"(one\ntwo)";\nint z;\n',
    'auto r = r"a\nb" ~ `c\nd`;\n',
    '/+ a /+ b\n+/ c\n+/ int w;\n',
    '/** doc\n * more */\nvoid f();\n',
    'import a,\n  b.c;\nint v;\n',
    samples.d.code,
  ]) {
    assertLineFedParity('d', code);
    assertLineFedParity('d', code.replaceAll('\n', '\r\n'));
  }
});
