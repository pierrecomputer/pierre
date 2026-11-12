import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('cue: packages, fields, definitions, and constraints', () => {
  expect(
    tokenKinds(
      'cue',
      'package svc\n#Port: uint16 & >=1 | *8080\nname!: string\nport?: #Port\n_x: _#Hidden'
    )
  ).toEqual([
    ['package', 'keyword.declaration'],
    ['svc', 'namespace'],
    ['#Port', 'type'],
    [':', 'punctuation.delimiter'],
    ['uint16', 'type.builtin'],
    ['& >=', 'operator'],
    ['1', 'number'],
    ['| *', 'operator'],
    ['8080', 'number'],
    ['name', 'property'],
    ['!', 'operator'],
    [':', 'punctuation.delimiter'],
    ['string', 'type.builtin'],
    ['port', 'property'],
    ['?', 'operator'],
    [':', 'punctuation.delimiter'],
    ['#Port', 'type'],
    ['_x', 'property'],
    [':', 'punctuation.delimiter'],
    ['_#Hidden', 'type'],
  ]);
  expect(
    tokenKinds('cue', 'a: _\nb: _|_\nc: [...int]\nd: 1Gi + .5\n@go(A)')
  ).toEqual([
    ['a', 'property'],
    [':', 'punctuation.delimiter'],
    ['_', 'type.builtin'],
    ['b', 'property'],
    [':', 'punctuation.delimiter'],
    ['_|_', 'constant.builtin'],
    ['c', 'property'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['...', 'operator'],
    ['int', 'type.builtin'],
    [']', 'punctuation.bracket'],
    ['d', 'property'],
    [':', 'punctuation.delimiter'],
    ['1Gi', 'number'],
    ['+', 'operator'],
    ['.5', 'number'],
    ['@go', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['A', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('cue: comprehensions, let, and calls', () => {
  expect(
    tokenKinds('cue', 'let p = "x"\nfor k, v in m if v != null { (k): len(v) }')
  ).toEqual([
    ['let', 'keyword'],
    ['p', 'variable'],
    ['=', 'operator'],
    ['"x"', 'string'],
    ['for', 'keyword.control'],
    ['k', 'variable'],
    [',', 'punctuation.delimiter'],
    ['v', 'variable'],
    ['in', 'keyword.control'],
    ['m', 'variable'],
    ['if', 'keyword.control'],
    ['v', 'variable'],
    ['!=', 'operator'],
    ['null', 'constant.builtin'],
    ['{ (', 'punctuation.bracket'],
    ['k', 'variable'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['len', 'function'],
    ['(', 'punctuation.bracket'],
    ['v', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
});

test('cue: interpolation, bytes, raw and multi-line strings', () => {
  expect(
    tokenKinds(
      'cue',
      'm: "a\\(x)\\n" & =~"^b$"\nb: \'\\x41\'\nr: #"\\d \\#(x)"#'
    )
  ).toEqual([
    ['m', 'property'],
    [':', 'punctuation.delimiter'],
    ['"a', 'string'],
    ['\\(', 'punctuation.special'],
    ['x', 'variable'],
    [')', 'punctuation.special'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    ['& =~', 'operator'],
    ['"^b$"', 'string'],
    ['b', 'property'],
    [':', 'punctuation.delimiter'],
    ["'", 'string'],
    ['\\x41', 'string.escape'],
    ["'", 'string'],
    ['r', 'property'],
    [':', 'punctuation.delimiter'],
    ['#"\\d', 'string'],
    ['\\#(', 'punctuation.special'],
    ['x', 'variable'],
    [')', 'punctuation.special'],
    ['"#', 'string'],
  ]);
  const code =
    'doc: """\n\tone \\(x)\n\t"""\nb: \'\'\'\n\tbytes\n\t\'\'\'\n// end\n';
  expect(tokenKinds('cue', code)).toEqual([
    ['doc', 'property'],
    [':', 'punctuation.delimiter'],
    ['"""', 'string'],
    ['one', 'string'],
    ['\\(', 'punctuation.special'],
    ['x', 'variable'],
    [')', 'punctuation.special'],
    ['"""', 'string'],
    ['b', 'property'],
    [':', 'punctuation.delimiter'],
    ["'''", 'string'],
    ['bytes', 'string'],
    ["'''", 'string'],
    ['// end', 'comment'],
  ]);
  assertLineFedParity('cue', code);
  // an escaped line break continues a one-line string
  assertLineFedParity('cue', 'a: "x\\\ny"\nb: 1\n');
});
