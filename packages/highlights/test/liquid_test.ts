import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('liquid: filters with arguments, ranges, and loop parameters', () => {
  expect(
    tokenKinds(
      'liquid',
      '{%- assign t = product.title | upcase | append: " !" -%}{% for i in (1..3) limit: 2 %}{{ forloop.index }}{% endfor %}'
    )
  ).toEqual([
    ['{%-', 'punctuation.special'],
    ['assign', 'keyword'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['product', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['title', 'property'],
    ['|', 'operator'],
    ['upcase', 'function'],
    ['|', 'operator'],
    ['append', 'function'],
    [':', 'punctuation.delimiter'],
    ['" !"', 'string'],
    ['-%}{%', 'punctuation.special'],
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    ['limit', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
    ['%}{{', 'punctuation.special'],
    ['forloop', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['index', 'property'],
    ['}}{%', 'punctuation.special'],
    ['endfor', 'keyword.control'],
    ['%}', 'punctuation.special'],
  ]);
});

test('liquid: operators, objects named like tags, and dashed names', () => {
  expect(
    tokenKinds(
      'liquid',
      '{% if a.available? and b contains "x" or c == blank %}{{ section.id }}{% render "card", item: a %}{% endif %}{{ my-var-}}'
    )
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['if', 'keyword.control'],
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['available?', 'property'],
    ['and', 'keyword.operator'],
    ['b', 'variable'],
    ['contains', 'keyword.operator'],
    ['"x"', 'string'],
    ['or', 'keyword.operator'],
    ['c', 'variable'],
    ['==', 'operator'],
    ['blank', 'constant.builtin'],
    ['%}{{', 'punctuation.special'],
    ['section', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['id', 'property'],
    ['}}{%', 'punctuation.special'],
    ['render', 'keyword.import'],
    ['"card"', 'string'],
    [',', 'punctuation.delimiter'],
    ['item', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['a', 'variable'],
    ['%}{%', 'punctuation.special'],
    ['endif', 'keyword.control'],
    ['%}{{', 'punctuation.special'],
    ['my-var', 'variable'],
    ['-}}', 'punctuation.special'],
  ]);
});

test('liquid: comment and raw blocks, inline comments, and liquid tags', () => {
  expect(
    tokenKinds(
      'liquid',
      '{% comment %}{{ x }}\n{% endcomment %}{% raw %}{{ y }}{% endraw %}{% # note -%}'
    )
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['comment', 'keyword'],
    ['%}', 'punctuation.special'],
    ['{{ x }}', 'comment'],
    ['{%', 'punctuation.special'],
    ['endcomment', 'keyword'],
    ['%}{%', 'punctuation.special'],
    ['raw', 'keyword'],
    ['%}', 'punctuation.special'],
    ['{{ y }}', 'text.literal'],
    ['{%', 'punctuation.special'],
    ['endraw', 'keyword'],
    ['%}{%', 'punctuation.special'],
    ['# note', 'comment'],
    ['-%}', 'punctuation.special'],
  ]);
  const code =
    '{% liquid\n  # c\n  assign a = 1\n  if a\n    echo a\n  endif\n%}\n';
  expect(tokenKinds('liquid', code)).toEqual([
    ['{%', 'punctuation.special'],
    ['liquid', 'keyword'],
    ['# c', 'comment'],
    ['assign', 'keyword'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['if', 'keyword.control'],
    ['a', 'variable'],
    ['echo', 'keyword'],
    ['a', 'variable'],
    ['endif', 'keyword.control'],
    ['%}', 'punctuation.special'],
  ]);
  assertLineFedParity('liquid', code);
  assertLineFedParity(
    'liquid',
    '{% comment %}\n<p>{{ x }}</p>\n{% endcomment %}<p>{{ y }}</p>\n'
  );
});
