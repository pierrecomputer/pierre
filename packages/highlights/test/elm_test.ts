import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('elm: unsupported dollar signs still advance the lexer', () => {
  expect(tokenKinds('elm', '$')).toEqual([['$', null]]);
});

test('elm: modules, types, records, and booleans', () => {
  const kinds = tokenKinds(
    'elm',
    'module Main exposing (main)\nimport Html\ntype alias Model = { count : Int }\nupdate model = if model.count > 0 then True else False'
  );
  for (const expected of [
    ['Main', 'namespace'],
    ['Model', 'type'],
    ['Int', 'type.builtin'],
    ['count', 'property'],
    ['0', 'number'],
    ['True', 'boolean'],
    ['False', 'boolean'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('elm: nested comments and Unicode literals', () => {
  const kinds = tokenKinds(
    'elm',
    '{- outer {- inner -} still outer -}\nvalue = "héllo\\n"\nchar = \'λ\''
  );
  for (const expected of [
    ['{- outer {- inner -} still outer -}', 'comment'],
    ['\\n', 'string.escape'],
    ["'λ'", 'string'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('elm: triple strings preserve embedded quotes', () => {
  const kinds = tokenKinds(
    'elm',
    'value = """one "two"\nthree"""\nnext = 0x2A'
  );
  for (const expected of [
    ['"""one "two"', 'string'],
    ['three"""', 'string'],
    ['0x2A', 'number'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('elm: multiline constructs match line-fed streaming', () => {
  for (const code of [
    '{- outer\n{- inner -}\nstill outer -}\nmain = True\n',
    'message = """one \\" quote\ntwo \\n three"""\nmain = 1\n',
  ]) {
    assertLineFedParity('elm', code);
  }
});

test('elm: qualified imports and aliases are namespaces', () => {
  expect(tokenKinds('elm', 'import Json.Decode as Decode')).toEqual([
    ['import', 'keyword.import'],
    ['Json', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Decode', 'namespace'],
    ['as', 'keyword.import'],
    ['Decode', 'namespace'],
  ]);
  expect(tokenKinds('elm', 'import Json.Decode\n  as Decode')).toContainEqual([
    'Decode',
    'namespace',
  ]);
  expect(
    tokenKinds('elm', 'import Json.Decode\nmatch (Just value as whole) = whole')
  ).toContainEqual(['whole', 'variable']);
});

test('elm: builtin module names consume the pending import', () => {
  for (const name of ['List', 'String', 'Maybe', 'Result']) {
    for (const suffix of ['', ' exposing (map)', ' as Values']) {
      const code = `import ${name}${suffix}\nmain = 1\n`;
      const kinds = tokenKinds('elm', code);
      expect(kinds).toContainEqual([name, 'namespace']);
      expect(kinds).toContainEqual(['main', 'function.definition']);
      if (suffix.includes('map')) {
        expect(kinds).toContainEqual(['map', 'variable']);
      }
      if (suffix.includes('Values')) {
        expect(kinds).toContainEqual(['Values', 'namespace']);
      }
      assertLineFedParity('elm', code);
    }
  }
});

test('elm: nested documentation comments close at the outer delimiter', () => {
  expect(
    tokenKinds('elm', '{-| outer {- inner -} tail -}\nnext = True')
  ).toEqual([
    ['{-| outer {- inner -} tail -}', 'comment.doc'],
    ['next', 'function.definition'],
    ['=', 'operator'],
    ['True', 'boolean'],
  ]);
});

test('elm: comments between a declaration and its name preserve context', () => {
  expect(tokenKinds('elm', 'type {- explanation -}\nModel = Ready')).toEqual([
    ['type', 'keyword.declaration'],
    ['{- explanation -}', 'comment'],
    ['Model', 'type'],
    ['=', 'operator'],
    ['Ready', 'type'],
  ]);
});

test('elm: braced Unicode escapes are one escape token', () => {
  for (const quote of ['"', "'", '"""']) {
    expect(tokenKinds('elm', `${quote}\\u{1F600}${quote}`)).toEqual([
      [quote, 'string'],
      ['\\u{1F600}', 'string.escape'],
      [quote, 'string'],
    ]);
  }
});

test('elm: comment markers inside literals do not open comments', () => {
  for (const literal of ['"{- -- -}"', '"""{- -- " -}"""', "'-'"]) {
    expect(tokenKinds('elm', literal)).toEqual([[literal, 'string']]);
  }
});

test('elm: keyword matching respects case and complete identifiers', () => {
  for (const word of ['ifReady', 'moduleName', 'type_', 'true']) {
    expect(tokenKinds('elm', `value = ${word}`)).toContainEqual([
      word,
      'variable',
    ]);
  }
  expect(tokenKinds('elm', 'value = FALSE')).toContainEqual(['FALSE', 'type']);
});
