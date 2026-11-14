import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('hurl: requests, headers, sections, templates, and comments', () => {
  const code =
    '# c\nGET https://x.org/a?b={{id}}#frag # note\nAccept: text/html <&>\n[QueryStringParams]\nq: "λ😀"\n[Options]\nretry: 3\n';
  expect(tokenKinds('hurl', code)).toEqual([
    ['# c', 'comment'],
    ['GET', 'keyword'],
    ['https://x.org/a?b=', 'string'],
    ['{{', 'punctuation.special'],
    ['id', 'variable'],
    ['}}', 'punctuation.special'],
    ['#frag', 'string'],
    ['# note', 'comment'],
    ['Accept', 'property'],
    [':', 'punctuation.delimiter'],
    ['text/html <&>', 'string'],
    ['[', 'punctuation.bracket'],
    ['QueryStringParams', 'type'],
    [']', 'punctuation.bracket'],
    ['q', 'property'],
    [':', 'punctuation.delimiter'],
    ['"λ😀"', 'string'],
    ['[', 'punctuation.bracket'],
    ['Options', 'type'],
    [']', 'punctuation.bracket'],
    ['retry', 'property'],
    [':', 'punctuation.delimiter'],
    ['3', 'string'],
  ]);
});

test('hurl: captures and asserts with queries, filters, and predicates', () => {
  const code =
    'HTTP 200\n[Captures]\nid: jsonpath "$.id" toInt\n[Asserts]\nstatus != 404\njsonpath "$.n" count >= 2\nheader "X" not contains "y"\nbody matches /a\\/b/\njsonpath "$.ok" == true\njsonpath "$.age" isInteger\nbytes == base64,AAE=;\n';
  expect(tokenKinds('hurl', code)).toEqual([
    ['HTTP', 'keyword'],
    ['200', 'number'],
    ['[', 'punctuation.bracket'],
    ['Captures', 'type'],
    [']', 'punctuation.bracket'],
    ['id', 'property'],
    [':', 'punctuation.delimiter'],
    ['jsonpath', 'function'],
    ['"$.id"', 'string'],
    ['toInt', 'function'],
    ['[', 'punctuation.bracket'],
    ['Asserts', 'type'],
    [']', 'punctuation.bracket'],
    ['status', 'function'],
    ['!=', 'operator'],
    ['404', 'number'],
    ['jsonpath', 'function'],
    ['"$.n"', 'string'],
    ['count', 'function'],
    ['>=', 'operator'],
    ['2', 'number'],
    ['header', 'function'],
    ['"X"', 'string'],
    ['not contains', 'keyword.operator'],
    ['"y"', 'string'],
    ['body', 'function'],
    ['matches', 'keyword.operator'],
    ['/a', 'string.regex'],
    ['\\/', 'string.escape'],
    ['b/', 'string.regex'],
    ['jsonpath', 'function'],
    ['"$.ok"', 'string'],
    ['==', 'operator'],
    ['true', 'boolean'],
    ['jsonpath', 'function'],
    ['"$.age"', 'string'],
    ['isInteger', 'keyword.operator'],
    ['bytes', 'function'],
    ['==', 'operator'],
    ['base64,', 'function'],
    ['AAE=', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('hurl: JSON, XML, multiline, and oneline bodies', () => {
  const code =
    'POST https://x.org\n[\n  {"a": 1}\n]\n# done\nHTTP/2 201\n```json\n{"raw": [Asserts]\n```\nPUT https://x.org\n<a b="1">\n  text\n</a>\nHTTP 200\nfile,data.bin;\n`one line`\n';
  expect(tokenKinds('hurl', code)).toEqual([
    ['POST', 'keyword'],
    ['https://x.org', 'string'],
    ['[', 'punctuation.bracket'],
    ['{', 'punctuation.bracket'],
    ['"a"', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    [']', 'punctuation.bracket'],
    ['# done', 'comment'],
    ['HTTP', 'keyword'],
    ['/', 'punctuation.delimiter'],
    ['2 201', 'number'],
    ['```json', 'string'],
    ['{"raw": [Asserts]', 'string'],
    ['```', 'string'],
    ['PUT', 'keyword'],
    ['https://x.org', 'string'],
    ['<', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['b', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"1"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['text', null],
    ['</', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['HTTP', 'keyword'],
    ['200', 'number'],
    ['file,', 'function'],
    ['data.bin', 'string'],
    [';', 'punctuation.delimiter'],
    ['`one line`', 'string'],
  ]);
  assertLineFedParity('hurl', code);
  assertLineFedParity('hurl', code.replaceAll('\n', '\r\n'));
  // an unclosed body or multiline string runs to the end
  assertLineFedParity('hurl', 'POST https://x.org\n{\n  "a": [1,\n');
  assertLineFedParity('hurl', '```\nopen\n');
});
