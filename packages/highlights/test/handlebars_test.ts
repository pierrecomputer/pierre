import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('handlebars: block helpers, block params, and data variables', () => {
  expect(
    tokenKinds(
      'handlebars',
      '{{#each items as |item i|}}{{item.name}} {{@index}}{{else}}{{/each}}'
    )
  ).toEqual([
    ['{{', 'punctuation.special'],
    ['#each', 'keyword.control'],
    ['items', 'variable'],
    ['as', 'keyword'],
    ['|', 'punctuation.bracket'],
    ['item i', 'variable.parameter'],
    ['|', 'punctuation.bracket'],
    ['}}{{', 'punctuation.special'],
    ['item', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['@index', 'variable.special'],
    ['}}{{', 'punctuation.special'],
    ['else', 'keyword.control'],
    ['}}{{', 'punctuation.special'],
    ['/each', 'keyword.control'],
    ['}}', 'punctuation.special'],
  ]);
});

test('handlebars: helpers with hash arguments, paths, and raw output', () => {
  expect(
    tokenKinds(
      'handlebars',
      '{{format-date date "long" utc=true}} {{{body}}} {{../title}} {{this.x}} {{.}} {{&raw}}'
    )
  ).toEqual([
    ['{{', 'punctuation.special'],
    ['format-date', 'function'],
    ['date', 'variable'],
    ['"long"', 'string'],
    ['utc', 'variable.parameter'],
    ['=', 'operator'],
    ['true', 'boolean'],
    ['}}', 'punctuation.special'],
    ['{{{', 'punctuation.special'],
    ['body', 'variable'],
    ['}}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['..', 'variable.special'],
    ['/', 'punctuation.delimiter'],
    ['title', 'property'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['this', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['}}', 'punctuation.special'],
    ['{{', 'punctuation.special'],
    ['.', 'variable.special'],
    ['}}', 'punctuation.special'],
    ['{{&', 'punctuation.special'],
    ['raw', 'variable'],
    ['}}', 'punctuation.special'],
  ]);
});

test('handlebars: comments, subexpressions, inverse sections, and partials', () => {
  expect(
    tokenKinds(
      'handlebars',
      '{{!-- a }} b --}}{{! c }}{{~#if (eq a 1)~}}{{else if b}}{{^}}{{/if}}{{> card size=2}}'
    )
  ).toEqual([
    ['{{!-- a }} b --}}{{! c }}', 'comment'],
    ['{{~', 'punctuation.special'],
    ['#if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['eq', 'function'],
    ['a', 'variable'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['~}}{{', 'punctuation.special'],
    ['else if', 'keyword.control'],
    ['b', 'variable'],
    ['}}{{', 'punctuation.special'],
    ['^', 'keyword.control'],
    ['}}{{', 'punctuation.special'],
    ['/if', 'keyword.control'],
    ['}}{{', 'punctuation.special'],
    ['>', 'keyword.import'],
    ['card', 'function'],
    ['size', 'variable.parameter'],
    ['=', 'operator'],
    ['2', 'number'],
    ['}}', 'punctuation.special'],
  ]);
  for (const code of [
    '{{!-- a\n}} b\n--}}<p>{{x}}</p>\n',
    '{{! a\nb }}<i class="{{#if c}}\nd{{/if}}">e</i>\n',
    '{{#each\n  items as |item|}}{{item}}{{/each}}\n',
  ]) {
    assertLineFedParity('handlebars', code);
  }
});
