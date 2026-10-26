import { expect, test } from 'bun:test';

import { tokenKinds } from './_util';

test('rosmsg: fields, built-in and package types, and comments', () => {
  expect(
    tokenKinds(
      'rosmsg',
      '# header\nHeader header\ngeometry_msgs/Pose pose # where\nuint8 level\nCustom item'
    )
  ).toEqual([
    ['# header', 'comment'],
    ['Header', 'type.builtin'],
    ['header', 'property'],
    ['geometry_msgs/Pose', 'type'],
    ['pose', 'property'],
    ['# where', 'comment'],
    ['uint8', 'type.builtin'],
    ['level', 'property'],
    ['Custom', 'type'],
    ['item', 'property'],
  ]);
});

test('rosmsg: arrays, bounded strings, and ROS 2 defaults', () => {
  expect(
    tokenKinds(
      'rosmsg',
      'int32[] a [1, -2]\nfloat64[<=3] b\nstring<=8[4] c\nbool on TRUE\nstring s "x\\ty"'
    )
  ).toEqual([
    ['int32', 'type.builtin'],
    ['[]', 'punctuation.bracket'],
    ['a', 'property'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['-2', 'number'],
    [']', 'punctuation.bracket'],
    ['float64', 'type.builtin'],
    ['[', 'punctuation.bracket'],
    ['<=', 'operator'],
    ['3', 'number'],
    [']', 'punctuation.bracket'],
    ['b', 'property'],
    ['string', 'type.builtin'],
    ['<=', 'operator'],
    ['8', 'number'],
    ['[', 'punctuation.bracket'],
    ['4', 'number'],
    [']', 'punctuation.bracket'],
    ['c', 'property'],
    ['bool', 'type.builtin'],
    ['on', 'property'],
    ['TRUE', 'boolean'],
    ['string', 'type.builtin'],
    ['s', 'property'],
    ['"x', 'string'],
    ['\\t', 'string.escape'],
    ['y"', 'string'],
  ]);
});

test('rosmsg: constants, where a string value takes the rest of the line', () => {
  expect(
    tokenKinds(
      'rosmsg',
      'int32 X = 1 # c\nstring S=a # b\nwstring W="q"\n---\nfloat32 F=-1.5e2'
    )
  ).toEqual([
    ['int32', 'type.builtin'],
    ['X', 'constant'],
    ['=', 'operator'],
    ['1', 'number'],
    ['# c', 'comment'],
    ['string', 'type.builtin'],
    ['S', 'constant'],
    ['=', 'operator'],
    ['a # b', 'string'],
    ['wstring', 'type.builtin'],
    ['W', 'constant'],
    ['=', 'operator'],
    ['"q"', 'string'],
    ['---', 'punctuation.special'],
    ['float32', 'type.builtin'],
    ['F', 'constant'],
    ['=', 'operator'],
    ['-1.5e2', 'number'],
  ]);
});

test('rosmsg: dependency definitions in a full message text', () => {
  expect(
    tokenKinds('rosmsg', '====\nMSG: std_msgs/Header\n@optional\nuint32 seq')
  ).toEqual([
    ['====', 'punctuation.special'],
    ['MSG:', 'keyword'],
    ['std_msgs/Header', 'type'],
    ['@optional', 'attribute'],
    ['uint32', 'type.builtin'],
    ['seq', 'property'],
  ]);
});
