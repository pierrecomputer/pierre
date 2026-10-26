import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('typst: markup headings, emphasis, lists, references, and links', () => {
  const code =
    '= Intro <intro>\nSome *bold* and _soft_ words, snake_case and 2*3, see @intro.\n' +
    '- Item with `code`\n+ Step\n12. Twelve\n/ Term: meaning\n' +
    'Visit https://typst.app/docs. Escape \\# \\u{1F600} and \\*.';
  expect(tokenKinds('typst', code)).toEqual([
    ['= Intro', 'title'],
    ['<intro>', 'label'],
    ['Some', null],
    ['*bold*', 'emphasis.strong'],
    ['and', null],
    ['_soft_', 'emphasis'],
    // a delimiter between word characters is text
    ['words, snake_case and 2*3, see', null],
    ['@intro', 'label'],
    ['.', null],
    ['-', 'punctuation.list_marker'],
    ['Item with', null],
    ['`code`', 'text.literal'],
    ['+', 'punctuation.list_marker'],
    ['Step', null],
    ['12.', 'punctuation.list_marker'],
    ['Twelve', null],
    ['/', 'punctuation.list_marker'],
    ['Term', 'property'],
    [': meaning', null],
    ['Visit', null],
    ['https://typst.app/docs', 'link_uri'],
    ['. Escape', null],
    ['\\# \\u{1F600}', 'string.escape'],
    ['and', null],
    ['\\*', 'string.escape'],
    ['.', null],
  ]);
});

test('typst: hash expressions end at a blank, statements at the line end', () => {
  const code =
    '#let x = 1 + 2\n#set text(size: 10pt, fill: red) // trailing\n' +
    '#show heading: it => [#it.body!]\n#f(a)[b] tail #none.\n#if x > 1 [big] else [small]';
  expect(tokenKinds('typst', code)).toEqual([
    ['#let', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['+', 'operator'],
    ['2', 'number'],
    ['#set', 'keyword'],
    ['text', 'function'],
    ['(', 'punctuation.bracket'],
    ['size', 'property'],
    [':', 'punctuation.delimiter'],
    ['10pt', 'number'],
    [',', 'punctuation.delimiter'],
    ['fill', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'variable'],
    [')', 'punctuation.bracket'],
    ['// trailing', 'comment'],
    ['#show', 'keyword'],
    ['heading', 'property'],
    [':', 'punctuation.delimiter'],
    ['it', 'variable'],
    ['=>', 'operator'],
    ['[', 'punctuation.bracket'],
    ['#it', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['body', 'property'],
    ['!', null],
    [']', 'punctuation.bracket'],
    ['#f', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    [')[', 'punctuation.bracket'],
    ['b', null],
    [']', 'punctuation.bracket'],
    ['tail', null],
    ['#none', 'constant.builtin'],
    ['.', null],
    ['#if', 'keyword.control'],
    ['x', 'variable'],
    ['>', 'operator'],
    ['1', 'number'],
    ['[', 'punctuation.bracket'],
    ['big', null],
    [']', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['[', 'punctuation.bracket'],
    ['small', null],
    [']', 'punctuation.bracket'],
  ]);
});

test('typst: math, code blocks, nested comments, and raw blocks span lines', () => {
  const code =
    '$ sum_(i=1)^n alpha.alt(x) = #calc.pow(2, 3) "text" \\$ $\n' +
    '#{\n  let s = "two\n  lines"\n  [content *strong*]\n}\n' +
    '/* outer /* inner */ still */\n```py\nprint(1)\n```\n';
  expect(tokenKinds('typst', code)).toEqual([
    ['$', 'punctuation.bracket'],
    ['sum', 'constant'],
    ['_', 'operator'],
    ['(', 'punctuation.bracket'],
    ['i', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['^', 'operator'],
    ['n', 'variable'],
    ['alpha.alt', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['#calc', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['pow', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['2', 'number'],
    [',', 'punctuation.delimiter'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    ['"text"', 'string'],
    ['\\$', 'string.escape'],
    ['$', 'punctuation.bracket'],
    ['#{', 'punctuation.bracket'],
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"two', 'string'],
    ['lines"', 'string'],
    ['[', 'punctuation.bracket'],
    ['content', null],
    ['*strong*', 'emphasis.strong'],
    [']', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['/* outer /* inner */ still */', 'comment'],
    ['```py', 'text.literal'],
    ['print(1)', 'text.literal'],
    ['```', 'text.literal'],
  ]);
  assertLineFedParity('typst', code);
  assertLineFedParity('typst', code.replaceAll('\n', '\r\n'));
  // open math, content, and raw text carry over to the next line
  assertLineFedParity('typst', '#figure([\n  $x +\n  y$ `a\nb`\n])\nText\n');
});
