import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
} from './util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('matlab', '$hlMatlab');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'matlab: function heads, calls, classes, transposes, and handles',
  () => {
    assert.deepEqual(
      tokenKinds(
        'matlab',
        "function [m, s] = stats(x, varargin)\n    n = numel(x);\n    if nargin > 1 && strcmp(varargin{1}, 'robust')\n        m = NaN;\n    end\nend\nclassdef Shape < handle\nend\nA = [1 2; 3 4]';\nf = @(t) sin(t) .* cos(t);\n"
      ),
      [
        ['function', 'keyword.declaration'],
        ['[', 'punctuation.bracket'],
        ['m', 'variable'],
        [',', 'punctuation.delimiter'],
        ['s', 'variable'],
        [']', 'punctuation.bracket'],
        ['=', 'operator'],
        ['stats', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['x', 'variable.parameter'],
        [',', 'punctuation.delimiter'],
        ['varargin', 'variable.parameter'],
        [')', 'punctuation.bracket'],
        ['n', 'variable'],
        ['=', 'operator'],
        ['numel', 'function'],
        ['(', 'punctuation.bracket'],
        ['x', 'variable'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['if', 'keyword.control'],
        ['nargin', 'variable'],
        ['>', 'operator'],
        ['1', 'number'],
        ['&&', 'operator'],
        ['strcmp', 'function'],
        ['(', 'punctuation.bracket'],
        ['varargin', 'variable'],
        ['{', 'punctuation.bracket'],
        ['1', 'number'],
        ['}', 'punctuation.bracket'],
        [',', 'punctuation.delimiter'],
        ["'robust'", 'string'],
        [')', 'punctuation.bracket'],
        ['m', 'variable'],
        ['=', 'operator'],
        ['NaN', 'constant.builtin'],
        [';', 'punctuation.delimiter'],
        ['end', 'keyword.control'],
        ['end', 'keyword.control'],
        ['classdef', 'keyword.declaration'],
        ['Shape', 'type'],
        ['<', 'operator'],
        ['handle', 'type'],
        ['end', 'keyword.control'],
        ['A', 'variable'],
        ['=', 'operator'],
        ['[', 'punctuation.bracket'],
        ['1 2', 'number'],
        [';', 'punctuation.delimiter'],
        ['3 4', 'number'],
        [']', 'punctuation.bracket'],
        ["'", 'operator'],
        [';', 'punctuation.delimiter'],
        ['f', 'variable'],
        ['=', 'operator'],
        ['@', 'punctuation.special'],
        ['(', 'punctuation.bracket'],
        ['t', 'variable.parameter'],
        [')', 'punctuation.bracket'],
        ['sin', 'function'],
        ['(', 'punctuation.bracket'],
        ['t', 'variable'],
        [')', 'punctuation.bracket'],
        ['.*', 'operator'],
        ['cos', 'function'],
        ['(', 'punctuation.bracket'],
        ['t', 'variable'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
      ]
    );
  }
);

void t.test('matlab: comments, strings, continuations, and members', () => {
  const html = distinctHl(
    '%{\nblock\n%}\nx = "dq ""esc"" end"; % tail\ny = \'it\'\'s\';\nz = x ...\n  + 1;\nB = A.\' * A;\nobj.Radius = pi * obj.area(2);\ndisp(MAX_VAL)\nw = 0x1F + 2.5e3 + 3i;\ng = @area;\nv = ~(A == B) | A ~= 0;\nfor k = 1:3, end\n'
  );
  assert.equal(exactColor(html, '%{\nblock\n%}'), distinctColor('comment'));
  assert.equal(exactColor(html, '"dq'), distinctColor('string'));
  assert.equal(exactColor(html, '""'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '% tail'), distinctColor('comment'));
  assert.equal(exactColor(html, "'it"), distinctColor('string'));
  assert.equal(exactColor(html, "''"), distinctColor('string.escape'));
  assert.equal(exactColor(html, '...'), distinctColor('comment'));
  assert.equal(exactColor(html, ".' *"), distinctColor('operator'));
  assert.equal(exactColor(html, 'Radius'), distinctColor('property'));
  assert.equal(exactColor(html, 'pi'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, 'area'), distinctColor('function.method'));
  assert.equal(exactColor(html, 'MAX_VAL'), distinctColor('constant'));
  assert.equal(exactColor(html, '0x1F'), distinctColor('number'));
  assert.equal(exactColor(html, '2.5e3'), distinctColor('number'));
  assert.equal(exactColor(html, '3i'), distinctColor('number'));
  assert.equal(exactColor(html, '@'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '= ~'), distinctColor('operator'));
  assert.equal(exactColor(html, '~='), distinctColor('operator'));
  assert.equal(exactColor(html, 'for'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, ':'), distinctColor('operator'));
});

void t.test('matlab: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '%',
    '%{',
    '%{\n',
    '%{ x\n',
    '%}',
    '"',
    "'",
    "x'",
    "x '",
    '...',
    '..',
    '.',
    '@',
    '@(',
    'function',
    'function [',
    'function [a',
    'function a =',
    'classdef',
    'é 日本語',
    '0x',
    '1e',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('matlab: split ranges bound every lookahead', () => {
  const src =
    "function r = f(a, b) % c\n  r = a' .* b + \"q\"\"q\" + 'x''y'; ... z\nend";
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('matlab', '$hlMatlab', split).hl, src);
  }
});

void t.test(
  'matlab: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x78,
      0x20,
      0x3d,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x20,
      0xff
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('matlab: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x2d9e57;
  const alphabet = 'abcXYZ09_ /\\"\'\n\t{}[]().,:;+-*=!<>&|#@$%~?^é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('matlab: multi-line constructs stream line-fed', () => {
  for (const code of [
    '%{\nblock\n%}\nx = [1 2 ...\n     3];\n',
    "function [a, b] = f(x, ...\n    y)\n  a = x';\nend\n",
    'classdef A < B\n  properties\n    X = 1\n  end\nend\n',
  ]) {
    assertLineFedParity('matlab', code);
  }
});
