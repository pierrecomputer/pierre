import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('raku: declarators, traits, types, and routines', () => {
  expect(
    tokenKinds(
      'raku',
      'unit module Geo;\nclass Point is Cool does Role is export {\n  has Int $.x is rw;\n  multi method norm(Point:D: --> Num) { sqrt $!x }\n}'
    )
  ).toEqual([
    ['unit module', 'keyword.declaration'],
    ['Geo', 'type'],
    [';', 'punctuation.delimiter'],
    ['class', 'keyword.declaration'],
    ['Point', 'type'],
    ['is', 'keyword'],
    ['Cool', 'type'],
    ['does', 'keyword'],
    ['Role', 'type'],
    ['is', 'keyword'],
    ['export', 'attribute'],
    ['{', 'punctuation.bracket'],
    ['has', 'keyword.declaration'],
    ['Int', 'type'],
    ['$.x', 'property'],
    ['is', 'keyword'],
    ['rw', 'attribute'],
    [';', 'punctuation.delimiter'],
    ['multi method', 'keyword.declaration'],
    ['norm', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['Point:D', 'type'],
    [': -->', 'operator'],
    ['Num', 'type'],
    [') {', 'punctuation.bracket'],
    ['sqrt', 'function'],
    ['$!x', 'property'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
  // `is` before a term is the Test routine
  expect(tokenKinds('raku', 'use Test; is foo(), 42;')).toEqual([
    ['use', 'keyword.import'],
    ['Test', 'namespace'],
    [';', 'punctuation.delimiter'],
    ['is foo', 'function'],
    ['()', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['42', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('raku: sigils, twigils, pairs, and subscripts', () => {
  expect(
    tokenKinds(
      'raku',
      'f($^a, $:n, @*ARGS, $?FILE, &g, $_, $/, $0, %h<key>, $<name>, :a<b>, :!c, :$d, e => 1)'
    )
  ).toEqual([
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['$^a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['$:n', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['@*ARGS', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['$?FILE', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['&g', 'function'],
    [',', 'punctuation.delimiter'],
    ['$_', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['$/', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['$0', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['%h', 'variable'],
    ['<key>', 'string'],
    [',', 'punctuation.delimiter'],
    ['$', 'variable.special'],
    ['<name>', 'string'],
    [',', 'punctuation.delimiter'],
    [':a', 'string.special.symbol'],
    ['<b>', 'string'],
    [',', 'punctuation.delimiter'],
    [':!c', 'string.special.symbol'],
    [',', 'punctuation.delimiter'],
    [':', 'string.special.symbol'],
    ['$d', 'variable'],
    [',', 'punctuation.delimiter'],
    ['e', 'string.special.symbol'],
    ['=>', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  // kebab-case names, and `-` before a digit subtracts
  expect(tokenKinds('raku', 'my $is-ok = $x-1 % 2;')).toEqual([
    ['my', 'keyword.declaration'],
    ['$is-ok', 'variable'],
    ['=', 'operator'],
    ['$x', 'variable'],
    ['-', 'operator'],
    ['1', 'number'],
    ['%', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('raku: strings, interpolation, quote words, and code blocks', () => {
  expect(
    tokenKinds(
      'raku',
      `say "x=$x @a[] {$y + 1}\\n", 'it\\'s \\d', <a b>, ｢raw｣;`
    )
  ).toEqual([
    ['say', 'function'],
    ['"x=', 'string'],
    ['$x', 'variable'],
    ['@a', 'variable'],
    ['[]', 'string'],
    ['{', 'punctuation.special'],
    ['$y', 'variable'],
    ['+', 'operator'],
    ['1', 'number'],
    ['}', 'punctuation.special'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [',', 'punctuation.delimiter'],
    ["'it", 'string'],
    ["\\'", 'string.escape'],
    ["s \\d'", 'string'],
    [',', 'punctuation.delimiter'],
    ['<a b>', 'string'],
    [',', 'punctuation.delimiter'],
    ['｢raw｣', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('raku', 'my @w = qw<a b>, qq{n {1}}, Q[x], q:w/y z/;')
  ).toEqual([
    ['my', 'keyword.declaration'],
    ['@w', 'variable'],
    ['=', 'operator'],
    ['qw<a b>', 'string'],
    [',', 'punctuation.delimiter'],
    ['qq{n {1}}', 'string'],
    [',', 'punctuation.delimiter'],
    ['Q[x]', 'string'],
    [',', 'punctuation.delimiter'],
    ['q:w/y z/', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('raku: regexes, substitutions, and grammar bodies', () => {
  expect(
    tokenKinds(
      'raku',
      'if $s ~~ /^ \\d+ $/ { $s ~~ s:g/a/b/; tr{a}{b}; m:i/x/ } say 10 / 2 // 1;'
    )
  ).toEqual([
    ['if', 'keyword.control'],
    ['$s', 'variable'],
    ['~~', 'operator'],
    ['/^', 'string.regex'],
    ['\\d', 'string.escape'],
    ['+ $/', 'string.regex'],
    ['{', 'punctuation.bracket'],
    ['$s', 'variable'],
    ['~~', 'operator'],
    ['s:g/a/b/', 'string.regex'],
    [';', 'punctuation.delimiter'],
    ['tr{a}{b}', 'string.regex'],
    [';', 'punctuation.delimiter'],
    ['m:i/x/', 'string.regex'],
    ['}', 'punctuation.bracket'],
    ['say', 'function'],
    ['10', 'number'],
    ['/', 'operator'],
    ['2', 'number'],
    ['//', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  const code =
    "grammar G {\n  token TOP { <x>+ % ','\n    \\} }\n  rule x { \\w+ }\n}\n";
  expect(tokenKinds('raku', code)).toEqual([
    ['grammar', 'keyword.declaration'],
    ['G', 'type'],
    ['{', 'punctuation.bracket'],
    ['token', 'keyword.declaration'],
    ['TOP', 'function.definition'],
    ["{ <x>+ % ','", 'string.regex'],
    ['\\}', 'string.escape'],
    ['}', 'string.regex'],
    ['rule', 'keyword.declaration'],
    ['x', 'function.definition'],
    ['{', 'string.regex'],
    ['\\w', 'string.escape'],
    ['+ }', 'string.regex'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('raku', code);
});

test('raku: operators, reductions, hyper operators, and numbers', () => {
  expect(
    tokenKinds('raku', 'say [+] @a».abs X× 1_000, 0x1F, 1e3 ∈ $set;')
  ).toEqual([
    ['say', 'function'],
    ['[+]', 'operator'],
    ['@a', 'variable'],
    ['»', 'operator'],
    ['.', 'punctuation.delimiter'],
    ['abs', 'function.method'],
    ['X', 'type'],
    ['×', 'operator'],
    ['1_000', 'number'],
    [',', 'punctuation.delimiter'],
    ['0x1F', 'number'],
    [',', 'punctuation.delimiter'],
    ['1e3', 'number'],
    ['∈', 'operator'],
    ['$set', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('raku', '$x.^name; @a>>.say; 1..10 ==> map *+1 x 2')
  ).toEqual([
    ['$x', 'variable'],
    ['.^', 'punctuation.delimiter'],
    ['name', 'function.method'],
    [';', 'punctuation.delimiter'],
    ['@a', 'variable'],
    ['>>', 'operator'],
    ['.', 'punctuation.delimiter'],
    ['say', 'function.method'],
    [';', 'punctuation.delimiter'],
    ['1', 'number'],
    ['..', 'operator'],
    ['10', 'number'],
    ['==>', 'operator'],
    ['map', 'function'],
    ['*+', 'operator'],
    ['1', 'number'],
    ['x', 'keyword.operator'],
    ['2', 'number'],
  ]);
});

test('raku: comments, Pod, and heredocs span lines', () => {
  const code = [
    '#| doc',
    'sub f { #`[ embedded',
    '  [nested] ] 1 }',
    '=begin pod',
    '=head1 Title',
    '=end pod',
    '=head2 Para',
    'more text',
    '',
    'my $t = qq:to/END/;',
    '  body $x',
    '  END',
    'say $t; # done',
    '=finish',
    'rest',
    '',
  ].join('\n');
  expect(tokenKinds('raku', code)).toEqual([
    ['#| doc', 'comment.doc'],
    ['sub', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['{', 'punctuation.bracket'],
    ['#`[ embedded', 'comment'],
    ['[nested] ]', 'comment'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    ['=begin pod', 'comment.doc'],
    ['=head1 Title', 'comment.doc'],
    ['=end pod', 'comment.doc'],
    ['=head2 Para', 'comment.doc'],
    ['more text', 'comment.doc'],
    ['my', 'keyword.declaration'],
    ['$t', 'variable'],
    ['=', 'operator'],
    ['qq:to/END/', 'string'],
    [';', 'punctuation.delimiter'],
    ['body $x', 'string'],
    ['END', 'string'],
    ['say', 'function'],
    ['$t', 'variable'],
    [';', 'punctuation.delimiter'],
    ['# done', 'comment'],
    ['=finish', 'comment.doc'],
    ['rest', 'comment.doc'],
  ]);
  assertLineFedParity('raku', code);
  assertLineFedParity('raku', code.replaceAll('\n', '\r\n'));
});

test('raku: term builtins compare with `<`, and slurpy hashes keep their sigil', () => {
  const code = 'say 1 if now < $t;\nmy $n = pi < e;\nsub f(*%opts, |%h) { }\n';
  expect(tokenKinds('raku', code)).toEqual([
    ['say', 'function'],
    ['1', 'number'],
    ['if', 'keyword.control'],
    ['now', 'function'],
    ['<', 'operator'],
    ['$t', 'variable'],
    [';', 'punctuation.delimiter'],
    ['my', 'keyword.declaration'],
    ['$n', 'variable'],
    ['=', 'operator'],
    ['pi', 'constant.builtin'],
    ['<', 'operator'],
    ['e', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['sub', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['*', 'operator'],
    ['%opts', 'variable'],
    [',', 'punctuation.delimiter'],
    ['|', 'operator'],
    ['%h', 'variable'],
    [') { }', 'punctuation.bracket'],
  ]);
  assertLineFedParity('raku', code);
});

test('raku: many plain strings lex in linear time', () => {
  // each string start searched the rest of the input for `{`, `$`, or `@`
  const code = '"a" '.repeat(100000);
  const start = performance.now();
  tokenKinds('raku', code);
  expect(performance.now() - start).toBeLessThan(250);
  expect(tokenKinds('raku', '"a $x {1}" "b"')).toEqual([
    ['"a', 'string'],
    ['$x', 'variable'],
    ['{', 'punctuation.special'],
    ['1', 'number'],
    ['}', 'punctuation.special'],
    ['" "b"', 'string'],
  ]);
});
