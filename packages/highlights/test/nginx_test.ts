import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('nginx: directives, blocks, and argument kinds', () => {
  expect(
    tokenKinds(
      'nginx',
      '# top\nhttp {\n  include mime.types;\n  gzip off; # zip\n  listen 127.0.0.1:80 default;\n  sendfile on;\n}\n'
    )
  ).toEqual([
    ['# top', 'comment'],
    ['http', 'keyword.declaration'],
    ['{', 'punctuation.bracket'],
    ['include', 'keyword.import'],
    ['mime.types', null],
    [';', 'punctuation.delimiter'],
    ['gzip', 'keyword'],
    ['off', 'boolean'],
    [';', 'punctuation.delimiter'],
    ['# zip', 'comment'],
    ['listen', 'keyword'],
    ['127.0.0.1:80 default', null],
    [';', 'punctuation.delimiter'],
    ['sendfile', 'keyword'],
    ['on', 'boolean'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  for (const [value, kind] of [
    ['1024', 'number'],
    ['10m', 'number'],
    ['1.5', 'number'],
    ['1h30m', 'number'],
    ['512k', 'number'],
    ['127.0.0.1', null],
    ['10mbit', null],
    ['1.2.3', null],
  ] as const) {
    expect(tokenKinds('nginx', `a ${value};`)).toEqual([
      ['a', 'keyword'],
      [value, kind],
      [';', 'punctuation.delimiter'],
    ]);
  }
});

test('nginx: variables, strings, operators, and regexes', () => {
  expect(
    tokenKinds(
      'nginx',
      'location ~* \\.(png|jpg)$ { return 301 https://$host${uri}; }'
    )
  ).toEqual([
    ['location', 'keyword.declaration'],
    ['~*', 'operator'],
    ['\\.(png|jpg)$', 'string.regex'],
    ['{', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['301', 'number'],
    ['https://', null],
    ['$host', 'variable'],
    ['${', 'punctuation.special'],
    ['uri', 'variable'],
    ['}', 'punctuation.special'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('nginx', 'if ($uri !~ ^/(a|b)$) { rewrite ^/x(.*)$ /y$1 last; }')
  ).toEqual([
    ['if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['$uri', 'variable'],
    ['!~', 'operator'],
    ['^/(a|b)$', 'string.regex'],
    [') {', 'punctuation.bracket'],
    ['rewrite', 'keyword.control'],
    ['^/x(.*)$', 'string.regex'],
    ['/y', null],
    ['$1', 'variable'],
    ['last', null],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  // `^~` and `=` match prefixes and exact paths, not regexes
  expect(tokenKinds('nginx', 'location ^~ /a/ {}\nlocation = /b {}')).toEqual([
    ['location', 'keyword.declaration'],
    ['^~', 'operator'],
    ['/a/', null],
    ['{}', 'punctuation.bracket'],
    ['location', 'keyword.declaration'],
    ['=', 'operator'],
    ['/b', null],
    ['{}', 'punctuation.bracket'],
  ]);
});

test('nginx: quoted strings span lines', () => {
  const code =
    "log_format main '$remote_addr \"$request\"\n    # not a comment\n    \\'$status';\nserver_tokens off;\n";
  expect(tokenKinds('nginx', code)).toEqual([
    ['log_format', 'keyword'],
    ['main', null],
    ["'", 'string'],
    ['$remote_addr', 'variable'],
    ['"', 'string'],
    ['$request', 'variable'],
    ['"', 'string'],
    ['# not a comment', 'string'],
    ["\\'", 'string.escape'],
    ['$status', 'variable'],
    ["'", 'string'],
    [';', 'punctuation.delimiter'],
    ['server_tokens', 'keyword'],
    ['off', 'boolean'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('nginx', code);
});
