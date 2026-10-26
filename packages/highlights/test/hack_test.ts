import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('hack: code needs no opener, and `?>` closes nothing', () => {
  expect(
    tokenKinds('hack', '<?hh // strict\n$x = 1; // a ?> b\necho $x;')
  ).toEqual([
    ['<?hh', 'preproc'],
    ['// strict', 'comment'],
    ['$x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['// a ?> b', 'comment'],
    ['echo', 'keyword.control'],
    ['$x', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  // without an opener the text is code, not markup
  expect(tokenKinds('hack', '<p>')).toEqual([
    ['<', 'operator'],
    ['p', 'variable'],
    ['>', 'operator'],
  ]);
});

test('hack: keywords, builtin types, and generic type names', () => {
  expect(
    tokenKinds(
      'hack',
      'async function load<T as Foo>(inout vec<T> $xs): Awaitable<this> {}'
    )
  ).toEqual([
    ['async', 'keyword'],
    ['function', 'keyword.declaration'],
    ['load', 'function.definition'],
    ['<', 'operator'],
    ['T', 'type'],
    ['as', 'keyword'],
    ['Foo', 'type'],
    ['>', 'operator'],
    ['(', 'punctuation.bracket'],
    ['inout', 'keyword'],
    ['vec', 'type.builtin'],
    ['<', 'operator'],
    ['T', 'type'],
    ['>', 'operator'],
    ['$xs', 'variable'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['Awaitable', 'type'],
    ['<', 'operator'],
    ['this', 'type.builtin'],
    ['>', 'operator'],
    ['{}', 'punctuation.bracket'],
  ]);
  for (const [word, kind] of [
    ['await', 'keyword.control'],
    ['concurrent', 'keyword.control'],
    ['newtype', 'keyword.declaration'],
    ['is', 'keyword.operator'],
    ['dict', 'type.builtin'],
    ['keyset', 'type.builtin'],
    ['shape', 'type.builtin'],
    ['arraykey', 'type.builtin'],
    ['nonnull', 'type.builtin'],
    ['noreturn', 'type.builtin'],
  ] as const) {
    expect(tokenKinds('hack', `${word} $x;`)[0]).toEqual([word, kind]);
  }
  expect(tokenKinds('hack', 'enum class Color: int {}')).toEqual([
    ['enum class', 'keyword.declaration'],
    ['Color', 'type.class'],
    [':', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    ['{}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('hack', 'const int MAX = 3;')).toEqual([
    ['const', 'keyword.declaration'],
    ['int', 'type.builtin'],
    ['MAX', 'constant'],
    ['=', 'operator'],
    ['3', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('hack: attributes, lambdas, pipes, and null-safe access', () => {
  expect(
    tokenKinds('hack', '<<__Memoize, Oncalls("x")>>\nfunction f(): void {}')
  ).toEqual([
    ['<<__Memoize', 'attribute'],
    [',', 'punctuation.delimiter'],
    ['Oncalls', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"x"', 'string'],
    [')', 'punctuation.bracket'],
    ['>>', 'attribute'],
    ['function', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['()', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['void', 'type.builtin'],
    ['{}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('hack', '$y = $x |> f($$) ?->name;')).toEqual([
    ['$y', 'variable'],
    ['=', 'operator'],
    ['$x', 'variable'],
    ['|>', 'operator'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['$$', 'variable'],
    [')', 'punctuation.bracket'],
    ['?->', 'operator'],
    ['name', 'property'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('hack', '$f = ($n) ==> $n << 2;')).toEqual([
    ['$f', 'variable'],
    ['=', 'operator'],
    ['(', 'punctuation.bracket'],
    ['$n', 'variable'],
    [')', 'punctuation.bracket'],
    ['==>', 'operator'],
    ['$n', 'variable'],
    ['<<', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  // an attribute list ends at a line break, so a line-fed stream agrees
  expect(tokenKinds('hack', '<<\n__Override>>')).toEqual([
    ['<<', 'operator'],
    ['__Override', 'variable'],
    ['>>', 'operator'],
  ]);
});

test('hack: `<<` after a value shifts, elsewhere it opens attributes', () => {
  const code =
    '$m = 1<<BITS;\n$y = $x<<SHIFT >> 2;\nfunction f(<<A>> int $x): void {}\n';
  expect(tokenKinds('hack', code)).toEqual([
    ['$m', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['<<', 'operator'],
    ['BITS', 'constant'],
    [';', 'punctuation.delimiter'],
    ['$y', 'variable'],
    ['=', 'operator'],
    ['$x', 'variable'],
    ['<<', 'operator'],
    ['SHIFT', 'constant'],
    ['>>', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['function', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['<<A>>', 'attribute'],
    ['int', 'type.builtin'],
    ['$x', 'variable'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['void', 'type.builtin'],
    ['{}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('hack', code);
});

test('hack: PHP keeps its own reading after a Hack run', () => {
  tokenKinds('hack', '<<Foo>> function f(): Bar {}');
  expect(tokenKinds('php', '<?php <<Foo>> $a = Bar; // x ?> <b>')).toEqual([
    ['<?php', 'preproc'],
    ['<<', 'operator'],
    ['Foo', 'variable'],
    ['>>', 'operator'],
    ['$a', 'variable'],
    ['=', 'operator'],
    ['Bar', 'variable'],
    [';', 'punctuation.delimiter'],
    ['// x', 'comment'],
    ['?>', 'preproc'],
    ['<', 'punctuation.bracket.html'],
    ['b', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

test('hack: heredocs, comments, and strings resume line-fed', () => {
  for (const code of [
    samples.hack.code,
    '/* a\n<<Foo>> */ $x = <<<EOT\nline $y\nEOT;\n$s = "a\nb";\n',
    '<<Foo("a\nb")>>\nfunction f(): void {}\n',
    "$s = 'x\ny';\nclass A {}\n",
  ]) {
    assertLineFedParity('hack', code);
  }
});

test('hack: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('hack', '$hlHack');
  const rand = makeRand(0x4ac4);
  const alphabet = Array.from('abT_09 $"\'\\\n\r\t{}[]()<>?.,:;=-|#/*@λ😀');
  for (const code of ['', '<', '<?', '<?h', '<<', '<<a', '<<<', '?>', '$']) {
    checkInvariants(lexer.hl, code);
  }
  for (let n = 0; n < 160; n++) {
    const code = Array.from(
      { length: rand() & 63 },
      () => alphabet[rand() % alphabet.length]
    ).join('');
    checkInvariants(lexer.hl, code);
  }
});
