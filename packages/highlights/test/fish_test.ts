import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('fish: commands, options, keywords only at command position', () => {
  expect(tokenKinds('fish', 'echo if end --color=auto -n 42')).toEqual([
    ['echo', 'function'],
    ['if end', null],
    ['--color=auto -n', 'variable.parameter'],
    ['42', 'number'],
  ]);
  expect(
    tokenKinds('fish', 'if test -f x; and not set -q y\nelse if true\nend')
  ).toEqual([
    ['if', 'keyword.control'],
    ['test', 'function'],
    ['-f', 'variable.parameter'],
    ['x', null],
    [';', 'operator'],
    ['and not', 'keyword.control'],
    ['set', 'keyword.declaration'],
    ['-q', 'variable.parameter'],
    ['y', 'variable'],
    ['else if', 'keyword.control'],
    ['true', 'function'],
    ['end', 'keyword.control'],
  ]);
  // pipes, `&&`, and `&` start a command; redirections do not
  expect(tokenKinds('fish', 'a 2>&1 | b && c & d >out')).toEqual([
    ['a', 'function'],
    ['2', 'number'],
    ['>&', 'operator'],
    ['1', 'number'],
    ['|', 'operator'],
    ['b', 'function'],
    ['&&', 'operator'],
    ['c', 'function'],
    ['&', 'operator'],
    ['d', 'function'],
    ['>', 'operator'],
    ['out', null],
  ]);
});

test('fish: declarations name functions and variables', () => {
  expect(
    tokenKinds('fish', 'function greet -a who\nset -gx PATH $PATH\nend')
  ).toEqual([
    ['function', 'keyword.declaration'],
    ['greet', 'function.definition'],
    ['-a', 'variable.parameter'],
    ['who', null],
    ['set', 'keyword.declaration'],
    ['-gx', 'variable.parameter'],
    ['PATH $PATH', 'variable'],
    ['end', 'keyword.control'],
  ]);
  expect(tokenKinds('fish', 'for f in *.txt; command ls $f; end')).toEqual([
    ['for', 'keyword.control'],
    ['f', 'variable'],
    ['in', 'keyword.control'],
    ['*.txt', null],
    [';', 'operator'],
    ['command ls', 'function'],
    ['$f', 'variable'],
    [';', 'operator'],
    ['end', 'keyword.control'],
  ]);
  expect(tokenKinds('fish', 'FOO=1 make')).toEqual([
    ['FOO', 'variable'],
    ['=', 'operator'],
    ['1', null],
    ['make', 'function'],
  ]);
});

test('fish: strings, escapes, expansions, and substitutions', () => {
  expect(
    tokenKinds('fish', `echo "a $x[1..2] \\$ \\n" 'it\\'s \\n' \\x41`)
  ).toEqual([
    ['echo', 'function'],
    ['"a', 'string'],
    ['$x[1..2]', 'variable'],
    ['\\$', 'string.escape'],
    // only `\'` and `\\` escape inside single quotes
    ['\\n" \'it', 'string'],
    ["\\'", 'string.escape'],
    ["s \\n'", 'string'],
    ['\\x41', 'string.escape'],
  ]);
  // a `$(` inside double quotes returns to the string at its `)`
  expect(tokenKinds('fish', 'echo "now $(date +%s) ok" (pwd)')).toEqual([
    ['echo', 'function'],
    ['"now', 'string'],
    ['$(', 'punctuation.special'],
    ['date', 'function'],
    ['+%s', null],
    [')', 'punctuation.special'],
    ['ok"', 'string'],
    ['(', 'punctuation.bracket'],
    ['pwd', 'function'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('fish', 'echo $ a#b # note')).toEqual([
    ['echo', 'function'],
    ['$ a#b', null],
    ['# note', 'comment'],
  ]);
});

test('fish: multi-line strings and joined lines stream like the whole', () => {
  for (const code of [
    'set x "one\n$two (three)\n"; echo $x\n',
    "echo 'a\\'\nb' c\n",
    'echo "a $(\nls -l\n) b"\nnext\n',
    'echo a \\\n  # still a comment\nls \\\r\n  -l\r\n',
  ]) {
    assertLineFedParity('fish', code);
  }
  expect(tokenKinds('fish', 'echo a \\\n  b\nc')).toEqual([
    ['echo', 'function'],
    ['a', null],
    ['\\', 'punctuation.special'],
    ['b', null],
    ['c', 'function'],
  ]);
});
