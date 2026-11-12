import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('wikitext: headings, emphasis, lists, rules, and redirects', () => {
  expect(
    tokenKinds(
      'wikitext',
      "#REDIRECT [[Main Page]]\n== Title ''x'' ==\n=Not a heading\n----"
    )
  ).toEqual([
    ['#REDIRECT', 'keyword'],
    ['[[', 'punctuation.bracket'],
    ['Main Page', 'link_uri'],
    [']]', 'punctuation.bracket'],
    ['==', 'punctuation.markup'],
    ['Title', 'title'],
    ["''", 'punctuation.markup'],
    ['x', 'emphasis'],
    ["''", 'punctuation.markup'],
    ['==', 'punctuation.markup'],
    ['=Not a heading', null],
    ['----', 'punctuation.markup'],
  ]);
  // a run of four is an apostrophe and bold
  expect(
    tokenKinds(
      'wikitext',
      "'''bold''' ''italic'' '''''both''''' ''''four'''' a''b"
    )
  ).toEqual([
    ["'''", 'punctuation.markup'],
    ['bold', 'emphasis.strong'],
    ["'''", 'punctuation.markup'],
    ["''", 'punctuation.markup'],
    ['italic', 'emphasis'],
    ["''", 'punctuation.markup'],
    ["'''''", 'punctuation.markup'],
    ['both', 'emphasis.strong'],
    ["'''''", 'punctuation.markup'],
    ["'", null],
    ["'''", 'punctuation.markup'],
    ["four'", 'emphasis.strong'],
    ["'''", 'punctuation.markup'],
    ['a', null],
    ["''", 'punctuation.markup'],
    ['b', 'emphasis'],
  ]);
  // bold and italic end with the line
  const code = "'''open\nplain";
  expect(tokenKinds('wikitext', code)).toEqual([
    ["'''", 'punctuation.markup'],
    ['open', 'emphasis.strong'],
    ['plain', null],
  ]);
  assertLineFedParity('wikitext', code);
  expect(tokenKinds('wikitext', '* a\n#: b\n; term : def')).toEqual([
    ['*', 'punctuation.list_marker'],
    ['a', null],
    ['#:', 'punctuation.list_marker'],
    ['b', null],
    [';', 'punctuation.list_marker'],
    ['term : def', null],
  ]);
});

test('wikitext: links, URLs, entities, magic words, and signatures', () => {
  expect(
    tokenKinds(
      'wikitext',
      '[[Page|text [[inner]] more]] [[File:x.png|thumb]] [https://x.org site] [//x.org] [not a link]'
    )
  ).toEqual([
    ['[[', 'punctuation.bracket'],
    ['Page', 'link_uri'],
    ['|', 'punctuation.delimiter'],
    ['text', 'link_text'],
    ['[[', 'punctuation.bracket'],
    ['inner', 'link_uri'],
    [']]', 'punctuation.bracket'],
    ['more', 'link_text'],
    [']]', 'punctuation.bracket'],
    ['[[', 'punctuation.bracket'],
    ['File:x.png', 'link_uri'],
    ['|', 'punctuation.delimiter'],
    ['thumb', 'link_text'],
    [']]', 'punctuation.bracket'],
    ['[', 'punctuation.bracket'],
    ['https://x.org', 'link_uri'],
    ['site', 'link_text'],
    [']', 'punctuation.bracket'],
    ['[', 'punctuation.bracket'],
    ['//x.org', 'link_uri'],
    [']', 'punctuation.bracket'],
    ['[not a link]', null],
  ]);
  expect(
    tokenKinds(
      'wikitext',
      'Go to https://example.com/a?b=1. &nbsp; &bogus __TOC__ __x__ ~~~~ ~~'
    )
  ).toEqual([
    ['Go to', null],
    ['https://example.com/a?b=1', 'link_uri'],
    ['.', null],
    ['&nbsp;', 'string.special'],
    ['&bogus', null],
    ['__TOC__', 'constant.builtin'],
    ['__x__', null],
    ['~~~~', 'variable.special'],
    ['~~', null],
  ]);
});

test('wikitext: templates, parser functions, and parameters', () => {
  expect(
    tokenKinds(
      'wikitext',
      '{{Cite web|url=https://x.org|title=T}} {{#if: {{{1|}}} | y }} {{PAGENAME}} {{lc:ABC}}'
    )
  ).toEqual([
    ['{{', 'punctuation.bracket'],
    ['Cite web', 'function'],
    ['|', 'punctuation.delimiter'],
    ['url', 'property'],
    ['=', 'operator'],
    ['https://x.org', 'link_uri'],
    ['|', 'punctuation.delimiter'],
    ['title', 'property'],
    ['=', 'operator'],
    ['T', null],
    ['}}', 'punctuation.bracket'],
    ['{{', 'punctuation.bracket'],
    ['#if', 'keyword.control'],
    [':', 'punctuation.delimiter'],
    ['{{{', 'punctuation.bracket'],
    ['1', 'variable.parameter'],
    ['|', 'punctuation.delimiter'],
    ['}}}', 'punctuation.bracket'],
    ['|', 'punctuation.delimiter'],
    ['y', null],
    ['}}', 'punctuation.bracket'],
    ['{{', 'punctuation.bracket'],
    ['PAGENAME', 'constant.builtin'],
    ['}}', 'punctuation.bracket'],
    ['{{', 'punctuation.bracket'],
    ['lc', 'constant.builtin'],
    [':', 'punctuation.delimiter'],
    ['ABC', null],
    ['}}', 'punctuation.bracket'],
  ]);
  // argument lines continue the template; after it, `|` starts a table cell
  const code = '{{Infobox\n| name = A\n| list = {{x|\n  1}}\n}}\n| cell';
  expect(tokenKinds('wikitext', code)).toEqual([
    ['{{', 'punctuation.bracket'],
    ['Infobox', 'function'],
    ['|', 'punctuation.delimiter'],
    ['name', 'property'],
    ['=', 'operator'],
    ['A', null],
    ['|', 'punctuation.delimiter'],
    ['list', 'property'],
    ['=', 'operator'],
    ['{{', 'punctuation.bracket'],
    ['x', 'function'],
    ['|', 'punctuation.delimiter'],
    ['1', null],
    ['}}', 'punctuation.bracket'],
    ['}}', 'punctuation.bracket'],
    ['|', 'punctuation.markup'],
    ['cell', null],
  ]);
  assertLineFedParity('wikitext', code);
});

test('wikitext: tables', () => {
  expect(
    tokenKinds(
      'wikitext',
      '{| class="wikitable"\n|+ Caption\n|- style="x"\n! H1 !! H2\n| a || b\n|}'
    )
  ).toEqual([
    ['{|', 'punctuation.markup'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"wikitable"', 'string'],
    ['|+', 'punctuation.markup'],
    ['Caption', null],
    ['|-', 'punctuation.markup'],
    ['style', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"x"', 'string'],
    ['!', 'punctuation.markup'],
    ['H1', null],
    ['!!', 'punctuation.markup'],
    ['H2', null],
    ['|', 'punctuation.markup'],
    ['a', null],
    ['||', 'punctuation.markup'],
    ['b', null],
    ['|}', 'punctuation.markup'],
  ]);
});

test('wikitext: HTML tags, comments, and literal blocks', () => {
  expect(
    tokenKinds('wikitext', '<ref name="a">x</ref><br /><div style=\'c\'>')
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['ref', 'tag'],
    ['name', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"a"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['x', null],
    ['</', 'punctuation.bracket.html'],
    ['ref', 'tag'],
    ['><', 'punctuation.bracket.html'],
    ['br', 'tag'],
    ['/><', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['style', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ["'c'", 'string'],
    ['>', 'punctuation.bracket.html'],
  ]);
  // comments and literal tags can span lines
  const code1 =
    "a <!-- one\ntwo --> ''b''\n<nowiki>''x''\n[[y]]</nowiki> z\n<pre>p\n</PRE>";
  expect(tokenKinds('wikitext', code1)).toEqual([
    ['a', null],
    ['<!-- one', 'comment'],
    ['two -->', 'comment'],
    ["''", 'punctuation.markup'],
    ['b', 'emphasis'],
    ["''", 'punctuation.markup'],
    ['<', 'punctuation.bracket.html'],
    ['nowiki', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ["''x''", 'text.literal'],
    ['[[y]]', 'text.literal'],
    ['</', 'punctuation.bracket.html'],
    ['nowiki', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['z', null],
    ['<', 'punctuation.bracket.html'],
    ['pre', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['p', 'text.literal'],
    ['</', 'punctuation.bracket.html'],
    ['PRE', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  assertLineFedParity('wikitext', code1);
  // a known language highlights the body; an unknown one stays literal
  const code2 =
    '<syntaxhighlight lang="python">x = 1 # c\n</syntaxhighlight> \'\'after\'\'\n<source lang="nolang">*y*</source>\n';
  expect(tokenKinds('wikitext', code2)).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['syntaxhighlight', 'tag'],
    ['lang', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"python"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['# c', 'comment'],
    ['</', 'punctuation.bracket.html'],
    ['syntaxhighlight', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ["''", 'punctuation.markup'],
    ['after', 'emphasis'],
    ["''", 'punctuation.markup'],
    ['<', 'punctuation.bracket.html'],
    ['source', 'tag'],
    ['lang', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"nolang"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['*y*', 'text.literal'],
    ['</', 'punctuation.bracket.html'],
    ['source', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  assertLineFedParity('wikitext', code2);
  // a body that crosses a line break ends the line's emphasis
  const code3 =
    "''a <syntaxhighlight lang=\"js\">let s = `x\ny`</syntaxhighlight> b''\n";
  expect(tokenKinds('wikitext', code3)).toEqual([
    ["''", 'punctuation.markup'],
    ['a', 'emphasis'],
    ['<', 'punctuation.bracket.html'],
    ['syntaxhighlight', 'tag'],
    ['lang', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"js"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['`x', 'string'],
    ['y`', 'string'],
    ['</', 'punctuation.bracket.html'],
    ['syntaxhighlight', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['b', null],
    ["''", 'punctuation.markup'],
  ]);
  assertLineFedParity('wikitext', code3);
});
