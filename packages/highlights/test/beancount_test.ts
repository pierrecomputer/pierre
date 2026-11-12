import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('beancount: dated directives, accounts, and currencies', () => {
  expect(
    tokenKinds(
      'beancount',
      '2024-01-01 open Assets:Bank:Checking USD,EUR\n2024/02/01 price HOOL 520.00 USD'
    )
  ).toEqual([
    ['2024-01-01', 'number'],
    ['open', 'keyword'],
    ['Assets:Bank:Checking', 'variable'],
    ['USD', 'type'],
    [',', 'punctuation.delimiter'],
    ['EUR', 'type'],
    ['2024/02/01', 'number'],
    ['price', 'keyword'],
    ['HOOL', 'type'],
    ['520.00', 'number'],
    ['USD', 'type'],
  ]);
  // undated directives start a line; other lowercase words are plain
  expect(
    tokenKinds(
      'beancount',
      'option "title" "λ😀 <&>"\npushtag #trip\nplugin "p" config'
    )
  ).toEqual([
    ['option', 'keyword'],
    ['"title" "λ😀 <&>"', 'string'],
    ['pushtag', 'keyword'],
    ['#trip', 'label'],
    ['plugin', 'keyword'],
    ['"p"', 'string'],
    ['config', null],
  ]);
});

test('beancount: transactions, flags, postings, and metadata', () => {
  const code =
    '2024-01-15 * "Cafe" "Lunch \\"x\\"" #food ^r-1\n  note: "ok"\n  ! Expenses:Food  -1,234.50 USD @@ 2 EUR\n  Assets:Cash {10 USD} @ (2 * 3) EUR ; done\n';
  expect(tokenKinds('beancount', code)).toEqual([
    ['2024-01-15', 'number'],
    ['*', 'keyword'],
    ['"Cafe" "Lunch', 'string'],
    ['\\"', 'string.escape'],
    ['x', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    ['#food', 'label'],
    ['^r-1', 'string.special'],
    ['note', 'property'],
    [':', 'punctuation.delimiter'],
    ['"ok"', 'string'],
    ['!', 'keyword'],
    ['Expenses:Food', 'variable'],
    ['-1,234.50', 'number'],
    ['USD', 'type'],
    ['@@', 'operator'],
    ['2', 'number'],
    ['EUR', 'type'],
    ['Assets:Cash', 'variable'],
    ['{', 'punctuation.bracket'],
    ['10', 'number'],
    ['USD', 'type'],
    ['}', 'punctuation.bracket'],
    ['@', 'operator'],
    ['(', 'punctuation.bracket'],
    ['2', 'number'],
    ['*', 'operator'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    ['EUR', 'type'],
    ['; done', 'comment'],
  ]);
  assertLineFedParity('beancount', code);
});

test('beancount: headings, literals, and multi-line strings', () => {
  const code =
    '* Income\n2024-01-01 custom "a" TRUE FALSE NULL\n2024-01-02 note Assets:Cash "first\n  second" ; c\n';
  expect(tokenKinds('beancount', code)).toEqual([
    ['* Income', 'title'],
    ['2024-01-01', 'number'],
    ['custom', 'keyword'],
    ['"a"', 'string'],
    ['TRUE FALSE', 'boolean'],
    ['NULL', 'constant.builtin'],
    ['2024-01-02', 'number'],
    ['note', 'keyword'],
    ['Assets:Cash', 'variable'],
    ['"first', 'string'],
    ['second"', 'string'],
    ['; c', 'comment'],
  ]);
  assertLineFedParity('beancount', code);
  // a directive needs a whole date before it
  expect(tokenKinds('beancount', '2024-01-01x open')).toEqual([
    ['2024-01-01', 'number'],
    ['x open', null],
  ]);
});
