import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('nushell: definitions, signatures, and types', () => {
  expect(
    tokenKinds(
      'nushell',
      'export def --env greet [name: string, --loud (-l): int = 1, ...rest]: nothing -> list<string> { }'
    )
  ).toEqual([
    ['export', 'keyword.import'],
    ['def', 'keyword.declaration'],
    ['--env', 'variable.parameter'],
    ['greet', 'function.definition'],
    ['[', 'punctuation.bracket'],
    ['name', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['string', 'type'],
    [',', 'punctuation.delimiter'],
    ['--loud', 'variable.parameter'],
    ['(', 'punctuation.bracket'],
    ['-l', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['int', 'type'],
    ['=', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['...', 'operator'],
    ['rest', 'variable.parameter'],
    [']', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['nothing', 'type'],
    ['->', 'operator'],
    ['list<string>', 'type'],
    ['{ }', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('nushell', 'let x: int = 5; mut y = ls')).toEqual([
    ['let', 'keyword.declaration'],
    ['x', 'variable'],
    [':', 'punctuation.delimiter'],
    ['int', 'type'],
    ['=', 'operator'],
    ['5', 'number'],
    [';', 'punctuation.delimiter'],
    ['mut', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['ls', 'function'],
  ]);
});

test('nushell: pipelines, commands, flags, and closures', () => {
  expect(
    tokenKinds(
      'nushell',
      'ls -a | where size > 10kb | each {|f| $f.name } o> out.txt\n^git status e>| lines'
    )
  ).toEqual([
    ['ls', 'function'],
    ['-a', 'variable.parameter'],
    ['|', 'operator'],
    ['where', 'function'],
    ['size', null],
    ['>', 'operator'],
    ['10kb', 'number'],
    ['|', 'operator'],
    ['each', 'function'],
    ['{|', 'punctuation.bracket'],
    ['f', 'variable.parameter'],
    ['|', 'punctuation.bracket'],
    ['$f', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['}', 'punctuation.bracket'],
    ['o>', 'operator'],
    ['out.txt', null],
    ['^git', 'function'],
    ['status', null],
    ['e>|', 'operator'],
    ['lines', 'function'],
  ]);
  expect(
    tokenKinds(
      'nushell',
      'if $x in [1 2] and not $y { echo yes } else { null }'
    )
  ).toEqual([
    ['if', 'keyword.control'],
    ['$x', 'variable'],
    ['in', 'keyword.operator'],
    ['[', 'punctuation.bracket'],
    ['1 2', 'number'],
    [']', 'punctuation.bracket'],
    ['and not', 'keyword.operator'],
    ['$y', 'variable'],
    ['{', 'punctuation.bracket'],
    ['echo', 'function'],
    ['yes', null],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['null', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('nushell: variables, cell paths, records, and literals', () => {
  expect(
    tokenKinds(
      'nushell',
      '{a: 1, b: true, when: 2024-01-31, d: 5min} | get $env.PATH.0? $in $nu 0x1F 1..3'
    )
  ).toEqual([
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['b', 'property'],
    [':', 'punctuation.delimiter'],
    ['true', 'boolean'],
    [',', 'punctuation.delimiter'],
    ['when', 'property'],
    [':', 'punctuation.delimiter'],
    ['2024-01-31', 'number'],
    [',', 'punctuation.delimiter'],
    ['d', 'property'],
    [':', 'punctuation.delimiter'],
    ['5min', 'number'],
    ['}', 'punctuation.bracket'],
    ['|', 'operator'],
    ['get', 'function'],
    ['$env', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['PATH', 'property'],
    ['.', 'punctuation.delimiter'],
    ['0?', 'property'],
    ['$in $nu', 'variable.special'],
    ['0x1F 1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
  ]);
});

test('nushell: strings, interpolation, and raw strings span lines', () => {
  expect(
    tokenKinds(
      'nushell',
      `$"a (ls | length) \\(b\\)" + $'c ($x)' + 'd\\n' + \`e f\``
    )
  ).toEqual([
    ['$"a', 'string'],
    ['(', 'punctuation.special'],
    ['ls', 'function'],
    ['|', 'operator'],
    ['length', 'function'],
    [')', 'punctuation.special'],
    ['\\(', 'string.escape'],
    ['b', 'string'],
    ['\\)', 'string.escape'],
    ['"', 'string'],
    ['+', 'operator'],
    ["$'c", 'string'],
    ['(', 'punctuation.special'],
    ['$x', 'variable'],
    [')', 'punctuation.special'],
    ["'", 'string'],
    ['+', 'operator'],
    ["'d\\n'", 'string'],
    ['+', 'operator'],
    ['`e f`', 'string'],
  ]);
  const code = "let s = \"one\ntwo\" # c\nlet r = r##'a '# b\n'## | str trim\n";
  expect(tokenKinds('nushell', code)).toEqual([
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"one', 'string'],
    ['two"', 'string'],
    ['# c', 'comment'],
    ['let', 'keyword.declaration'],
    ['r', 'variable'],
    ['=', 'operator'],
    ["r##'a '# b", 'string'],
    ["'##", 'string'],
    ['|', 'operator'],
    ['str', 'function'],
    ['trim', null],
  ]);
  assertLineFedParity('nushell', code);
});

test('nushell: comments start words; lists keep items as arguments', () => {
  const code = 'echo a#b # note\nlet l = [\n  foo\n  bar\n]\nls\n';
  expect(tokenKinds('nushell', code)).toEqual([
    ['echo', 'function'],
    ['a#b', null],
    ['# note', 'comment'],
    ['let', 'keyword.declaration'],
    ['l', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['foo', null],
    ['bar', null],
    [']', 'punctuation.bracket'],
    ['ls', 'function'],
  ]);
  assertLineFedParity('nushell', code);
});
