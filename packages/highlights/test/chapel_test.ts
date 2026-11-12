import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('chapel: modules, uses, and declarations', () => {
  expect(
    tokenKinds(
      'chapel',
      'module Heat {\n  use IO, Math;\n  config const n = 100;\n}'
    )
  ).toEqual([
    ['module', 'keyword.declaration'],
    ['Heat', 'namespace'],
    ['{', 'punctuation.bracket'],
    ['use', 'keyword.import'],
    ['IO', 'namespace'],
    [',', 'punctuation.delimiter'],
    ['Math', 'namespace'],
    [';', 'punctuation.delimiter'],
    ['config const', 'keyword.declaration'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['100', 'number'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'chapel',
    'module Heat {\n  use IO, Math;\n  config const n = 100;\n}'
  );
  expect(
    tokenKinds(
      'chapel',
      'record Point { var x, y: real; }\nclass Node { var next: owned Node?; }'
    )
  ).toEqual([
    ['record', 'keyword.declaration'],
    ['Point', 'type'],
    ['{', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['y', 'variable'],
    [':', 'punctuation.delimiter'],
    ['real', 'type.builtin'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['class', 'keyword.declaration'],
    ['Node', 'type'],
    ['{', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['next', 'variable'],
    [':', 'punctuation.delimiter'],
    ['owned', 'keyword'],
    ['Node', 'type'],
    ['?', 'operator'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'chapel',
    'record Point { var x, y: real; }\nclass Node { var next: owned Node?; }'
  );
});

test('chapel: procedures, iterators, and methods', () => {
  expect(
    tokenKinds(
      'chapel',
      'proc Point.norm(): real { return sqrt(x**2 + y**2); }'
    )
  ).toEqual([
    ['proc', 'keyword.declaration'],
    ['Point', 'type'],
    ['.', 'punctuation.delimiter'],
    ['norm', 'function.definition'],
    ['()', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['real', 'type.builtin'],
    ['{', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['sqrt', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['**', 'operator'],
    ['2', 'number'],
    ['+', 'operator'],
    ['y', 'variable'],
    ['**', 'operator'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('chapel', 'iter fib(n: int): int { var a = 0; yield a; }')
  ).toEqual([
    ['iter', 'keyword.declaration'],
    ['fib', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [':', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    ['{', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['0', 'number'],
    [';', 'punctuation.delimiter'],
    ['yield', 'keyword.control'],
    ['a', 'variable'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'chapel',
      'operator +(a: Point, b: Point) { return new Point(a.x + b.x); }'
    )
  ).toEqual([
    ['operator', 'keyword.declaration'],
    ['+', 'operator'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Point', 'type'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Point', 'type'],
    [') {', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['new', 'keyword'],
    ['Point', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['+', 'operator'],
    ['b', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('chapel: parallel loops, ranges, and builtins', () => {
  expect(
    tokenKinds(
      'chapel',
      'forall i in 1..n with (+ reduce sum) do A[i] = i * 2.0;'
    )
  ).toEqual([
    ['forall', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['1', 'number'],
    ['..', 'operator'],
    ['n', 'variable'],
    ['with', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['+', 'operator'],
    ['reduce', 'keyword'],
    ['sum', 'variable'],
    [')', 'punctuation.bracket'],
    ['do', 'keyword.control'],
    ['A', 'type'],
    ['[', 'punctuation.bracket'],
    ['i', 'variable'],
    [']', 'punctuation.bracket'],
    ['=', 'operator'],
    ['i', 'variable'],
    ['*', 'operator'],
    ['2.0', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'chapel',
      'coforall loc in Locales do on loc { writeln(here.id); }'
    )
  ).toEqual([
    ['coforall', 'keyword.control'],
    ['loc', 'variable'],
    ['in', 'keyword.operator'],
    ['Locales', 'type'],
    ['do on', 'keyword.control'],
    ['loc', 'variable'],
    ['{', 'punctuation.bracket'],
    ['writeln', 'function'],
    ['(', 'punctuation.bracket'],
    ['here', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['id', 'property'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'chapel',
      'for i in 0..<n by 2 { if i == 4 then break; } var D = {1..n} # 3;'
    )
  ).toEqual([
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['0', 'number'],
    ['..<', 'operator'],
    ['n', 'variable'],
    ['by', 'keyword'],
    ['2', 'number'],
    ['{', 'punctuation.bracket'],
    ['if', 'keyword.control'],
    ['i', 'variable'],
    ['==', 'operator'],
    ['4', 'number'],
    ['then break', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['D', 'type'],
    ['=', 'operator'],
    ['{', 'punctuation.bracket'],
    ['1', 'number'],
    ['..', 'operator'],
    ['n', 'variable'],
    ['}', 'punctuation.bracket'],
    ['#', 'operator'],
    ['3', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('chapel: strings, bytes, and comments', () => {
  expect(
    tokenKinds('chapel', 'writeln("tab\\there", \'single\', b"bytes");')
  ).toEqual([
    ['writeln', 'function'],
    ['(', 'punctuation.bracket'],
    ['"tab', 'string'],
    ['\\t', 'string.escape'],
    ['here"', 'string'],
    [',', 'punctuation.delimiter'],
    ["'single'", 'string'],
    [',', 'punctuation.delimiter'],
    ['b"bytes"', 'string'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('chapel', 'const s = """one\n  "two"\nthree""";')).toEqual([
    ['const', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"""one', 'string'],
    ['"two"', 'string'],
    ['three"""', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('chapel', 'const s = """one\n  "two"\nthree""";');
  expect(tokenKinds('chapel', "const t = '''a\nb''';")).toEqual([
    ['const', 'keyword.declaration'],
    ['t', 'variable'],
    ['=', 'operator'],
    ["'''a", 'string'],
    ["b'''", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('chapel', "const t = '''a\nb''';");
  expect(
    tokenKinds('chapel', '/* a /* nested */\n still */ // line\nvar x = nil;')
  ).toEqual([
    ['/* a /* nested */', 'comment'],
    ['still */ // line', 'comment'],
    ['var', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['nil', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'chapel',
    '/* a /* nested */\n still */ // line\nvar x = nil;'
  );
});

test('chapel: atomic and label are keywords', () => {
  const code = 'var x: atomic int;\nlabel outer for i in 1..3 {}\n';
  expect(tokenKinds('chapel', code)).toEqual([
    ['var', 'keyword.declaration'],
    ['x', 'variable'],
    [':', 'punctuation.delimiter'],
    ['atomic', 'keyword'],
    ['int', 'type.builtin'],
    [';', 'punctuation.delimiter'],
    ['label', 'keyword.control'],
    ['outer', 'variable'],
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    ['{}', 'punctuation.bracket'],
  ]);
});
