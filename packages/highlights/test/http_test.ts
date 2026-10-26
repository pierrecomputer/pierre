import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('http: request and status lines, headers, and comments', () => {
  expect(
    tokenKinds(
      'http',
      'GET https://example.com/a?b=1 HTTP/1.1\nAccept: */*\n\n###\n// note\nHTTP/2 404 Not Found\nX-Id: 7\n'
    )
  ).toEqual([
    ['GET', 'keyword'],
    ['https://example.com/a?b=1', 'string'],
    ['HTTP', 'keyword'],
    ['/', 'punctuation.delimiter'],
    ['1.1', 'number'],
    ['Accept', 'property'],
    [':', 'punctuation.delimiter'],
    ['*/*', 'string'],
    ['###', 'comment'],
    ['// note', 'comment'],
    ['HTTP', 'keyword'],
    ['/', 'punctuation.delimiter'],
    ['2 404', 'number'],
    ['Not Found', 'string'],
    ['X-Id', 'property'],
    [':', 'punctuation.delimiter'],
    ['7', 'string'],
  ]);
});

test('http: variables and placeholders', () => {
  expect(
    tokenKinds(
      'http',
      '@base = https://{{host}}/v1\n\nPOST {{base}}/x\nAuthorization: Bearer {{token}}\n'
    )
  ).toEqual([
    ['@base', 'variable'],
    ['=', 'operator'],
    ['https://', 'string'],
    ['{{', 'punctuation.special'],
    ['host', 'variable'],
    ['}}', 'punctuation.special'],
    ['/v1', 'string'],
    ['POST', 'keyword'],
    ['{{', 'punctuation.special'],
    ['base', 'variable'],
    ['}}', 'punctuation.special'],
    ['/x', 'string'],
    ['Authorization', 'property'],
    [':', 'punctuation.delimiter'],
    ['Bearer', 'string'],
    ['{{', 'punctuation.special'],
    ['token', 'variable'],
    ['}}', 'punctuation.special'],
  ]);
});

test('http: bodies use the JSON and XML lexers, and `###` ends them', () => {
  const code =
    'POST /a\nContent-Type: application/json\n\n{"a": [1, {"b": "# x"}],\n "c": null}\n### next\nPOST /b\n\n<r a="1">\n<!-- open\n-->t &amp; u</r>\n###\nPOST /c\n\nn={{v}} # text\n';
  expect(tokenKinds('http', code)).toEqual([
    ['POST', 'keyword'],
    ['/a', 'string'],
    ['Content-Type', 'property'],
    [':', 'punctuation.delimiter'],
    ['application/json', 'string'],
    ['{', 'punctuation.bracket'],
    ['"a"', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['"b"', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['"# x"', 'string'],
    ['}]', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['"c"', 'property.json_key'],
    [':', 'punctuation.delimiter'],
    ['null', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
    ['### next', 'comment'],
    ['POST', 'keyword'],
    ['/b', 'string'],
    ['<', 'punctuation.bracket.html'],
    ['r', 'tag'],
    ['a', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"1"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['<!-- open', 'comment'],
    ['-->', 'comment'],
    ['t', null],
    ['&amp;', 'string.special'],
    ['u', null],
    ['</', 'punctuation.bracket.html'],
    ['r', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['###', 'comment'],
    ['POST', 'keyword'],
    ['/c', 'string'],
    ['n=', null],
    ['{{', 'punctuation.special'],
    ['v', 'variable'],
    ['}}', 'punctuation.special'],
    ['# text', null],
  ]);
  assertLineFedParity('http', code);
});

test('http: Content-Type picks the body lexer, and `###` closes open constructs', () => {
  expect(
    tokenKinds('http', 'POST /x\ncontent-type: text/XML\n\n  <a/>\n')
  ).toEqual([
    ['POST', 'keyword'],
    ['/x', 'string'],
    ['content-type', 'property'],
    [':', 'punctuation.delimiter'],
    ['text/XML', 'string'],
    ['<', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['/>', 'punctuation.bracket.html'],
  ]);
  // an XML comment or start tag left open ends at the separator, whole or
  // line by line
  for (const body of ['<!-- open\nstill', '<a b="1"\n c', '{"a": /* open\nx']) {
    const code = `POST /x\n\n${body}\n### n\nGET /y\n`;
    const kinds = assertLineFedParity('http', code)
      .flat()
      .map((token) => token.content.trim())
      .filter((text) => text !== '');
    expect(kinds.slice(-3)).toEqual(['### n', 'GET', '/y']);
  }
});
