import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('pkl: modules, imports, classes, and properties', () => {
  expect(
    tokenKinds(
      'pkl',
      'module com.example.Server\nimport "pkl:json"\nopen class A extends B {\n  hidden port: Int = 8_080\n}'
    )
  ).toEqual([
    ['module', 'keyword.declaration'],
    ['com', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['example', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Server', 'type'],
    ['import', 'keyword.import'],
    ['"pkl:json"', 'string'],
    ['open', 'keyword'],
    ['class', 'keyword.declaration'],
    ['A', 'type'],
    ['extends', 'keyword'],
    ['B', 'type'],
    ['{', 'punctuation.bracket'],
    ['hidden', 'keyword'],
    ['port', 'property'],
    [':', 'punctuation.delimiter'],
    ['Int', 'type'],
    ['=', 'operator'],
    ['8_080', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  // `module.x` is a reference; members after `.` are properties
  expect(tokenKinds('pkl', 'x = module.name\ny { a = 5.min }')).toEqual([
    ['x', 'property'],
    ['=', 'operator'],
    ['module', 'keyword.declaration'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['y', 'property'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    ['=', 'operator'],
    ['5', 'number'],
    ['.', 'punctuation.delimiter'],
    ['min', 'property'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('pkl: functions, annotations, constraints, and generators', () => {
  expect(
    tokenKinds(
      'pkl',
      '@Deprecated { message = "x" }\ntypealias P = UInt16(isBetween(1, 2))\nfunction f(a: String): Int = a.length'
    )
  ).toEqual([
    ['@Deprecated', 'attribute'],
    ['{', 'punctuation.bracket'],
    ['message', 'property'],
    ['=', 'operator'],
    ['"x"', 'string'],
    ['}', 'punctuation.bracket'],
    ['typealias', 'keyword.declaration'],
    ['P', 'type'],
    ['=', 'operator'],
    ['UInt16', 'type'],
    ['(', 'punctuation.bracket'],
    ['isBetween', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    ['))', 'punctuation.bracket'],
    ['function', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['String', 'type'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['Int', 'type'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['length', 'property'],
  ]);
  expect(
    tokenKinds('pkl', 'when (x) { new { } } else { }\nfor (k, v in m) { v }')
  ).toEqual([
    ['when', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [') {', 'punctuation.bracket'],
    ['new', 'keyword'],
    ['{ } }', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{ }', 'punctuation.bracket'],
    ['for', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['k', 'variable'],
    [',', 'punctuation.delimiter'],
    ['v', 'variable'],
    ['in', 'keyword.control'],
    ['m', 'variable'],
    [') {', 'punctuation.bracket'],
    ['v', 'variable'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('pkl: interpolation, custom delimiters, and multi-line strings', () => {
  expect(
    tokenKinds('pkl', 'u = "http://\\(host):\\(f(1))/\\u{1F600}"')
  ).toEqual([
    ['u', 'property'],
    ['=', 'operator'],
    ['"http://', 'string'],
    ['\\(', 'punctuation.special'],
    ['host', 'variable'],
    [')', 'punctuation.special'],
    [':', 'string'],
    ['\\(', 'punctuation.special'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    [')', 'punctuation.special'],
    ['/', 'string'],
    ['\\u{1F600}', 'string.escape'],
    ['"', 'string'],
  ]);
  // in `#"…"#`, only `\#` escapes; a lone `"` does not close
  expect(tokenKinds('pkl', 'r = #"C:\\p "q" \\#(x) \\#n"#')).toEqual([
    ['r', 'property'],
    ['=', 'operator'],
    ['#"C:\\p "q"', 'string'],
    ['\\#(', 'punctuation.special'],
    ['x', 'variable'],
    [')', 'punctuation.special'],
    ['\\#n', 'string.escape'],
    ['"#', 'string'],
  ]);
  const code =
    'b = """\n  Hi, \\(name\n    .trim())!\n  "quoted"\n  """\nnext = 1\n';
  expect(tokenKinds('pkl', code)).toEqual([
    ['b', 'property'],
    ['=', 'operator'],
    ['"""', 'string'],
    ['Hi,', 'string'],
    ['\\(', 'punctuation.special'],
    ['name', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['trim', 'function'],
    ['()', 'punctuation.bracket'],
    [')', 'punctuation.special'],
    ['!', 'string'],
    ['"quoted"', 'string'],
    ['"""', 'string'],
    ['next', 'property'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('pkl', code);
  assertLineFedParity('pkl', 's = "a\\(x + "\\(y)")b"\n/* one\ntwo */ c = 1\n');
});
