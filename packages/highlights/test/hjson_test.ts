import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('hjson: unquoted keys, quoteless values, and literals', () => {
  expect(
    tokenKinds(
      'hjson',
      'name: my app λ😀 <&>\nport: 8080\nok: true\nnone: null'
    )
  ).toEqual([
    ['name', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['my app λ😀 <&>', 'string'],
    ['port', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['8080', 'number'],
    ['ok', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['true', 'boolean'],
    ['none', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['null', 'constant.builtin'],
  ]);
  // a literal followed by more text is a quoteless string, comments included
  for (const value of ['5 apples', 'true story', '1.2.3 # v', 'x // y']) {
    expect(tokenKinds('hjson', `a: ${value}`)).toEqual([
      ['a', 'property.json_key'],
      [':', 'punctuation.delimiter'],
      [value, 'string'],
    ]);
  }
  // a literal ends at a comma, closing bracket, or comment
  expect(tokenKinds('hjson', 'a: -1.5e3, b: false # c\nd: 2 /* e */')).toEqual([
    ['a', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['-1.5e3', 'number'],
    [',', 'punctuation.delimiter'],
    ['b', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['false', 'boolean'],
    ['# c', 'comment'],
    ['d', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
    ['/* e */', 'comment'],
  ]);
});

test('hjson: quoted keys and strings, objects, and arrays', () => {
  expect(
    tokenKinds('hjson', '{ "k": "a\\tb", \'s\': \'x\', list: [1, two, three] }')
  ).toEqual([
    ['{', 'punctuation.bracket'],
    ['"k"', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
    [',', 'punctuation.delimiter'],
    ["'s'", 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ["'x'", 'string'],
    [',', 'punctuation.delimiter'],
    ['list', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['two, three] }', 'string'],
  ]);
  // array items on their own lines are values, and object members are keys
  const code = 'a: [\n  x\n  "y"\n  { b: 1 }\n]\nc: 2\n';
  expect(tokenKinds('hjson', code)).toEqual([
    ['a', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['x', 'string'],
    ['"y"', 'string'],
    ['{', 'punctuation.bracket'],
    ['b', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    [']', 'punctuation.bracket'],
    ['c', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
  ]);
  assertLineFedParity('hjson', code);
});

test('hjson: multi-line strings and block comments span lines', () => {
  const code =
    "text:\n  '''\n  first: line\n  [second]\n  '''\n/* a\nb */ k: v\n";
  expect(tokenKinds('hjson', code)).toEqual([
    ['text', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ["'''", 'string'],
    ['first: line', 'string'],
    ['[second]', 'string'],
    ["'''", 'string'],
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['k', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['v', 'string'],
  ]);
  assertLineFedParity('hjson', code);
  assertLineFedParity('hjson', "a: '''\nopen");
});
