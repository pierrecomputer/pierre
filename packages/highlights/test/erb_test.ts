import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('erb: tag openers and closers around Ruby code', () => {
  expect(tokenKinds('erb', '<% if x -%><%= y %><%== z %><%- w %>')).toEqual([
    ['<%', 'punctuation.special'],
    ['if', 'keyword.control'],
    ['x', 'variable'],
    ['-%><%=', 'punctuation.special'],
    ['y', 'variable'],
    ['%><%==', 'punctuation.special'],
    ['z', 'variable'],
    ['%><%-', 'punctuation.special'],
    ['w', 'variable'],
    ['%>', 'punctuation.special'],
  ]);
  // the first `%>` closes the tag, even inside a Ruby string
  expect(tokenKinds('erb', '<%= "a%>" %>')).toEqual([
    ['<%=', 'punctuation.special'],
    ['"a', 'string'],
    ['%>', 'punctuation.special'],
    ['" %>', null],
  ]);
});

test('erb: comments, the `<%%` escape, and html around tags', () => {
  expect(
    tokenKinds('erb', '<%# note %>\n<p>a <%% b &amp; <%= 1 %></p>')
  ).toEqual([
    ['<%# note %>', 'comment'],
    ['<', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['a <%% b', null],
    ['&amp;', 'string.special'],
    ['<%=', 'punctuation.special'],
    ['1', 'number'],
    ['%>', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // a Ruby comment ends at the closer
  expect(tokenKinds('erb', '<% # todo %>x')).toEqual([
    ['<%', 'punctuation.special'],
    ['# todo', 'comment'],
    ['%>', 'punctuation.special'],
    ['x', null],
  ]);
});

test('erb: a start tag continues after the ERB tags inside it', () => {
  expect(
    tokenKinds('erb', '<a href="/u/<%= id %>" <%= attrs %> class=x>t</a>')
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['href', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"/u/', 'string'],
    ['<%=', 'punctuation.special'],
    ['id', 'variable'],
    ['%>', 'punctuation.special'],
    ['"', 'string'],
    ['<%=', 'punctuation.special'],
    ['attrs', 'variable'],
    ['%>', 'punctuation.special'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['x', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['t', null],
    ['</', 'punctuation.bracket.html'],
    ['a', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

test('erb: html comments and raw-text bodies are lexed whole', () => {
  expect(tokenKinds('erb', '<!-- <%= x %> -->')).toEqual([
    ['<!-- <%= x %> -->', 'comment'],
  ]);
  const kinds = tokenKinds('erb', '<style>a { b: "<%= c %>" }</style>');
  expect(kinds).toContainEqual(['"<%= c %>"', 'string']);
});

test('erb: multi-line tags stream like the whole buffer', () => {
  for (const code of [
    '<%# one\ntwo %>\n<p>x</p>\n',
    '<% items.each do |i|\n  puts i\nend %>\n<b>y</b>\n',
    '<div\n  class="<%= a(\n  1) %> b"\n  id=<%= c %>>\n</div>\n',
    '<i <%# note\n%> title="t">\n',
    '<%= <<~TEXT\n  hi #{name}\nTEXT\n%>\n<p>z</p>\n',
    '<script>\nvar a = "<%= x %>";\n</script>\n<%= y %>\n',
    '<!--\n<%= x %>\n-->\n<%= y\n%>\n',
  ]) {
    assertLineFedParity('erb', code);
  }
  expect(
    tokenKinds('erb', '<% items.each do |i|\n  puts i\nend %>').slice(-3)
  ).toEqual([
    ['i', 'variable'],
    ['end', 'keyword.control'],
    ['%>', 'punctuation.special'],
  ]);
});
