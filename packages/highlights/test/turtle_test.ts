import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('turtle: directives, prefixed names by role, and the `a` predicate', () => {
  expect(
    tokenKinds(
      'turtle',
      '@prefix ex: <http://example.org/#> .\nex:alice a foaf:Person ;\n  foaf:knows ex:bob .'
    )
  ).toEqual([
    ['@prefix', 'keyword.import'],
    ['ex:', 'namespace'],
    ['<http://example.org/#>', 'string.special'],
    ['.', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['alice', 'constant'],
    ['a', 'keyword'],
    ['foaf:', 'namespace'],
    ['Person', 'type'],
    [';', 'punctuation.delimiter'],
    ['foaf:', 'namespace'],
    ['knows', 'property'],
    ['ex:', 'namespace'],
    ['bob', 'constant'],
    ['.', 'punctuation.delimiter'],
  ]);
  // SPARQL-style directives take no dot, and the next line starts a subject
  expect(
    tokenKinds(
      'turtle',
      'PREFIX ex: <http://x/>\nBASE <http://y/>\nex:s ex:p ex:o .'
    )
  ).toEqual([
    ['PREFIX', 'keyword.import'],
    ['ex:', 'namespace'],
    ['<http://x/>', 'string.special'],
    ['BASE', 'keyword.import'],
    ['<http://y/>', 'string.special'],
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['ex:', 'namespace'],
    ['o', 'constant'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('turtle: `,` keeps the predicate, `[` opens a new one, and `(` holds objects', () => {
  expect(
    tokenKinds(
      'turtle',
      'ex:s ex:p ex:o1 , ex:o2 ; ex:q [ ex:r ex:t ] , ( ex:u ex:v ) .'
    )
  ).toEqual([
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['ex:', 'namespace'],
    ['o1', 'constant'],
    [',', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['o2', 'constant'],
    [';', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['q', 'property'],
    ['[', 'punctuation.bracket'],
    ['ex:', 'namespace'],
    ['r', 'property'],
    ['ex:', 'namespace'],
    ['t', 'constant'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['(', 'punctuation.bracket'],
    ['ex:', 'namespace'],
    ['u', 'constant'],
    ['ex:', 'namespace'],
    ['v', 'constant'],
    [')', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
  ]);
  // a blank node subject, an empty prefix, and dotted local names
  expect(tokenKinds('turtle', '_:b1 :p ex:a.b .')).toEqual([
    ['_:b1', 'variable.special'],
    [':', 'namespace'],
    ['p', 'property'],
    ['ex:', 'namespace'],
    ['a.b', 'constant'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('turtle: literals with escapes, language tags, datatypes, and numbers', () => {
  expect(
    tokenKinds(
      'turtle',
      'ex:s ex:p "a\\"b\\u00e9"@en-US , \'c\' , "5"^^xsd:int , -1.5e3 , .5 , true .'
    )
  ).toEqual([
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['"a', 'string'],
    ['\\"', 'string.escape'],
    ['b', 'string'],
    ['\\u00e9', 'string.escape'],
    ['"', 'string'],
    ['@en-US', 'attribute'],
    [',', 'punctuation.delimiter'],
    ["'c'", 'string'],
    [',', 'punctuation.delimiter'],
    ['"5"', 'string'],
    ['^^', 'operator'],
    ['xsd:', 'namespace'],
    ['int', 'type'],
    [',', 'punctuation.delimiter'],
    ['-1.5e3', 'number'],
    [',', 'punctuation.delimiter'],
    ['.5', 'number'],
    [',', 'punctuation.delimiter'],
    ['true', 'boolean'],
    ['.', 'punctuation.delimiter'],
  ]);
  // `#` inside an IRI is part of it; outside it starts a comment
  expect(tokenKinds('turtle', '<http://x/#a> ex:p 1 . # note')).toEqual([
    ['<http://x/#a>', 'string.special'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['1', 'number'],
    ['.', 'punctuation.delimiter'],
    ['# note', 'comment'],
  ]);
});

test('turtle: long strings span lines, short strings stop at the line break', () => {
  const code =
    'ex:s ex:p """one "two" \\t\nthree""" ;\n  ex:q \'\'\'x\ny\'\'\' .\n';
  expect(tokenKinds('turtle', code)).toEqual([
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['"""one "two"', 'string'],
    ['\\t', 'string.escape'],
    ['three"""', 'string'],
    [';', 'punctuation.delimiter'],
    ['ex:', 'namespace'],
    ['q', 'property'],
    ["'''x", 'string'],
    ["y'''", 'string'],
    ['.', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('turtle', code);
  assertLineFedParity(
    'turtle',
    'ex:s ex:p """a\\\n\nb""" .\nex:t ex:u "open\nex:v ex:w 1 .\n'
  );
  expect(tokenKinds('turtle', 'ex:s ex:p "open\\\n  , "next" .')).toEqual([
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['"open', 'string'],
    ['\\', 'string.escape'],
    [',', 'punctuation.delimiter'],
    ['"next"', 'string'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('turtle: TriG graphs and statements across lines keep their roles', () => {
  const code = 'GRAPH ex:g {\n  ex:s\n    ex:p\n      ex:o .\n}\n';
  expect(tokenKinds('turtle', code)).toEqual([
    ['GRAPH', 'keyword'],
    ['ex:', 'namespace'],
    ['g', 'constant'],
    ['{', 'punctuation.bracket'],
    ['ex:', 'namespace'],
    ['s', 'constant'],
    ['ex:', 'namespace'],
    ['p', 'property'],
    ['ex:', 'namespace'],
    ['o', 'constant'],
    ['.', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('turtle', code);
  // SPARQL-only words are plain text in Turtle
  expect(tokenKinds('turtle', 'SELECT')).toEqual([['SELECT', null]]);
});
