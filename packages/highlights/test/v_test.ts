import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('v: modules, imports, structs, and attributes', () => {
  expect(
    tokenKinds('v', 'module main\nimport net.http\nimport os { args }')
  ).toEqual([
    ['module', 'keyword.declaration'],
    ['main', 'namespace'],
    ['import', 'keyword.import'],
    ['net', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['http', 'namespace'],
    ['import', 'keyword.import'],
    ['os', 'namespace'],
    ['{', 'punctuation.bracket'],
    ['args', 'variable'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('v', 'module main\nimport net.http\nimport os { args }');
  expect(
    tokenKinds('v', '@[heap]\npub struct Point {\nmut:\n    x int = 0x10\n}')
  ).toEqual([
    ['@[heap', 'attribute'],
    [']', 'punctuation.bracket'],
    ['pub', 'keyword'],
    ['struct', 'keyword.declaration'],
    ['Point', 'type'],
    ['{', 'punctuation.bracket'],
    ['mut', 'keyword'],
    [':', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['int', 'type.builtin'],
    ['=', 'operator'],
    ['0x10', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'v',
    '@[heap]\npub struct Point {\nmut:\n    x int = 0x10\n}'
  );
});

test('v: functions, receivers, and calls', () => {
  expect(tokenKinds('v', 'fn (mut p Point) move(dx f64) ?int {')).toEqual([
    ['fn', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['mut', 'keyword'],
    ['p', 'variable'],
    ['Point', 'type'],
    [')', 'punctuation.bracket'],
    ['move', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['dx', 'variable'],
    ['f64', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['?', 'operator'],
    ['int', 'type.builtin'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('v', 'fn (p Point) Point {')).toEqual([
    ['fn', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['p', 'variable'],
    ['Point', 'type'],
    [')', 'punctuation.bracket'],
    ['Point', 'type'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('v', 'name := os.args[1] or { panic(err) }')).toEqual([
    ['name', 'variable'],
    [':=', 'operator'],
    ['os', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['args', 'property'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    ['or', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['panic', 'function'],
    ['(', 'punctuation.bracket'],
    ['err', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('v', 'arr << i; if x !in arr { println(x) }')).toEqual([
    ['arr', 'variable'],
    ['<<', 'operator'],
    ['i', 'variable'],
    [';', 'punctuation.delimiter'],
    ['if', 'keyword.control'],
    ['x', 'variable'],
    ['!', 'operator'],
    ['in', 'keyword.operator'],
    ['arr', 'variable'],
    ['{', 'punctuation.bracket'],
    ['println', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
});

test('v: strings, templates, raw strings, and runes', () => {
  expect(tokenKinds('v', "s := 'a ${p.x + f(1)} $name.len\\n'")).toEqual([
    ['s', 'variable'],
    [':=', 'operator'],
    ["'a", 'string'],
    ['${', 'punctuation.special'],
    ['p', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['+', 'operator'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['$name.len', 'variable'],
    ['\\n', 'string.escape'],
    ["'", 'string'],
  ]);
  expect(tokenKinds('v', 'd := "x ${m["k"]} y"')).toEqual([
    ['d', 'variable'],
    [':=', 'operator'],
    ['"x', 'string'],
    ['${', 'punctuation.special'],
    ['m', 'variable'],
    ['[', 'punctuation.bracket'],
    ['"k"', 'string'],
    [']', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['y"', 'string'],
  ]);
  expect(tokenKinds('v', "r := r'raw ${x}\\n' + c'text'")).toEqual([
    ['r', 'variable'],
    [':=', 'operator'],
    ["r'raw ${x}\\n'", 'string'],
    ['+', 'operator'],
    ["c'text'", 'string'],
  ]);
  expect(tokenKinds('v', 'c := `a` + `\\n`')).toEqual([
    ['c', 'variable'],
    [':=', 'operator'],
    ['`a`', 'string'],
    ['+', 'operator'],
    ['`', 'string'],
    ['\\n', 'string.escape'],
    ['`', 'string'],
  ]);
  expect(tokenKinds('v', "m := 'one\ntwo ${x}\nthree'")).toEqual([
    ['m', 'variable'],
    [':=', 'operator'],
    ["'one", 'string'],
    ['two', 'string'],
    ['${', 'punctuation.special'],
    ['x', 'variable'],
    ['}', 'punctuation.special'],
    ["three'", 'string'],
  ]);
  assertLineFedParity('v', "m := 'one\ntwo ${x}\nthree'");
});

test('v: compile-time words and comments', () => {
  expect(
    tokenKinds('v', '$if linux {\n} $else {\n}\nx := $embed_file("a")')
  ).toEqual([
    ['$if', 'keyword.control'],
    ['linux', 'variable'],
    ['{', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['$else', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['x', 'variable'],
    [':=', 'operator'],
    ['$embed_file', 'function'],
    ['(', 'punctuation.bracket'],
    ['"a"', 'string'],
    [')', 'punctuation.bracket'],
  ]);
  assertLineFedParity('v', '$if linux {\n} $else {\n}\nx := $embed_file("a")');
  expect(tokenKinds('v', '/* a /* b */\nc */ // d\n#flag -lm')).toEqual([
    ['/* a /* b */', 'comment'],
    ['c */ // d', 'comment'],
    ['#flag -lm', 'preproc'],
  ]);
  assertLineFedParity('v', '/* a /* b */\nc */ // d\n#flag -lm');
  expect(
    tokenKinds(
      'v',
      'for i in 0 .. 10 { match x { .red { y = none } else {} } }'
    )
  ).toEqual([
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['0', 'number'],
    ['..', 'operator'],
    ['10', 'number'],
    ['{', 'punctuation.bracket'],
    ['match', 'keyword.control'],
    ['x', 'variable'],
    ['{', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['red', 'property'],
    ['{', 'punctuation.bracket'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['none', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{} } }', 'punctuation.bracket'],
  ]);
});
