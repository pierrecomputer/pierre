import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('puppet: classes, parameters, and resources', () => {
  expect(
    tokenKinds(
      'puppet',
      "class web::app (\n  String $name = $web::params::name,\n) inherits web::params {\n  file { '/tmp/x':\n    ensure => present,\n    require => Package['curl'],\n  }\n}"
    )
  ).toEqual([
    ['class', 'keyword.declaration'],
    ['web::app', 'type'],
    ['(', 'punctuation.bracket'],
    ['String', 'type'],
    ['$name', 'variable.parameter'],
    ['=', 'operator'],
    ['$web::params::name', 'variable'],
    [',', 'punctuation.delimiter'],
    [')', 'punctuation.bracket'],
    ['inherits', 'keyword'],
    ['web::params', 'type'],
    ['{', 'punctuation.bracket'],
    ['file', 'type'],
    ['{', 'punctuation.bracket'],
    ["'/tmp/x'", 'string'],
    [':', 'punctuation.delimiter'],
    ['ensure', 'property'],
    ['=>', 'operator'],
    ['present', 'constant'],
    [',', 'punctuation.delimiter'],
    ['require', 'property'],
    ['=>', 'operator'],
    ['Package', 'type'],
    ['[', 'punctuation.bracket'],
    ["'curl'", 'string'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('puppet: control flow, regexes, functions, and lambdas', () => {
  expect(
    tokenKinds(
      'puppet',
      'if $os =~ /^(Debian|Ubuntu)\\/x$/ and !$x { $y = $a / 2 }\nnode /^web\\d+$/ { include role::web }\n$list.each |$i| { notice($i) }'
    )
  ).toEqual([
    ['if', 'keyword.control'],
    ['$os', 'variable'],
    ['=~', 'operator'],
    ['/^(Debian|Ubuntu)\\/x$/', 'string.regex'],
    ['and', 'keyword.operator'],
    ['!', 'operator'],
    ['$x', 'variable'],
    ['{', 'punctuation.bracket'],
    ['$y', 'variable'],
    ['=', 'operator'],
    ['$a', 'variable'],
    ['/', 'operator'],
    ['2', 'number'],
    ['}', 'punctuation.bracket'],
    ['node', 'keyword.declaration'],
    ['/^web\\d+$/', 'string.regex'],
    ['{', 'punctuation.bracket'],
    ['include', 'keyword.import'],
    ['role::web', 'type'],
    ['}', 'punctuation.bracket'],
    ['$list', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['each', 'function'],
    ['|', 'operator'],
    ['$i', 'variable'],
    ['|', 'operator'],
    ['{', 'punctuation.bracket'],
    ['notice', 'function'],
    ['(', 'punctuation.bracket'],
    ['$i', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('puppet', "$m = $x ? { 'a' => 1, default => 2 }")).toEqual([
    ['$m', 'variable'],
    ['=', 'operator'],
    ['$x', 'variable'],
    ['?', 'operator'],
    ['{', 'punctuation.bracket'],
    ["'a'", 'string'],
    ['=>', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['default', 'keyword'],
    ['=>', 'operator'],
    ['2', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('puppet', '@@user { x: uid => 0x1F } -> Service[a]')
  ).toEqual([
    ['@@', 'operator'],
    ['user', 'type'],
    ['{', 'punctuation.bracket'],
    ['x', null],
    [':', 'punctuation.delimiter'],
    ['uid', 'property'],
    ['=>', 'operator'],
    ['0x1F', 'number'],
    ['}', 'punctuation.bracket'],
    ['->', 'operator'],
    ['Service', 'type'],
    ['[', 'punctuation.bracket'],
    ['a', null],
    [']', 'punctuation.bracket'],
  ]);
});

test('puppet: strings, interpolation, and escapes', () => {
  expect(
    tokenKinds(
      'puppet',
      `$s = "a \${facts['x']} $b::c \\u{1F600}\\t" + 'it\\'s \\n'`
    )
  ).toEqual([
    ['$s', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['${', 'punctuation.special'],
    ["facts['x']", 'variable'],
    ['}', 'punctuation.special'],
    ['$b::c', 'variable'],
    ['\\u{1F600}\\t', 'string.escape'],
    ['"', 'string'],
    ['+', 'operator'],
    ["'it", 'string'],
    ["\\'", 'string.escape'],
    ["s \\n'", 'string'],
  ]);
});

test('puppet: heredocs end at their tag, expanding only quoted tags', () => {
  const code =
    '$a = @("EOT"/L)\n  hi ${x} $y\n  |- EOT\n$b = @(END:json)\n  $z\nEND\n$c = 1\n';
  expect(tokenKinds('puppet', code)).toEqual([
    ['$a', 'variable'],
    ['=', 'operator'],
    ['@("EOT"/L)', 'string'],
    ['hi', 'string'],
    ['${', 'punctuation.special'],
    ['x', 'variable'],
    ['}', 'punctuation.special'],
    ['$y', 'variable'],
    ['|- EOT', 'string'],
    ['$b', 'variable'],
    ['=', 'operator'],
    ['@(END:json)', 'string'],
    ['$z', 'string'],
    ['END', 'string'],
    ['$c', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  for (const text of [
    code,
    code.replaceAll('\n', '\r\n'),
    '$a = @(X) # note\nbody /* x\nX\n/* open\nstill */ $b = "multi\nline"\n',
    '$a = @(LONG)\nnever ends\n',
  ]) {
    assertLineFedParity('puppet', text);
  }
});
