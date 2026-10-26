import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('llvm: instructions, types, values, and attributes', () => {
  expect(
    tokenKinds('llvm', '  %add = add nsw i32 %0, -1\n  ret i32 %add')
  ).toEqual([
    ['%add', 'variable'],
    ['=', 'operator'],
    ['add', 'keyword'],
    ['nsw', 'attribute'],
    ['i32', 'type.builtin'],
    ['%0', 'variable'],
    [',', 'punctuation.delimiter'],
    ['-1', 'number'],
    ['ret', 'keyword.control'],
    ['i32', 'type.builtin'],
    ['%add', 'variable'],
  ]);
  expect(
    tokenKinds('llvm', '%c = icmp ult <4 x i64> %a, zeroinitializer')
  ).toEqual([
    ['%c', 'variable'],
    ['=', 'operator'],
    ['icmp', 'keyword'],
    ['ult', 'keyword.operator'],
    ['<', 'punctuation.bracket'],
    ['4', 'number'],
    ['x', 'keyword.operator'],
    ['i64', 'type.builtin'],
    ['>', 'punctuation.bracket'],
    ['%a', 'variable'],
    [',', 'punctuation.delimiter'],
    ['zeroinitializer', 'constant.builtin'],
  ]);
  // words that share hash features with table words
  expect(tokenKinds('llvm', 'fptoui fptosi norecurse nocapture')).toEqual([
    ['fptoui fptosi', 'keyword'],
    ['norecurse nocapture', 'attribute'],
  ]);
});

test('llvm: globals, functions, labels, and metadata', () => {
  const tokens = tokenKinds('llvm', samples.llvm.code);
  for (const [text, kind] of [
    ['define', 'keyword.declaration'],
    ['@main', 'function'],
    ['@printf', 'function'],
    ['@.str', 'variable.special'],
    ['#0', 'attribute'],
    ['!dbg !10', 'constant'],
    ['entry', 'label'],
    ['3', 'label'],
    ['!DILocation', 'type'],
    ['line', 'property'],
    ['DIFlagPrototyped', 'constant.builtin'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(tokenKinds('llvm', '%"a b" = load ptr, ptr @"x y"')).toEqual([
    ['%"a b"', 'variable'],
    ['=', 'operator'],
    ['load', 'keyword'],
    ['ptr', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['ptr', 'type.builtin'],
    ['@"x y"', 'variable.special'],
  ]);
  expect(tokenKinds('llvm', '!0 = !{!"text", i32 1}')).toEqual([
    ['!0', 'constant'],
    ['=', 'operator'],
    ['!', 'punctuation.special'],
    ['{', 'punctuation.bracket'],
    ['!', 'punctuation.special'],
    ['"text"', 'string'],
    [',', 'punctuation.delimiter'],
    ['i32', 'type.builtin'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('llvm: strings, hex escapes, and comments', () => {
  expect(tokenKinds('llvm', 'c"a\\0A\\\\b\\q" ; done')).toEqual([
    ['c"a', 'string'],
    ['\\0A\\\\', 'string.escape'],
    ['b\\q"', 'string'],
    ['; done', 'comment'],
  ]);
  // one hex digit is not an escape
  expect(tokenKinds('llvm', 'c"\\4z\\4"')).toEqual([['c"\\4z\\4"', 'string']]);
  // a string ends at its line
  expect(tokenKinds('llvm', '"open\nret void')).toEqual([
    ['"open', 'string'],
    ['ret', 'keyword.control'],
    ['void', 'type.builtin'],
  ]);
  for (const n of ['0x3FF0000000000000', '1.5e+10', '0xK4000', '-0.0']) {
    expect(tokenKinds('llvm', n)).toEqual([[n, 'number']]);
  }
  assertLineFedParity('llvm', samples.llvm.code);
  assertLineFedParity('llvm', samples.llvm.code.replaceAll('\n', '\r\n'));
});
