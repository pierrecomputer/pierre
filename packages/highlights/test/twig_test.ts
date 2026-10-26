import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('twig: filters, arrow functions, and concatenation', () => {
  expect(
    tokenKinds(
      'twig',
      '{% for p in items|filter(p => p.price > 0) %}{{ p.name|upper ~ "!" }}{% endfor %}'
    )
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['for', 'keyword.control'],
    ['p', 'variable'],
    ['in', 'keyword.operator'],
    ['items', 'variable'],
    ['|', 'operator'],
    ['filter', 'function'],
    ['(', 'punctuation.bracket'],
    ['p', 'variable'],
    ['=>', 'operator'],
    ['p', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['price', 'property'],
    ['>', 'operator'],
    ['0', 'number'],
    [')', 'punctuation.bracket'],
    ['%}{{', 'punctuation.special'],
    ['p', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['|', 'operator'],
    ['upper', 'function'],
    ['~', 'operator'],
    ['"!"', 'string'],
    ['}}{%', 'punctuation.special'],
    ['endfor', 'keyword.control'],
    ['%}', 'punctuation.special'],
  ]);
});

test('twig: hash keys, ranges, null coalescing, and nested closers', () => {
  expect(
    tokenKinds(
      'twig',
      '{{ include("x.twig", {title: "Hi", n: 1..3}) }} {{ a ?? null }}'
    )
  ).toEqual([
    ['{{', 'punctuation.special'],
    ['include', 'function'],
    ['(', 'punctuation.bracket'],
    ['"x.twig"', 'string'],
    [',', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['title', 'property'],
    [':', 'punctuation.delimiter'],
    ['"Hi"', 'string'],
    [',', 'punctuation.delimiter'],
    ['n', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    ['})', 'punctuation.bracket'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['a', 'variable'],
    ['??', 'operator'],
    ['null', 'constant.builtin'],
    ['}}', 'punctuation.special'],
  ]);
  expect(tokenKinds('twig', '{{ {a: {b: 1}} }}')).toEqual([
    ['{{', 'punctuation.special'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['b', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['}}', 'punctuation.bracket'],
    ['}}', 'punctuation.special'],
  ]);
});

test('twig: verbatim blocks and `~` whitespace control', () => {
  expect(
    tokenKinds(
      'twig',
      '{%~ verbatim ~%}{{ raw }}{% endverbatim %}{{ _self }} {{ x ~}}'
    )
  ).toEqual([
    ['{%~', 'punctuation.special'],
    ['verbatim', 'keyword'],
    ['~%}', 'punctuation.special'],
    ['{{ raw }}', 'text.literal'],
    ['{%', 'punctuation.special'],
    ['endverbatim', 'keyword'],
    ['%}{{', 'punctuation.special'],
    ['_self', 'variable.special'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['x', 'variable'],
    ['~}}', 'punctuation.special'],
  ]);
  for (const code of [
    '{# a\nb #}{% verbatim %}\n{{ x }}\n{% endverbatim %}\n',
    '{% set h = {\n  a: [1, 2],\n} %}{{ h|json_encode }}\n',
  ]) {
    assertLineFedParity('twig', code);
  }
});
