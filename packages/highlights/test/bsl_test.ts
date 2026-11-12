import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('bsl: routine heads, annotations, parameters, and constructors', () => {
  expect(
    tokenKinds(
      'bsl',
      '&НаКлиенте\nАсинх Процедура Тест(Знач А, Б = 1) Экспорт\n\tЖдать Новый Структура("К", 2);\nКонецПроцедуры'
    )
  ).toEqual([
    ['&НаКлиенте', 'attribute'],
    ['Асинх', 'keyword'],
    ['Процедура', 'keyword.declaration'],
    ['Тест', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['Знач', 'keyword.declaration'],
    ['А', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['Б', 'variable.parameter'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['Экспорт', 'keyword.declaration'],
    ['Ждать Новый', 'keyword'],
    ['Структура', 'type'],
    ['(', 'punctuation.bracket'],
    ['"К"', 'string'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['КонецПроцедуры', 'keyword.declaration'],
  ]);
  expect(tokenKinds('bsl', 'Function F(Val X) Export\nEndFunction')).toEqual([
    ['Function', 'keyword.declaration'],
    ['F', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['Val', 'keyword.declaration'],
    ['X', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['Export', 'keyword.declaration'],
    ['EndFunction', 'keyword.declaration'],
  ]);
});

test('bsl: Russian and English keywords ignore case', () => {
  expect(
    tokenKinds('bsl', 'КОНЕЦЕСЛИ конецесли EndIf ENDIF ЕслиБы Ёлка Иx И и_')
  ).toEqual([
    ['КОНЕЦЕСЛИ конецесли EndIf ENDIF', 'keyword.control'],
    ['ЕслиБы Ёлка Иx', 'variable'],
    ['И', 'keyword.operator'],
    ['и_', 'variable'],
  ]);
  expect(
    tokenKinds(
      'bsl',
      'Если НЕ А ИЛИ Б Тогда Возврат Истина; КонецЕсли;\nПопытка Исключение ВызватьИсключение; КонецПопытки;\nIf Not A Then Raise; Except EndTry; Var X; Return Undefined;'
    )
  ).toEqual([
    ['Если', 'keyword.control'],
    ['НЕ', 'keyword.operator'],
    ['А', 'variable'],
    ['ИЛИ', 'keyword.operator'],
    ['Б', 'variable'],
    ['Тогда Возврат', 'keyword.control'],
    ['Истина', 'boolean'],
    [';', 'punctuation.delimiter'],
    ['КонецЕсли', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['Попытка Исключение ВызватьИсключение', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['КонецПопытки', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['If', 'keyword.control'],
    ['Not', 'keyword.operator'],
    ['A', 'variable'],
    ['Then Raise', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['Except EndTry', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['Var', 'keyword.declaration'],
    ['X', 'variable'],
    [';', 'punctuation.delimiter'],
    ['Return', 'keyword.control'],
    ['Undefined', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('bsl: preprocessor lines, labels, dates, members, and operators', () => {
  expect(
    tokenKinds(
      'bsl',
      "#Если Сервер Тогда\n~М: Перейти ~М; Д = '20240131';\nА = ?(Б <> 1, 2, 3); С.Метод().Поле;\n#КонецЕсли"
    )
  ).toEqual([
    ['#Если Сервер Тогда', 'preproc'],
    ['~М', 'label'],
    [':', 'punctuation.delimiter'],
    ['Перейти', 'keyword.control'],
    ['~М', 'label'],
    [';', 'punctuation.delimiter'],
    ['Д', 'variable'],
    ['=', 'operator'],
    ["'20240131'", 'string.special'],
    [';', 'punctuation.delimiter'],
    ['А', 'variable'],
    ['= ?', 'operator'],
    ['(', 'punctuation.bracket'],
    ['Б', 'variable'],
    ['<>', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [',', 'punctuation.delimiter'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['С', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Метод', 'function.method'],
    ['()', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['Поле', 'property'],
    [';', 'punctuation.delimiter'],
    ['#КонецЕсли', 'preproc'],
  ]);
  // a keyword after `.` is a member
  expect(tokenKinds('bsl', 'Запрос.Выполнить()')).toEqual([
    ['Запрос', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Выполнить', 'function.method'],
    ['()', 'punctuation.bracket'],
  ]);
});

test('bsl: strings continue on `|` lines and end on other lines', () => {
  const code = 'А = "одна\n|две"" ""\n// заметка\n|три"; Б = 1;\nВ = "x\nY = 2';
  expect(tokenKinds('bsl', code)).toEqual([
    ['А', 'variable'],
    ['=', 'operator'],
    ['"одна', 'string'],
    ['|две', 'string'],
    ['""', 'string.escape'],
    ['""', 'string.escape'],
    ['// заметка', 'comment'],
    ['|три"', 'string'],
    [';', 'punctuation.delimiter'],
    ['Б', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['В', 'variable'],
    ['=', 'operator'],
    ['"x', 'string'],
    ['Y', 'variable'],
    ['=', 'operator'],
    ['2', 'number'],
  ]);
  assertLineFedParity('bsl', code);
  assertLineFedParity('bsl', code.replaceAll('\n', '\r\n'));
});

test('bsl: query text inside strings', () => {
  const code =
    'Текст = "ВЫБРАТЬ\n\t|\tТ.Имя ПОДОБНО ""а%""\n\t// между\n\t|ИЗ Справочник.Т КАК Т // к";\nа = "\n|ВЫБРАТЬ 1";';
  expect(tokenKinds('bsl', code)).toEqual([
    ['Текст', 'variable'],
    ['=', 'operator'],
    ['"', 'string'],
    ['ВЫБРАТЬ', 'keyword'],
    ['|', 'string'],
    ['Т', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Имя', 'property'],
    ['ПОДОБНО', 'keyword.operator'],
    ['""а%""', 'string'],
    ['// между', 'comment'],
    ['|', 'string'],
    ['ИЗ', 'keyword'],
    ['Справочник', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Т', 'type'],
    ['КАК', 'keyword'],
    ['Т', 'variable'],
    ['// к', 'comment'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
    ['а', 'variable'],
    ['=', 'operator'],
    ['"', 'string'],
    ['|', 'string'],
    ['ВЫБРАТЬ', 'keyword'],
    ['1', 'number'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('bsl', code);
  // as in Shiki, any string that starts with a query word is query text
  expect(tokenKinds('bsl', 'С = "Выбрать файл";')).toEqual([
    ['С', 'variable'],
    ['=', 'operator'],
    ['"', 'string'],
    ['Выбрать', 'keyword'],
    ['файл', 'variable'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  // other strings stay plain text
  expect(tokenKinds('bsl', 'С = "Выбор файла";')).toEqual([
    ['С', 'variable'],
    ['=', 'operator'],
    ['"Выбор файла"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
});
