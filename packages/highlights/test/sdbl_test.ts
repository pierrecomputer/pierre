import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('sdbl: clauses, table paths, parameters, and word operators', () => {
  expect(
    tokenKinds(
      'sdbl',
      'ВЫБРАТЬ РАЗРЕШЕННЫЕ Т.Поле КАК П, &Пар\nИЗ Документ.Заказ.Товары КАК Т\nГДЕ Т.Сумма МЕЖДУ 1 И 2 ИЛИ Т.Цена В (ВЫБРАТЬ 1) // к\nОБЪЕДИНИТЬ ВСЕ\nselect a from b as c where c.x like "x""y" and not c.y is null;\nУНИЧТОЖИТЬ ВТ'
    )
  ).toEqual([
    ['ВЫБРАТЬ РАЗРЕШЕННЫЕ', 'keyword'],
    ['Т', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Поле', 'property'],
    ['КАК', 'keyword'],
    ['П', 'variable'],
    [',', 'punctuation.delimiter'],
    ['&Пар', 'variable.parameter'],
    ['ИЗ', 'keyword'],
    ['Документ', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Заказ', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Товары', 'type'],
    ['КАК', 'keyword'],
    ['Т', 'variable'],
    ['ГДЕ', 'keyword'],
    ['Т', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Сумма', 'property'],
    ['МЕЖДУ', 'keyword.operator'],
    ['1', 'number'],
    ['И', 'keyword.operator'],
    ['2', 'number'],
    ['ИЛИ', 'keyword.operator'],
    ['Т', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Цена', 'property'],
    ['В', 'keyword.operator'],
    ['(', 'punctuation.bracket'],
    ['ВЫБРАТЬ', 'keyword'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['// к', 'comment'],
    ['ОБЪЕДИНИТЬ ВСЕ', 'keyword'],
    ['select', 'keyword'],
    ['a', 'variable'],
    ['from', 'keyword'],
    ['b', 'type'],
    ['as', 'keyword'],
    ['c', 'variable'],
    ['where', 'keyword'],
    ['c', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['like', 'keyword.operator'],
    ['"x', 'string'],
    ['""', 'string.escape'],
    ['y"', 'string'],
    ['and not', 'keyword.operator'],
    ['c', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['y', 'property'],
    ['is', 'keyword.operator'],
    ['null', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['УНИЧТОЖИТЬ', 'keyword'],
    ['ВТ', 'type'],
  ]);
});

test('sdbl: CASE, functions, literals, and case-insensitive words', () => {
  expect(
    tokenKinds(
      'sdbl',
      'выбор когда ЕСТЬNULL(А, 0) > 1.5 тогда Истина иначе НЕОПРЕДЕЛЕНО конец\nУПОРЯДОЧИТЬ ПО А УБЫВ'
    )
  ).toEqual([
    ['выбор когда', 'keyword.control'],
    ['ЕСТЬNULL', 'function'],
    ['(', 'punctuation.bracket'],
    ['А', 'variable'],
    [',', 'punctuation.delimiter'],
    ['0', 'number'],
    [')', 'punctuation.bracket'],
    ['>', 'operator'],
    ['1.5', 'number'],
    ['тогда', 'keyword.control'],
    ['Истина', 'boolean'],
    ['иначе', 'keyword.control'],
    ['НЕОПРЕДЕЛЕНО', 'constant.builtin'],
    ['конец', 'keyword.control'],
    ['УПОРЯДОЧИТЬ ПО', 'keyword'],
    ['А', 'variable'],
    ['УБЫВ', 'keyword'],
  ]);
});

test('sdbl: a string ends at the line end', () => {
  const code = 'ВЫБРАТЬ "а\nб" ГДЕ 1';
  expect(tokenKinds('sdbl', code)).toEqual([
    ['ВЫБРАТЬ', 'keyword'],
    ['"а', 'string'],
    ['б', 'variable'],
    ['" ГДЕ 1', 'string'],
  ]);
  assertLineFedParity('sdbl', code);
});
