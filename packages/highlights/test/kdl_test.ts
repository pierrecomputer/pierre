import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('kdl: node names, arguments, properties, and children', () => {
  expect(
    tokenKinds(
      'kdl',
      'package { name "my-pkg"; version 1 }\nuser active=#true age=30 nick'
    )
  ).toEqual([
    ['package', 'tag'],
    ['{', 'punctuation.bracket'],
    ['name', 'tag'],
    ['"my-pkg"', 'string'],
    [';', 'punctuation.delimiter'],
    ['version', 'tag'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    ['user', 'tag'],
    ['active', 'attribute'],
    ['=', 'operator'],
    ['#true', 'boolean'],
    ['age', 'attribute'],
    ['=', 'operator'],
    ['30', 'number'],
    ['nick', 'string'],
  ]);
  // v2 allows blanks around `=`; a quoted node name is still a name
  expect(tokenKinds('kdl', '"my node" key = "v"')).toEqual([
    ['"my node"', 'tag'],
    ['key', 'attribute'],
    ['=', 'operator'],
    ['"v"', 'string'],
  ]);
});

test('kdl: type annotations, numbers, and keywords of v1 and v2', () => {
  expect(
    tokenKinds(
      'kdl',
      '(author)person (u8)0xFF 0o17 0b1010 1_000 -1.5e-3 +2 #false #null #inf #-inf #nan true null -x'
    )
  ).toEqual([
    ['(', 'punctuation.bracket'],
    ['author', 'type'],
    [')', 'punctuation.bracket'],
    ['person', 'tag'],
    ['(', 'punctuation.bracket'],
    ['u8', 'type'],
    [')', 'punctuation.bracket'],
    ['0xFF 0o17 0b1010 1_000 -1.5e-3 +2', 'number'],
    ['#false', 'boolean'],
    ['#null #inf #-inf #nan', 'constant.builtin'],
    ['true', 'boolean'],
    ['null', 'constant.builtin'],
    ['-x', 'string'],
  ]);
});

test('kdl: escapes, raw strings, and multi-line strings', () => {
  const code =
    'a "tab\\t\\u{1F600}\\"" r"C:\\x" r#"say "hi""# #"v2 "raw""# ##"a"#b"##\nb """\n  one "q"\n  """ 5\n';
  expect(tokenKinds('kdl', code)).toEqual([
    ['a', 'tag'],
    ['"tab', 'string'],
    ['\\t\\u{1F600}\\"', 'string.escape'],
    ['" r"C:\\x" r#"say "hi""# #"v2 "raw""# ##"a"#b"##', 'string'],
    ['b', 'tag'],
    ['"""', 'string'],
    ['one "q"', 'string'],
    ['"""', 'string'],
    ['5', 'number'],
  ]);
  assertLineFedParity('kdl', code);
  // v1 strings may span lines
  assertLineFedParity('kdl', 'a "one\ntwo\\\nthree" b\nc r#"x\n"#\nd');
});

test('kdl: comments, nested block comments, and slashdash', () => {
  const code =
    '// line\nnode /* a /* b */\nc */ 1 /-2 3 /-key=(t)v k=4\n/-gone 1 {\n  child\n}\nkept /-{ x } { y }\n';
  expect(tokenKinds('kdl', code)).toEqual([
    ['// line', 'comment'],
    ['node', 'tag'],
    ['/* a /* b */', 'comment'],
    ['c */', 'comment'],
    ['1', 'number'],
    ['/-2', 'comment'],
    ['3', 'number'],
    ['/-key=(t)v', 'comment'],
    ['k', 'attribute'],
    ['=', 'operator'],
    ['4', 'number'],
    ['/-gone 1 {', 'comment'],
    ['child', 'comment'],
    ['}', 'comment'],
    ['kept', 'tag'],
    ['/-{ x }', 'comment'],
    ['{', 'punctuation.bracket'],
    ['y', 'tag'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('kdl', code);
  // a muted child ends at its terminator or at the parent's closing brace
  expect(tokenKinds('kdl', 'a { /-b 1; c }\nd { /-e }')).toEqual([
    ['a', 'tag'],
    ['{', 'punctuation.bracket'],
    ['/-b 1;', 'comment'],
    ['c', 'tag'],
    ['}', 'punctuation.bracket'],
    ['d', 'tag'],
    ['{', 'punctuation.bracket'],
    ['/-e', 'comment'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('kdl: a line continuation joins one line break', () => {
  const code = 'node 1 \\ // more\n  2\nnext \\\n\nlast\n';
  expect(tokenKinds('kdl', code)).toEqual([
    ['node', 'tag'],
    ['1', 'number'],
    ['\\', 'punctuation.special'],
    ['// more', 'comment'],
    ['2', 'number'],
    ['next', 'tag'],
    ['\\', 'punctuation.special'],
    ['last', 'tag'],
  ]);
  assertLineFedParity('kdl', code);
  assertLineFedParity('kdl', code.replaceAll('\n', '\r\n'));
});
