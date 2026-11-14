import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('dream-maker: type paths, vars, and proc definitions', () => {
  expect(
    tokenKinds(
      'dream-maker',
      '/obj/item\n\tvar/const/max = 5\n\tvar/list/L\n/mob/proc/hit(mob/M as mob|obj, n = 1)'
    )
  ).toEqual([
    ['/', 'punctuation.delimiter'],
    ['obj', 'type'],
    ['/', 'punctuation.delimiter'],
    ['item', 'type'],
    ['var', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['const', 'keyword'],
    ['/', 'punctuation.delimiter'],
    ['max', 'variable'],
    ['=', 'operator'],
    ['5', 'number'],
    ['var', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['list', 'type'],
    ['/', 'punctuation.delimiter'],
    ['L', 'variable'],
    ['/', 'punctuation.delimiter'],
    ['mob', 'type'],
    ['/', 'punctuation.delimiter'],
    ['proc', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['hit', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['mob', 'type'],
    ['/', 'punctuation.delimiter'],
    ['M', 'variable.parameter'],
    ['as', 'keyword.operator'],
    ['mob', 'type'],
    ['|', 'operator'],
    ['obj', 'type'],
    [',', 'punctuation.delimiter'],
    ['n', 'variable.parameter'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  // a bare word path starts a line; elsewhere `/` divides
  expect(tokenKinds('dream-maker', 'x = a/b\ny = new /obj(src.loc)')).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['/', 'operator'],
    ['b', 'variable'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['new', 'keyword'],
    ['/', 'punctuation.delimiter'],
    ['obj', 'type'],
    ['(', 'punctuation.bracket'],
    ['src', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['loc', 'property'],
    [')', 'punctuation.bracket'],
  ]);
});

test('dream-maker: keywords, calls, members, and relative paths', () => {
  expect(
    tokenKinds(
      'dream-maker',
      'for(var/i in 1 to 10 step 2) spawn(5) world << usr.name\nreturn ..() || .proc/act || null'
    )
  ).toEqual([
    ['for', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['1', 'number'],
    ['to', 'keyword.operator'],
    ['10', 'number'],
    ['step', 'keyword.operator'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    ['spawn', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['5', 'number'],
    [')', 'punctuation.bracket'],
    ['world', 'variable.special'],
    ['<<', 'operator'],
    ['usr', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['return', 'keyword.control'],
    ['..', 'operator'],
    ['()', 'punctuation.bracket'],
    ['||', 'operator'],
    ['.', 'punctuation.delimiter'],
    ['proc', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['act', 'function.definition'],
    ['||', 'operator'],
    ['null', 'constant.builtin'],
  ]);
  expect(tokenKinds('dream-maker', 'M.Move(get_step(M, NORTH))')).toEqual([
    ['M', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Move', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['get_step', 'function'],
    ['(', 'punctuation.bracket'],
    ['M', 'variable'],
    [',', 'punctuation.delimiter'],
    ['NORTH', 'constant'],
    ['))', 'punctuation.bracket'],
  ]);
});

test('dream-maker: preprocessor lines', () => {
  expect(
    tokenKinds(
      'dream-maker',
      '#define MAX 10\n#include "a.dm"\n#ifdef DEBUG\n#endif\nx = 1 # 2'
    )
  ).toEqual([
    ['#define MAX', 'preproc'],
    ['10', 'number'],
    ['#include', 'preproc'],
    ['"a.dm"', 'string'],
    ['#ifdef DEBUG', 'preproc'],
    ['#endif', 'preproc'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['#', 'operator'],
    ['2', 'number'],
  ]);
});

test('dream-maker: embedded expressions, text macros, and file strings', () => {
  expect(
    tokenKinds(
      'dream-maker',
      `M << "\\The [src] hits [L[i]]!\\n\\""; icon = 'a.dmi'`
    )
  ).toEqual([
    ['M', 'variable'],
    ['<<', 'operator'],
    ['"', 'string'],
    ['\\The', 'string.escape'],
    ['[', 'punctuation.special'],
    ['src', 'variable.special'],
    [']', 'punctuation.special'],
    ['hits', 'string'],
    ['[', 'punctuation.special'],
    ['L', 'variable'],
    ['[', 'punctuation.bracket'],
    ['i', 'variable'],
    [']', 'punctuation.bracket'],
    [']', 'punctuation.special'],
    ['!', 'string'],
    ['\\n\\"', 'string.escape'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
    ['icon', 'variable'],
    ['=', 'operator'],
    ["'a.dmi'", 'string.special'],
  ]);
  // an unclosed string or expression ends at its line
  const code = 'x = "a [b\ny = 1\n';
  expect(tokenKinds('dream-maker', code)).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['[', 'punctuation.special'],
    ['b', 'variable'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('dream-maker', code);
});

test('dream-maker: documents and comments span lines', () => {
  const code =
    'desc = {"Line "one"\n[name] two"} // done\n/* a /* b */\nc */ x\nmsg = "a \\\nb"\n';
  expect(tokenKinds('dream-maker', code)).toEqual([
    ['desc', 'variable'],
    ['=', 'operator'],
    ['{"Line "one"', 'string'],
    ['[', 'punctuation.special'],
    ['name', 'variable'],
    [']', 'punctuation.special'],
    ['two"}', 'string'],
    ['// done', 'comment'],
    ['/* a /* b */', 'comment'],
    ['c */', 'comment'],
    ['x', 'variable'],
    ['msg', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['\\', 'string.escape'],
    ['b"', 'string'],
  ]);
  assertLineFedParity('dream-maker', code);
});

test('dream-maker: a string with its own [ ] inside an embedded expression', () => {
  const code = 'var/t = "a [x ? "b [y]" : "c"] d"\nvar/z = 1\n';
  expect(tokenKinds('dream-maker', code)).toEqual([
    ['var', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['[', 'punctuation.special'],
    ['x', 'variable'],
    ['?', 'operator'],
    ['"b', 'string'],
    ['[', 'punctuation.special'],
    ['y', 'variable'],
    [']', 'punctuation.special'],
    ['"', 'string'],
    [':', 'operator'],
    ['"c"', 'string'],
    [']', 'punctuation.special'],
    ['d"', 'string'],
    ['var', 'keyword.declaration'],
    ['/', 'punctuation.delimiter'],
    ['z', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('dream-maker', code);
  assertLineFedParity(
    'dream-maker',
    'var/t = {"a [f("b [1]")] c\nd [g("e [h("f [2]")]")] x"}\nvar/u = "a [b("c [d\nvar/v = 1\n'
  );
});

test('dream-maker: three nested embedded expressions keep the outer string', () => {
  const code = 'x = "a [f("b [g("c [1]")]")] d"\n';
  expect(tokenKinds('dream-maker', code).slice(-4)).toEqual([
    ['"', 'string'],
    [')', 'punctuation.bracket'],
    [']', 'punctuation.special'],
    ['d"', 'string'],
  ]);
  assertLineFedParity('dream-maker', code);
});
