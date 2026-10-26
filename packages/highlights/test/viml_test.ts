import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('viml: a double quote is a string where an operand is expected', () => {
  expect(
    tokenKinds(
      'viml',
      '" settings\nlet x = "a\\tb" " comment\necho "one" "two"\nif a is b | " note\nendif'
    )
  ).toEqual([
    ['" settings', 'comment'],
    ['let', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
    ['" comment', 'comment'],
    ['echo', 'keyword'],
    ['"one" "two"', 'string'],
    ['if', 'keyword.control'],
    ['a', 'variable'],
    ['is', 'keyword.operator'],
    ['b', 'variable'],
    ['|', 'punctuation.delimiter'],
    ['" note', 'comment'],
    ['endif', 'keyword.control'],
  ]);
});

test('viml: scoped variables, options, registers, and environment', () => {
  expect(
    tokenKinds('viml', "call Foo(&l:ts, @a, $HOME, g:x, a:0, v:true, 'it''s')")
  ).toEqual([
    ['call', 'keyword'],
    ['Foo', 'function'],
    ['(', 'punctuation.bracket'],
    ['&l:ts', 'property'],
    [',', 'punctuation.delimiter'],
    ['@a', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['$HOME', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['g:x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['a:0', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['v:true', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ["'it", 'string'],
    ["''", 'string.escape'],
    ["s'", 'string'],
    [')', 'punctuation.bracket'],
  ]);
});

test('viml: options, mappings, and command words', () => {
  expect(
    tokenKinds(
      'viml',
      'set nocompatible ts=4 stl=%f\\ %m " tail\nnnoremap <silent> <leader>w :w<CR>\nautocmd BufRead *.py call plug#load() | echo "x"'
    )
  ).toEqual([
    ['set', 'keyword'],
    ['nocompatible ts', 'property'],
    ['=', 'operator'],
    ['4', 'number'],
    ['stl', 'property'],
    ['=', 'operator'],
    ['%f\\ %m', null],
    ['" tail', 'comment'],
    ['nnoremap', 'keyword'],
    ['<silent> <leader>', 'constant.builtin'],
    ['w :w', null],
    ['<CR>', 'constant.builtin'],
    ['autocmd', 'keyword'],
    ['BufRead', null],
    ['*.', 'operator'],
    ['py', null],
    ['call', 'keyword'],
    ['plug#load', 'function'],
    ['()', 'punctuation.bracket'],
    ['|', 'punctuation.delimiter'],
    ['echo', 'keyword'],
    ['"x"', 'string'],
  ]);
});

test('viml: function headers, Vim9 comments, and user commands', () => {
  expect(
    tokenKinds(
      'viml',
      "function! s:Trim(name, ...) abort\nendfunction\ndef Add(x: number): number\n  var y = x # sum\nenddef\nPlug 'fzf'"
    )
  ).toEqual([
    ['function!', 'keyword.declaration'],
    ['s:Trim', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['name', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['...', 'operator'],
    [')', 'punctuation.bracket'],
    ['abort', 'keyword'],
    ['endfunction', 'keyword.declaration'],
    ['def', 'keyword.declaration'],
    ['Add', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable.parameter'],
    [':', 'operator'],
    ['number', 'type'],
    [')', 'punctuation.bracket'],
    [':', 'operator'],
    ['number', 'variable'],
    ['var', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['x', 'variable'],
    ['# sum', 'comment'],
    ['enddef', 'keyword.declaration'],
    ['Plug', 'function'],
    ["'fzf'", 'string'],
  ]);
});

test('viml: continuation lines keep the expression and stream by line', () => {
  const code =
    'let s = [\n      \\ "one",\n      "\\ a comment\n      \\ 2]\necho s\n';
  expect(tokenKinds('viml', code)).toEqual([
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['\\', 'punctuation.special'],
    ['"one"', 'string'],
    [',', 'punctuation.delimiter'],
    ['"\\ a comment', 'comment'],
    ['\\', 'punctuation.special'],
    ['2', 'number'],
    [']', 'punctuation.bracket'],
    ['echo', 'keyword'],
    ['s', 'variable'],
  ]);
  assertLineFedParity('viml', code);
});
