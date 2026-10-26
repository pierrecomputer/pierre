import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('codeql: imports, modules, classes, and predicate definitions', () => {
  expect(
    tokenKinds(
      'codeql',
      'import semmle.code.java.DataFlow\nclass Call extends MethodAccess {\n  override string getName() { result = "x" }\n}\npredicate isSink(DataFlow::Node n) { none() }'
    )
  ).toEqual([
    ['import', 'keyword.import'],
    ['semmle', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['code', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['java', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['DataFlow', 'namespace'],
    ['class', 'keyword.declaration'],
    ['Call', 'type'],
    ['extends', 'keyword'],
    ['MethodAccess', 'type'],
    ['{', 'punctuation.bracket'],
    ['override', 'keyword'],
    ['string', 'type.builtin'],
    ['getName', 'function.definition'],
    ['() {', 'punctuation.bracket'],
    ['result', 'variable.special'],
    ['=', 'operator'],
    ['"x"', 'string'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['predicate', 'keyword.declaration'],
    ['isSink', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['DataFlow', 'namespace'],
    ['::', 'punctuation.delimiter'],
    ['Node', 'type'],
    ['n', 'variable'],
    [') {', 'punctuation.bracket'],
    ['none', 'keyword'],
    ['() }', 'punctuation.bracket'],
  ]);
});

test('codeql: queries, quantifiers, calls, annotations, and database types', () => {
  expect(
    tokenKinds(
      'codeql',
      'pragma[inline] bindingset[x]\nfrom Call c, int n\nwhere exists(@expr e | c.getArg(n) = e) and not n != 2\nselect c, "a\\tb", 1.5, true'
    )
  ).toEqual([
    ['pragma[inline] bindingset[x]', 'attribute'],
    ['from', 'keyword.control'],
    ['Call', 'type'],
    ['c', 'variable'],
    [',', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    ['n', 'variable'],
    ['where exists', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['@expr', 'type'],
    ['e', 'variable'],
    ['|', 'operator'],
    ['c', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['getArg', 'function'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['e', 'variable'],
    [')', 'punctuation.bracket'],
    ['and not', 'keyword.operator'],
    ['n', 'variable'],
    ['!=', 'operator'],
    ['2', 'number'],
    ['select', 'keyword.control'],
    ['c', 'variable'],
    [',', 'punctuation.delimiter'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
    [',', 'punctuation.delimiter'],
    ['1.5', 'number'],
    [',', 'punctuation.delimiter'],
    ['true', 'boolean'],
  ]);
});

test('codeql: QLDoc and block comments span lines', () => {
  const code =
    '/**\n * Holds if λ😀 <&>\n */\npredicate p() { /* a\n b */ any() }\n/**/ int x() { result = 1 }\n';
  expect(tokenKinds('codeql', code)).toEqual([
    ['/**', 'comment.doc'],
    ['* Holds if λ😀 <&>', 'comment.doc'],
    ['*/', 'comment.doc'],
    ['predicate', 'keyword.declaration'],
    ['p', 'function.definition'],
    ['() {', 'punctuation.bracket'],
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['any', 'keyword'],
    ['() }', 'punctuation.bracket'],
    ['/**/', 'comment'],
    ['int', 'type.builtin'],
    ['x', 'function.definition'],
    ['() {', 'punctuation.bracket'],
    ['result', 'variable.special'],
    ['=', 'operator'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('codeql', code);
});
