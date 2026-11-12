import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('regexp: anchors, escapes, quantifiers, and classes', () => {
  expect(tokenKinds('regexp', '^\\d{2,4}?[a-z\\]-]+$')).toEqual([
    ['^', 'keyword.control'],
    ['\\d', 'string.escape'],
    ['{', 'keyword.operator'],
    ['2', 'number'],
    [',', 'keyword.operator'],
    ['4', 'number'],
    ['}?', 'keyword.operator'],
    ['[', 'punctuation.bracket'],
    ['a', 'constant'],
    ['-', 'keyword.operator'],
    ['z', 'constant'],
    ['\\]', 'string.escape'],
    ['-', 'constant'],
    [']', 'punctuation.bracket'],
    ['+', 'keyword.operator'],
    ['$', 'keyword.control'],
  ]);
  // a leading `]` is a member; POSIX classes; `^` past the start is literal
  expect(
    tokenKinds('regexp', '[[:alpha:]^-][^]a]\\p{Lu}\\x41\\u00e9\\cA.\\b')
  ).toEqual([
    ['[', 'punctuation.bracket'],
    ['[:alpha:]', 'constant.builtin'],
    ['^-', 'constant'],
    ['][', 'punctuation.bracket'],
    ['^', 'keyword.operator'],
    [']a', 'constant'],
    [']', 'punctuation.bracket'],
    ['\\p{Lu}\\x41\\u00e9\\cA', 'string.escape'],
    ['.', 'constant.builtin'],
    ['\\b', 'keyword.control'],
  ]);
  // braces that are not a quantifier stay literal
  expect(tokenKinds('regexp', 'a{x}b{,3}c{2}+')).toEqual([
    ['a{x}b', 'string'],
    ['{,', 'keyword.operator'],
    ['3', 'number'],
    ['}', 'keyword.operator'],
    ['c', 'string'],
    ['{', 'keyword.operator'],
    ['2', 'number'],
    ['}+', 'keyword.operator'],
  ]);
});

test('regexp: groups, lookaround, names, and backreferences', () => {
  expect(
    tokenKinds(
      'regexp',
      '(?<year>\\d+)(?:x|y)(?=a)(?!b)(?<=c)(?<!d)\\k<year>\\2'
    )
  ).toEqual([
    ['(', 'punctuation.bracket'],
    ['?<', 'keyword.operator'],
    ['year', 'variable'],
    ['>', 'keyword.operator'],
    ['\\d', 'string.escape'],
    ['+', 'keyword.operator'],
    [')(', 'punctuation.bracket'],
    ['?:', 'keyword.operator'],
    ['x', 'string'],
    ['|', 'keyword.operator'],
    ['y', 'string'],
    [')(', 'punctuation.bracket'],
    ['?=', 'keyword.operator'],
    ['a', 'string'],
    [')(', 'punctuation.bracket'],
    ['?!', 'keyword.operator'],
    ['b', 'string'],
    [')(', 'punctuation.bracket'],
    ['?<=', 'keyword.operator'],
    ['c', 'string'],
    [')(', 'punctuation.bracket'],
    ['?<!', 'keyword.operator'],
    ['d', 'string'],
    [')', 'punctuation.bracket'],
    ['\\k<year>\\2', 'variable.special'],
  ]);
  expect(tokenKinds('regexp', '(?#note)(?i)(?i-m:z)(?P<n>q)(?P=n)')).toEqual([
    ['(', 'punctuation.bracket'],
    ['?#note', 'comment'],
    [')(', 'punctuation.bracket'],
    ['?i', 'keyword.operator'],
    [')(', 'punctuation.bracket'],
    ['?i-m:', 'keyword.operator'],
    ['z', 'string'],
    [')(', 'punctuation.bracket'],
    ['?P<', 'keyword.operator'],
    ['n', 'variable'],
    ['>', 'keyword.operator'],
    ['q', 'string'],
    [')(', 'punctuation.bracket'],
    ['?P=', 'keyword.operator'],
    ['n', 'variable.special'],
    [')', 'punctuation.bracket'],
  ]);
});

test('regexp: delimited lines, line breaks, and Unicode', () => {
  // only a line that ends with `/flags` is a delimited literal
  expect(tokenKinds('regexp', '/a\\/b/gi\n/not/closed x')).toEqual([
    ['/', 'punctuation.delimiter'],
    ['a', 'string'],
    ['\\/', 'string.escape'],
    ['b', 'string'],
    ['/', 'punctuation.delimiter'],
    ['gi', 'keyword'],
    ['/not/closed x', 'string'],
  ]);
  // a class and an escape end at the line break
  const code = 'x\\\ny[\nz]';
  expect(tokenKinds('regexp', code)).toEqual([
    ['x', 'string'],
    ['\\', 'string.escape'],
    ['y', 'string'],
    ['[', 'punctuation.bracket'],
    ['z]', 'string'],
  ]);
  assertLineFedParity('regexp', code);
  expect(tokenKinds('regexp', 'λ😀 <&> \\😀')).toEqual([
    ['λ😀 <&>', 'string'],
    ['\\😀', 'string.escape'],
  ]);
});
