import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('rst: adornments, and titles after an overline', () => {
  const code =
    'Title\n=====\n\n----\nOverlined\n----\nText\n\n=====  =====\nA      B\n';
  expect(tokenKinds('rst', code)).toEqual([
    // an underlined title is plain: a line feed cannot see its adornment
    ['Title', null],
    ['=====', 'title'],
    ['----', 'title'],
    ['Overlined', 'title'],
    ['----', 'title'],
    ['Text', null],
    ['=====  =====', 'punctuation.markup'],
    ['A      B', null],
  ]);
  assertLineFedParity('rst', code);
});

test('rst: inline markup stays on its line', () => {
  expect(
    tokenKinds(
      'rst',
      'A *b* **c** ``d`` `e` :f:`g` h_ i__ `j <k>`_ [1]_ |s| \\* 2*3*4 x*y*'
    )
  ).toEqual([
    ['A', null],
    ['*b*', 'emphasis'],
    ['**c**', 'emphasis.strong'],
    ['``d``', 'text.literal'],
    ['`e`', 'string'],
    [':f:', 'function'],
    ['`g`', 'string'],
    ['h_ i__ `j', 'link_text'],
    ['<k>', 'link_uri'],
    ['`_ [1]_', 'link_text'],
    ['|s|', 'variable.special'],
    ['\\*', 'string.escape'],
    ['2*3*4 x*y*', null],
  ]);
  // a letter of any script before or after markup keeps it text
  expect(tokenKinds('rst', 'é*x* 日本*語*です *ok*')).toEqual([
    ['é*x* 日本*語*です', null],
    ['*ok*', 'emphasis'],
  ]);
  // unclosed markup and names that only end in underscores stay text
  expect(tokenKinds('rst', '*open and __init__ ``x\nnext*')).toEqual([
    ['*open and __init__ ``x', null],
    ['next*', null],
  ]);
  expect(tokenKinds('rst', 'see https://a.b/c?d=1 and :py:func:`f`')).toEqual([
    ['see', null],
    ['https://a.b/c?d=1', 'link_uri'],
    ['and', null],
    [':py:func:', 'function'],
    ['`f`', 'string'],
  ]);
});

test('rst: explicit markup, field lists, and list markers', () => {
  expect(
    tokenKinds(
      'rst',
      '.. note:: x\n.. _t: https://a.b\n.. [#n] foot\n.. |s| image:: p.png\n.. not a directive\n:Author: Ada\n- a\n#. b\n(c) d\n| e\n+--+\n'
    )
  ).toEqual([
    ['..', 'punctuation.special'],
    ['note', 'keyword'],
    ['::', 'punctuation.special'],
    ['x', null],
    ['..', 'punctuation.special'],
    ['_t:', 'link_text'],
    ['https://a.b', 'link_uri'],
    ['..', 'punctuation.special'],
    ['[#n]', 'label'],
    ['foot', null],
    ['..', 'punctuation.special'],
    ['|s|', 'variable.special'],
    ['image', 'keyword'],
    ['::', 'punctuation.special'],
    ['p.png', null],
    ['.. not a directive', 'comment'],
    [':Author:', 'property'],
    ['Ada', null],
    ['-', 'punctuation.list_marker'],
    ['a', null],
    ['#.', 'punctuation.list_marker'],
    ['b', null],
    ['(c)', 'punctuation.list_marker'],
    ['d', null],
    ['|', 'punctuation.markup'],
    ['e', null],
    ['+--+', 'punctuation.markup'],
  ]);
});

test('rst: comments, literal blocks, and code bodies follow indentation', () => {
  const code =
    'Para::\n\n    *literal*\n\n  more\nback\n\n..\n   comment body\n\n.. code-block:: python\n   :linenos:\n\n   x = 1\nafter\n';
  expect(tokenKinds('rst', code)).toEqual([
    ['Para', null],
    ['::', 'punctuation.special'],
    ['*literal*', 'text.literal'],
    ['more', 'text.literal'],
    ['back', null],
    ['..', 'comment'],
    ['comment body', 'comment'],
    ['..', 'punctuation.special'],
    ['code-block', 'keyword'],
    ['::', 'punctuation.special'],
    ['python', null],
    [':linenos:', 'property'],
    ['x = 1', 'text.literal'],
    ['after', null],
  ]);
  assertLineFedParity('rst', code);
});
