import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('razor: expressions, escapes, comments, and addresses in markup', () => {
  expect(
    tokenKinds('razor', '<p>@user.Name @(a + 1) a@b.c @@x @* c *@</p>')
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['@', 'keyword.control'],
    ['user', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Name', 'type'],
    ['@', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['a@b.c', null],
    ['@@', 'string.escape'],
    ['x', null],
    ['@* c *@', 'comment'],
    ['</', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // an implicit expression takes calls and indexes, not a final `.`
  expect(tokenKinds('razor', '@Html.Raw("<b>")[0]?.X. @await F()')).toEqual([
    ['@', 'keyword.control'],
    ['Html', 'type'],
    ['.', 'punctuation.delimiter'],
    ['Raw', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['"<b>"', 'string'],
    [')[', 'punctuation.bracket'],
    ['0', 'number'],
    [']', 'punctuation.bracket'],
    ['?.', 'operator'],
    ['X', 'type'],
    ['.', null],
    ['@', 'keyword.control'],
    ['await', 'keyword.declaration'],
    ['F', 'function'],
    ['()', 'punctuation.bracket'],
  ]);
  const code = '@* one\n   two *@\n<p>x</p>\n';
  assertLineFedParity('razor', code);
  expect(tokenKinds('razor', code).slice(0, 2)).toEqual([
    ['@* one', 'comment'],
    ['two *@', 'comment'],
  ]);
});

test('razor: statements switch to markup at tags and `@:`', () => {
  const code =
    '@foreach (var i in xs)\n{\n    <li>@i</li>\n    @:Item @i\n    var n = 1;\n}\nelse\n';
  assertLineFedParity('razor', code);
  expect(tokenKinds('razor', code)).toEqual([
    ['@foreach', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['var', 'keyword.declaration'],
    ['i', 'variable'],
    ['in', 'keyword.declaration'],
    ['xs', 'variable'],
    [')', 'punctuation.bracket'],
    ['{', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['@', 'keyword.control'],
    ['i', 'variable'],
    ['</', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['@:', 'keyword.control'],
    ['Item', null],
    ['@', 'keyword.control'],
    ['i', 'variable'],
    ['var', 'keyword.declaration'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
  ]);
  // an element keeps markup across lines until it closes; a generic type
  // or a comparison is no tag
  const nested =
    '@if (a < b) {\n  <div>\n    text } here\n  </div>\n  List<int> x;\n} else { <br> }\n<p>}</p>\n';
  assertLineFedParity('razor', nested);
  const kinds = tokenKinds('razor', nested);
  expect(kinds).toContainEqual(['text } here', null]);
  expect(kinds).toContainEqual(['List', 'type']);
  expect(kinds).toContainEqual(['else', 'keyword.control']);
  expect(kinds.at(-4)).toEqual(['}', null]);
});

test('razor: directives, code blocks, sections, and Blazor attributes', () => {
  expect(
    tokenKinds(
      'razor',
      '@page "/x"\n@model Shop.Item\n@using System.Linq\n@section Scripts {\n<b>x</b>\n}\n'
    )
  ).toEqual([
    ['@', 'keyword.control'],
    ['page', 'keyword'],
    ['"/x"', 'string'],
    ['@', 'keyword.control'],
    ['model', 'keyword'],
    ['Shop', 'type'],
    ['.', 'punctuation.delimiter'],
    ['Item', 'type'],
    ['@', 'keyword.control'],
    ['using', 'keyword.import'],
    ['System', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Linq', 'namespace'],
    ['@', 'keyword.control'],
    ['section', 'keyword'],
    ['Scripts', 'variable'],
    ['{', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['b', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['x', null],
    ['</', 'punctuation.bracket.html'],
    ['b', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('razor', '<button @onclick="() => n++" title="@n">')
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['button', 'tag'],
    ['@onclick', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"', 'string'],
    ['()', 'punctuation.bracket'],
    ['=>', 'operator'],
    ['n', 'variable'],
    ['++', 'operator'],
    ['"', 'string'],
    ['title', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"', 'string'],
    ['@', 'keyword.control'],
    ['n', 'variable'],
    ['"', 'string'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // a C# comment or verbatim string goes on across lines
  const code =
    '@code {\n  /* a\n  b */\n  string s = @"x\n""y";\n  void F() { }\n}\n<p>@s</p>\n';
  assertLineFedParity('razor', code);
  const kinds = tokenKinds('razor', code);
  for (const [text, kind] of [
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['@"x', 'string'],
    ['""y"', 'string'],
    ['F', 'function.definition'],
    ['p', 'tag'],
  ]) {
    expect(kinds).toContainEqual([text, kind]);
  }
});
