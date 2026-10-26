import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('jinja: tag names, tests, filters, and members', () => {
  expect(
    tokenKinds(
      'jinja',
      '{% if user is not none %}{{ user.name|title }}{% endif %}'
    )
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['if', 'keyword.control'],
    ['user', 'variable'],
    ['is not', 'keyword.operator'],
    ['none', 'function'],
    ['%}{{', 'punctuation.special'],
    ['user', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['|', 'operator'],
    ['title', 'function'],
    ['}}{%', 'punctuation.special'],
    ['endif', 'keyword.control'],
    ['%}', 'punctuation.special'],
  ]);
  // an unknown tag name is still a keyword; `macro` names a definition
  expect(
    tokenKinds(
      'jinja',
      '{% macro field(name, value="", size=20) %}{{ caller() }}{% endmacro %}'
    )
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['macro', 'keyword'],
    ['field', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['name', 'variable'],
    [',', 'punctuation.delimiter'],
    ['value', 'variable.parameter'],
    ['=', 'operator'],
    ['""', 'string'],
    [',', 'punctuation.delimiter'],
    ['size', 'variable.parameter'],
    ['=', 'operator'],
    ['20', 'number'],
    [')', 'punctuation.bracket'],
    ['%}{{', 'punctuation.special'],
    ['caller', 'function'],
    ['()', 'punctuation.bracket'],
    ['}}{%', 'punctuation.special'],
    ['endmacro', 'keyword'],
    ['%}', 'punctuation.special'],
  ]);
});

test('jinja: expressions, constants, and whitespace control', () => {
  expect(
    tokenKinds(
      'jinja',
      '{{ loop.cycle("odd", "even") }} {{ x if y else none }}'
    )
  ).toEqual([
    ['{{', 'punctuation.special'],
    ['loop', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['cycle', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['"odd"', 'string'],
    [',', 'punctuation.delimiter'],
    ['"even"', 'string'],
    [')', 'punctuation.bracket'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['x', 'variable'],
    ['if', 'keyword.control'],
    ['y', 'variable'],
    ['else', 'keyword.control'],
    ['none', 'constant.builtin'],
    ['}}', 'punctuation.special'],
  ]);
  expect(
    tokenKinds(
      'jinja',
      '{#- note\n -#}{%- set n = 1_000 * 2.5e3 // 3 ** 2 -%}{{- n ~ "\\t" -}}{%+ endset +%}'
    )
  ).toEqual([
    ['{#- note', 'comment'],
    ['-#}', 'comment'],
    ['{%-', 'punctuation.special'],
    ['set', 'keyword'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['1_000', 'number'],
    ['*', 'operator'],
    ['2.5e3', 'number'],
    ['//', 'operator'],
    ['3', 'number'],
    ['**', 'operator'],
    ['2', 'number'],
    ['-%}{{-', 'punctuation.special'],
    ['n', 'variable'],
    ['~', 'operator'],
    ['"', 'string'],
    ['\\t', 'string.escape'],
    ['"', 'string'],
    ['-}}{%+', 'punctuation.special'],
    ['endset', 'keyword'],
    ['+%}', 'punctuation.special'],
  ]);
  // `}}` closes an open dict first
  expect(tokenKinds('jinja', '{{ {"a": {"b": 1}} }}x')).toEqual([
    ['{{', 'punctuation.special'],
    ['{', 'punctuation.bracket'],
    ['"a"', 'string'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['"b"', 'string'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['}}', 'punctuation.bracket'],
    ['}}', 'punctuation.special'],
    ['x', null],
  ]);
});

test('jinja: raw blocks stay literal text', () => {
  expect(
    tokenKinds('jinja', '{% raw %}{{ x }} {% if %}{%- endraw -%}{{ y }}')
  ).toEqual([
    ['{%', 'punctuation.special'],
    ['raw', 'keyword'],
    ['%}', 'punctuation.special'],
    ['{{ x }} {% if %}', 'text.literal'],
    ['{%-', 'punctuation.special'],
    ['endraw', 'keyword'],
    ['-%}{{', 'punctuation.special'],
    ['y', 'variable'],
    ['}}', 'punctuation.special'],
  ]);
});

test('jinja: template tags inside start tags and around html', () => {
  expect(
    tokenKinds(
      'jinja',
      '<a href="{{ url }}" class={{ cls }} {% if on %}checked{% endif %}>{{ label }}</a>'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['href', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"', 'string'],
    ['{{', 'punctuation.special'],
    ['url', 'variable'],
    ['}}', 'punctuation.special'],
    ['"', 'string'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['{{', 'punctuation.special'],
    ['cls', 'variable'],
    ['}} {%', 'punctuation.special'],
    ['if', 'keyword.control'],
    ['on', 'variable'],
    ['%}', 'punctuation.special'],
    ['checked', 'attribute'],
    ['{%', 'punctuation.special'],
    ['endif', 'keyword.control'],
    ['%}', 'punctuation.special'],
    ['>', 'punctuation.bracket.html'],
    ['{{', 'punctuation.special'],
    ['label', 'variable'],
    ['}}', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // script and style bodies and html comments keep template tags as text
  expect(
    tokenKinds(
      'jinja',
      '<script>let a = "{{ x }}";</script><!-- {{ y }} -->{{ z }}'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['script', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['let', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['"{{ x }}"', 'string'],
    [';', 'punctuation.delimiter'],
    ['</', 'punctuation.bracket.html'],
    ['script', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['<!-- {{ y }} -->', 'comment'],
    ['{{', 'punctuation.special'],
    ['z', 'variable'],
    ['}}', 'punctuation.special'],
  ]);
});

test('jinja: multi-line tags, comments, and start tags stream like the whole', () => {
  for (const code of [
    '{# one\ntwo #}<p>{{ a }}</p>\n',
    '{% set xs = [\n  1,\n  {"k": 2}\n] %}{{ xs }}\n',
    '<div\n  class="a {{ b }}\n c"\n  id={{ d }}>\n</div>\n',
    '{% raw %}\n{{ a }}\n{% endraw %}{{ b }}\n',
    '<script src="{{ url }}">\nlet x = "{{";\n</script>{{ y }}\n',
    '{{ "a\\\nb" }} <i>x</i>\n',
  ]) {
    assertLineFedParity('jinja', code);
  }
});
