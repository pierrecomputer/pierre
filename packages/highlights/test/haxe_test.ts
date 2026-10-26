import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('haxe: declarations, modules, types, and metadata', () => {
  const tokens = tokenKinds('haxe', samples.haxe.code);
  for (const [text, kind] of [
    ['package', 'keyword.import'],
    ['demo', 'namespace'],
    ['StringMap', 'type'],
    ['@:keep', 'attribute'],
    ['class', 'keyword.declaration'],
    ['Greeter', 'type'],
    ['IGreeter', 'type'],
    ['MAX_COUNT', 'constant'],
    ['Int', 'type.builtin'],
    ['default', 'keyword.control'],
    ['null', 'constant.builtin'],
    ['new', 'function.definition'],
    ['super', 'variable.special'],
    ['render', 'function.definition'],
    ['cast', 'keyword.operator'],
    ['#if (js && !debug)', 'preproc'],
    ['#end', 'preproc'],
    ['alert', 'function.method'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  // a property declaration is not a call
  expect(tokenKinds('haxe', 'var x(get, set):Int;').slice(0, 3)).toEqual([
    ['var', 'keyword.declaration'],
    ['x', 'variable'],
    ['(', 'punctuation.bracket'],
  ]);
});

test('haxe: interpolation, escapes, and dollar signs in strings', () => {
  expect(tokenKinds('haxe', "'a $b ${c + 1} $$ \\u{1F600}'")).toEqual([
    ["'a", 'string'],
    ['$b', 'variable'],
    ['${', 'punctuation.special'],
    ['c', 'variable'],
    ['+', 'operator'],
    ['1', 'number'],
    ['}', 'punctuation.special'],
    ['$$', 'string.escape'],
    ['\\u{1F600}', 'string.escape'],
    ["'", 'string'],
  ]);
  // double quotes do not interpolate; a nested string keeps `${` as text
  expect(tokenKinds('haxe', `"$a" + '\${ '\${b}' }'`)).toEqual([
    ['"$a"', 'string'],
    ['+', 'operator'],
    ["'", 'string'],
    ['${', 'punctuation.special'],
    ["'${b}'", 'string'],
    ['}', 'punctuation.special'],
    ["'", 'string'],
  ]);
});

test('haxe: regular expressions, intervals, and conditional compilation', () => {
  expect(
    tokenKinds('haxe', 'var r = ~/a\\/b+/gi; for (i in 0...3) {}')
  ).toEqual([
    ['var', 'keyword.declaration'],
    ['r', 'variable'],
    ['=', 'operator'],
    ['~/a\\/b+/gi', 'string.regex'],
    [';', 'punctuation.delimiter'],
    ['for', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['0', 'number'],
    ['...', 'operator'],
    ['3', 'number'],
    [') {}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('haxe', '#if !debug f(); #elseif (sys || cpp) g(); #end')
  ).toEqual([
    ['#if !debug', 'preproc'],
    ['f', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['#elseif (sys || cpp)', 'preproc'],
    ['g', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['#end', 'preproc'],
  ]);
});

test('haxe: strings, interpolations, and comments span lines', () => {
  for (const code of [
    samples.haxe.code,
    "var s = 'a ${\n  x + 1\n} $name\nend';\nvar n = 2;\n",
    '/** doc\n * text */\nvar t = "one\\\ntwo";\n',
  ]) {
    assertLineFedParity('haxe', code);
  }
  expect(tokenKinds('haxe', "var s = 'a\n$b';\nvar n = 2;")).toContainEqual([
    '$b',
    'variable',
  ]);
});
