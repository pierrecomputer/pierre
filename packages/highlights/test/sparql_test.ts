import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('sparql: case-insensitive keywords, variables, and triple patterns', () => {
  expect(
    tokenKinds(
      'sparql',
      'select distinct ?s $o where { ?s a ex:Book ; ex:title ?o . }\nOrder By ?s limit 5'
    )
  ).toEqual([
    ['select distinct', 'keyword'],
    ['?s $o', 'variable'],
    ['where', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['?s', 'variable'],
    ['a', 'keyword'],
    ['ex:', 'namespace'],
    ['Book', 'type'],
    [';', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['title', 'property'],
    ['?o', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['Order By', 'keyword'],
    ['?s', 'variable'],
    ['limit', 'keyword'],
    ['5', 'number'],
  ]);
});

test('sparql: built-in calls, IRI calls, and operators in filters', () => {
  expect(
    tokenKinds(
      'sparql',
      'FILTER (STR(?x) != "a" && ?n >= -1 || !BOUND(?y) && ex:f(?x))'
    )
  ).toEqual([
    ['FILTER', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['STR', 'function'],
    ['(', 'punctuation.bracket'],
    ['?x', 'variable'],
    [')', 'punctuation.bracket'],
    ['!=', 'operator'],
    ['"a"', 'string'],
    ['&&', 'operator'],
    ['?n', 'variable'],
    ['>= -', 'operator'],
    ['1', 'number'],
    ['|| !', 'operator'],
    ['BOUND', 'function'],
    ['(', 'punctuation.bracket'],
    ['?y', 'variable'],
    [')', 'punctuation.bracket'],
    ['&&', 'operator'],
    ['ex:', 'namespace'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['?x', 'variable'],
    ['))', 'punctuation.bracket'],
  ]);
  // `<` is an IRI only without blanks before its `>`
  expect(tokenKinds('sparql', 'FILTER(?a < ?b && ?c<?d)')).toEqual([
    ['FILTER', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['?a', 'variable'],
    ['<', 'operator'],
    ['?b', 'variable'],
    ['&&', 'operator'],
    ['?c', 'variable'],
    ['<', 'operator'],
    ['?d', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('sparql: a closed filter ends the clause and paths keep the predicate role', () => {
  expect(
    tokenKinds(
      'sparql',
      '{ FILTER NOT EXISTS { ?s ex:p ?o } ?s ex:p/ex:q|^ex:r ex:o . BIND(1 AS ?n) ex:t ex:u ex:v }'
    )
  ).toEqual([
    ['{', 'punctuation.bracket'],
    ['FILTER', 'keyword'],
    ['NOT EXISTS', 'keyword.operator'],
    ['{', 'punctuation.bracket'],
    ['?s', 'variable'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['?o', 'variable'],
    ['}', 'punctuation.bracket'],
    ['?s', 'variable'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['/', 'operator'],
    ['ex:', 'namespace'],
    ['q', 'property'],
    ['|^', 'operator'],
    ['ex:', 'namespace'],
    ['r', 'property'],
    ['ex:', 'namespace'],
    ['o', 'constant'],
    ['.', 'punctuation.delimiter'],
    ['BIND', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    ['AS', 'keyword'],
    ['?n', 'variable'],
    [')', 'punctuation.bracket'],
    ['ex:', 'namespace'],
    ['t', 'constant'],
    ['ex:', 'namespace'],
    ['u', 'property'],
    ['ex:', 'namespace'],
    ['v', 'constant'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('sparql: long literals span lines and stream like the whole buffer', () => {
  const code =
    'PREFIX ex: <http://x/>\nINSERT DATA {\n  ex:s ex:p """a\n"b" \\u00e9\n"""@en ;\n    ex:q "x"^^ex:T .\n}\n';
  expect(tokenKinds('sparql', code)).toEqual([
    ['PREFIX', 'keyword.import'],
    ['ex:', 'namespace'],
    ['<http://x/>', 'string.special'],
    ['INSERT DATA', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['"""a', 'string'],
    ['"b"', 'string'],
    ['\\u00e9', 'string.escape'],
    ['"""', 'string'],
    ['@en', 'attribute'],
    [';', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['q', 'property'],
    ['"x"', 'string'],
    ['^^', 'operator'],
    ['ex:', 'namespace'],
    ['T', 'type'],
    ['.', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('sparql', code);
  assertLineFedParity('sparql', "SELECT * {\n ?s ?p '''x\n\\'''\n''' }\n");
});
