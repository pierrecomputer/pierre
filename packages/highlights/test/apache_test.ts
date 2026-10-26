import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('apache: directives, sections, comments, and plain arguments', () => {
  expect(
    tokenKinds(
      'apache',
      '# main\nListen 80\nIncludeOptional conf.d/*.conf\n<Directory "/var/www">\n  Options -Indexes # not a comment\n  AllowOverride None\n</Directory>\n'
    )
  ).toEqual([
    ['# main', 'comment'],
    ['Listen', 'keyword'],
    ['80', 'number'],
    ['IncludeOptional', 'keyword.import'],
    ['conf.d/*.conf', null],
    ['<', 'punctuation.bracket.html'],
    ['Directory', 'tag'],
    ['"/var/www"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['Options', 'keyword'],
    ['-Indexes # not a comment', null],
    ['AllowOverride', 'keyword'],
    ['None', null],
    ['</', 'punctuation.bracket.html'],
    ['Directory', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  expect(tokenKinds('apache', 'RewriteEngine on\nSSLEngine Off')).toEqual([
    ['RewriteEngine', 'keyword'],
    ['on', 'boolean'],
    ['SSLEngine', 'keyword'],
    ['Off', 'boolean'],
  ]);
});

test('apache: variables, regexes, and rewrite flags', () => {
  expect(
    tokenKinds(
      'apache',
      'RewriteCond %{HTTP_HOST} !^www\\. [NC,OR]\nRewriteRule ^(.*)$ https://%1/$1?q=%20 [L,R=301,E=X:1]'
    )
  ).toEqual([
    ['RewriteCond', 'keyword'],
    ['%{HTTP_HOST}', 'variable'],
    ['!', 'operator'],
    ['^www\\.', 'string.regex'],
    ['[', 'punctuation.bracket'],
    ['NC', 'constant'],
    [',', 'punctuation.delimiter'],
    ['OR', 'constant'],
    [']', 'punctuation.bracket'],
    ['RewriteRule', 'keyword'],
    ['^(.*)$', 'string.regex'],
    ['https://', null],
    ['%1', 'variable'],
    ['/', null],
    ['$1', 'variable'],
    ['?q=%20', null],
    ['[', 'punctuation.bracket'],
    ['L', 'constant'],
    [',', 'punctuation.delimiter'],
    ['R', 'constant'],
    ['=', 'operator'],
    ['301', 'number'],
    [',', 'punctuation.delimiter'],
    ['E', 'constant'],
    ['=', 'operator'],
    ['X:1', null],
    [']', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('apache', 'ErrorLog ${LOG_DIR}/error.log')).toEqual([
    ['ErrorLog', 'keyword'],
    ['${LOG_DIR}', 'variable'],
    ['/error.log', null],
  ]);
});

test('apache: a backslash at a line end continues the directive', () => {
  const code =
    'AddType text/html .html \\\n  .htm\\\n  .shtml\n\nListen 8080\nHeader set X "a \\"b\\" \\\nc"\n';
  expect(tokenKinds('apache', code)).toEqual([
    ['AddType', 'keyword'],
    ['text/html .html', null],
    ['\\', 'punctuation.special'],
    ['.htm', null],
    ['\\', 'punctuation.special'],
    ['.shtml', null],
    ['Listen', 'keyword'],
    ['8080', 'number'],
    ['Header', 'keyword'],
    ['set X', null],
    ['"a', 'string'],
    ['\\"', 'string.escape'],
    ['b', 'string'],
    ['\\"', 'string.escape'],
    ['\\', 'string.escape'],
    ['c"', 'string'],
  ]);
  assertLineFedParity('apache', code);
  // a blank line ends a continued directive
  expect(tokenKinds('apache', 'A b \\\n\nListen 1')).toEqual([
    ['A', 'keyword'],
    ['b', null],
    ['\\', 'punctuation.special'],
    ['Listen', 'keyword'],
    ['1', 'number'],
  ]);
});
