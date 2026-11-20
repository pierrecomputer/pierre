import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('zenscript: preprocessors, hash comments, and imports', () => {
  expect(
    tokenKinds(
      'zenscript',
      '#loader crafttweaker\n#priority 10\n# a note\nval x = 1; # tail\nimport crafttweaker.item.IItemStack;'
    )
  ).toEqual([
    ['#loader crafttweaker', 'preproc'],
    ['#priority 10', 'preproc'],
    ['# a note', 'comment'],
    ['val', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['# tail', 'comment'],
    ['import', 'keyword.import'],
    ['crafttweaker', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['item', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['IItemStack', 'type'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('zenscript: bracket handlers are one token; comparisons are not', () => {
  expect(
    tokenKinds(
      'zenscript',
      'r.add(<minecraft:wool:*>, [<ore:sand>]);\nif (a<b && c>d) {}'
    )
  ).toEqual([
    ['r', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['add', 'function'],
    ['(', 'punctuation.bracket'],
    ['<minecraft:wool:*>', 'string.special'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['<ore:sand>', 'string.special'],
    ['])', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    ['<', 'operator'],
    ['b', 'variable'],
    ['&&', 'operator'],
    ['c', 'variable'],
    ['>', 'operator'],
    ['d', 'variable'],
    [') {}', 'punctuation.bracket'],
  ]);
});

test('zenscript: declarations, casts, classes, and ranges', () => {
  expect(
    tokenKinds(
      'zenscript',
      'static n as string[] = ["a\\tb", \'c\'];\nfunction double(a as int) as int { return a ~ "x"; }'
    )
  ).toEqual([
    ['static', 'keyword.declaration'],
    ['n', 'variable'],
    ['as', 'keyword.operator'],
    ['string', 'type.builtin'],
    ['[]', 'punctuation.bracket'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
    [',', 'punctuation.delimiter'],
    ["'c'", 'string'],
    [']', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['function', 'keyword.declaration'],
    ['double', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    ['as', 'keyword.operator'],
    ['int', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['as', 'keyword.operator'],
    ['int', 'type.builtin'],
    ['{', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['a', 'variable'],
    ['~', 'operator'],
    ['"x"', 'string'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'zenscript',
      'zenClass C { zenConstructor(s as T) {} }\nfor i in 0 .. 9 { x = c ? a : b; }'
    )
  ).toEqual([
    ['zenClass', 'keyword.declaration'],
    ['C', 'type'],
    ['{', 'punctuation.bracket'],
    ['zenConstructor', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['s', 'variable'],
    ['as', 'keyword.operator'],
    ['T', 'type'],
    [') {} }', 'punctuation.bracket'],
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.control'],
    ['0', 'number'],
    ['..', 'operator'],
    ['9', 'number'],
    ['{', 'punctuation.bracket'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['c', 'variable'],
    ['?', 'operator'],
    ['a', 'variable'],
    [':', 'punctuation.delimiter'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('zenscript: block comments span lines', () => {
  const code = '/* one\n   two */ val a = <x:y>;\n';
  expect(tokenKinds('zenscript', code)).toEqual([
    ['/* one', 'comment'],
    ['two */', 'comment'],
    ['val', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['<x:y>', 'string.special'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('zenscript', code);
});
