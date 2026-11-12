import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('org: headlines with TODO keywords, priorities, and tags', () => {
  // stars start a headline only in the first column, before a blank
  expect(
    tokenKinds(
      'org',
      '* TODO [#A] Ship *it* :work:urgent:\n** Plain heading\n*bold* at start'
    )
  ).toEqual([
    ['*', 'punctuation.markup'],
    ['TODO', 'keyword'],
    ['[#A]', 'constant'],
    ['Ship', 'title'],
    ['*it*', 'emphasis.strong'],
    [':work:urgent:', 'label'],
    ['**', 'punctuation.markup'],
    ['Plain heading', 'title'],
    ['*bold*', 'emphasis.strong'],
    ['at start', null],
  ]);
});

test('org: keywords, comments, fixed-width lines, drawers, and planning', () => {
  expect(
    tokenKinds(
      'org',
      '#+TITLE: My *Doc*\n#+OPTIONS: toc:nil\n# comment\n#not a comment\n: fixed <&>'
    )
  ).toEqual([
    ['#+TITLE:', 'keyword'],
    ['My', 'title'],
    ['*Doc*', 'emphasis.strong'],
    ['#+OPTIONS:', 'keyword'],
    ['toc:nil', null],
    ['# comment', 'comment'],
    ['#not a comment', null],
    [': fixed <&>', 'text.literal'],
  ]);
  expect(
    tokenKinds(
      'org',
      '  :PROPERTIES:\n  :ID:       abc-1\n  :END:\nSCHEDULED: <2024-01-31 Wed> DEADLINE: <2024-02-01 Thu>\nCLOSED: [2024-01-30 Tue 10:00]'
    )
  ).toEqual([
    [':PROPERTIES:', 'keyword'],
    [':ID:', 'property'],
    ['abc-1', null],
    [':END:', 'keyword'],
    ['SCHEDULED:', 'keyword'],
    ['<2024-01-31 Wed>', 'constant'],
    ['DEADLINE:', 'keyword'],
    ['<2024-02-01 Thu>', 'constant'],
    ['CLOSED:', 'keyword'],
    ['[2024-01-30 Tue 10:00]', 'constant'],
  ]);
});

test('org: emphasis, links, footnotes, LaTeX, entities, and macros', () => {
  // markers inside words or next to blanks are text
  expect(
    tokenKinds(
      'org',
      'Use /it/, _u_, =v=, ~c~, +s+, a*b*c and * not* and 2*3*4.'
    )
  ).toEqual([
    ['Use', null],
    ['/it/', 'emphasis'],
    [',', null],
    ['_u_', 'emphasis'],
    [',', null],
    ['=v=', 'string'],
    [',', null],
    ['~c~', 'text.literal'],
    [',', null],
    ['+s+', 'comment'],
    [', a*b*c and * not* and 2*3*4.', null],
  ]);
  expect(
    tokenKinds(
      'org',
      'See [[https://orgmode.org][the manual]], [[file:a.org]], [fn:1], $x$, \\(a\\), \\[b\\], \\alpha, {{{m(1)}}}.'
    )
  ).toEqual([
    ['See', null],
    ['[[', 'punctuation.bracket'],
    ['https://orgmode.org', 'link_uri'],
    ['][', 'punctuation.bracket'],
    ['the manual', 'link_text'],
    [']]', 'punctuation.bracket'],
    [',', null],
    ['[[', 'punctuation.bracket'],
    ['file:a.org', 'link_uri'],
    [']]', 'punctuation.bracket'],
    [',', null],
    ['[fn:1]', 'label'],
    [',', null],
    ['$x$', 'string.special'],
    [',', null],
    ['\\(a\\)', 'string.special'],
    [',', null],
    ['\\[b\\]', 'string.special'],
    [',', null],
    ['\\alpha', 'string.escape'],
    [',', null],
    ['{{{m(1)}}}', 'variable.special'],
    ['.', null],
  ]);
});

test('org: lists, checkboxes, descriptions, rules, and tables', () => {
  expect(
    tokenKinds(
      'org',
      '- [X] done\n  + [ ] todo\n  * nested\n1. one\n2) two\n- Term :: desc\n-----'
    )
  ).toEqual([
    ['-', 'punctuation.list_marker'],
    ['[X]', 'punctuation.special'],
    ['done', null],
    ['+', 'punctuation.list_marker'],
    ['[ ]', 'punctuation.special'],
    ['todo', null],
    ['*', 'punctuation.list_marker'],
    ['nested', null],
    ['1.', 'punctuation.list_marker'],
    ['one', null],
    ['2)', 'punctuation.list_marker'],
    ['two', null],
    ['-', 'punctuation.list_marker'],
    ['Term', 'property'],
    ['::', 'punctuation.special'],
    ['desc', null],
    ['-----', 'punctuation.markup'],
  ]);
  expect(tokenKinds('org', '| a | *b* |\n|---+---|\n| 1 | 2 |')).toEqual([
    ['|', 'punctuation.markup'],
    ['a', null],
    ['|', 'punctuation.markup'],
    ['*b*', 'emphasis.strong'],
    ['|', 'punctuation.markup'],
    ['|---+---|', 'punctuation.markup'],
    ['|', 'punctuation.markup'],
    ['1', null],
    ['|', 'punctuation.markup'],
    ['2', null],
    ['|', 'punctuation.markup'],
  ]);
});

test('org: source, example, and comment blocks', () => {
  // a known language highlights the body; an unknown one stays literal
  const code1 =
    '#+begin_src elisp :tangle yes\n(message "hi")\n#+end_src\n#+BEGIN_SRC nolang\n*x*\n#+END_SRC\n';
  expect(tokenKinds('org', code1)).toEqual([
    ['#+begin_src', 'keyword'],
    ['elisp', 'label'],
    [':tangle yes', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['message', 'function'],
    ['"hi"', 'string'],
    [')', 'punctuation.bracket'],
    ['#+end_src', 'keyword'],
    ['#+BEGIN_SRC', 'keyword'],
    ['nolang', 'label'],
    ['*x*', 'text.literal'],
    ['#+END_SRC', 'keyword'],
  ]);
  assertLineFedParity('org', code1);
  // only the matching end line closes a block
  const code2 =
    '#+begin_example\n* not a heading\n#+end_src\n#+end_example\n#+BEGIN_COMMENT\nhidden\n#+END_COMMENT\n#+begin_quote\n*q*\n#+end_quote\n';
  expect(tokenKinds('org', code2)).toEqual([
    ['#+begin_example', 'keyword'],
    ['* not a heading', 'text.literal'],
    ['#+end_src', 'text.literal'],
    ['#+end_example', 'keyword'],
    ['#+BEGIN_COMMENT', 'keyword'],
    ['hidden', 'comment'],
    ['#+END_COMMENT', 'keyword'],
    ['#+begin_quote', 'keyword'],
    ['*q*', 'emphasis.strong'],
    ['#+end_quote', 'keyword'],
  ]);
  assertLineFedParity('org', code2);
  // a construct left open in the body ends with the block
  const code3 =
    '#+begin_src js\nconst s = `a\nb`; /* open\n#+end_src\n*after*\n';
  expect(tokenKinds('org', code3)).toEqual([
    ['#+begin_src', 'keyword'],
    ['js', 'label'],
    ['const', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['`a', 'string'],
    ['b`', 'string'],
    [';', 'punctuation.delimiter'],
    ['/* open', 'comment'],
    ['#+end_src', 'keyword'],
    ['*after*', 'emphasis.strong'],
  ]);
  assertLineFedParity('org', code3);
  // an Org body stays literal
  const code4 = '#+begin_src org\n* inner\n#+end_src\n';
  expect(tokenKinds('org', code4)).toEqual([
    ['#+begin_src', 'keyword'],
    ['org', 'label'],
    ['* inner', 'text.literal'],
    ['#+end_src', 'keyword'],
  ]);
  assertLineFedParity('org', code4);
});

test('org: plain links, unclosed openers, and description terms', () => {
  const code =
    'See https://example.com/ and /it/.\n\\( [[a {{{b [fn:c\n\\(x\\) [[d]] {{{e}}} [fn:f]\n- *t :: *d*\n';
  expect(tokenKinds('org', code)).toEqual([
    ['See', null],
    ['https://example.com/', 'link_uri'],
    ['and', null],
    ['/it/', 'emphasis'],
    ['.', null],
    ['\\( [[a {{{b [fn:c', null],
    ['\\(x\\)', 'string.special'],
    ['[[', 'punctuation.bracket'],
    ['d', 'link_uri'],
    [']]', 'punctuation.bracket'],
    ['{{{e}}}', 'variable.special'],
    ['[fn:f]', 'label'],
    ['-', 'punctuation.list_marker'],
    ['*t', 'property'],
    ['::', 'punctuation.special'],
    // a failed search inside the term does not hold after it
    ['*d*', 'emphasis.strong'],
  ]);
  assertLineFedParity('org', code);
});

test('org: many `{{{` before one `}}` stay linear', () => {
  tokenKinds('org', '');
  for (const src of [
    `${'{'.repeat(400_000)}}}\n`,
    `${'{{{a'.repeat(200_000)}}} x\n`,
  ]) {
    const started = performance.now();
    tokenKinds('org', src);
    expect(performance.now() - started).toBeLessThan(1500);
  }
  expect(tokenKinds('org', '{{{{a}} {{{m(x)}}}\n')).toEqual([
    ['{{{{a}}', null],
    ['{{{m(x)}}}', 'variable.special'],
  ]);
});
