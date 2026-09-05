import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let lua: TestLang;
t.before(() => (lua = loadLang('lua', '$hlLua')));

/**
 * Compile the whole module once for the streaming checks: StreamTokenizer and
 * codeToTokens run on the shared highlighter rather than the single-lexer
 * harness. Lazy, so the lexer-only tests still run while another language
 * file is mid-edit.
 */
let fullModuleReady = false;
function initFullModule(): void {
  if (fullModuleReady) return;
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
  fullModuleReady = true;
}

/** Tokens for `code` fed to StreamTokenizer one line per push. */
function lineStreamed(code: string): ThemedToken[][] {
  const stream = new StreamTokenizer({ lang: 'lua', theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/))
    streamed.push(...stream.pushCode(line));
  streamed.push(...stream.end());
  return streamed;
}

/** Line-fed streaming - the live tokenizer's shape - must equal whole-buffer. */
function assertLineStreamParity(code: string, label: string): void {
  initFullModule();
  assert.deepEqual(
    lineStreamed(code),
    codeToTokens(code, { lang: 'lua', theme: pierreDark }).tokens,
    label
  );
}

const DECL = themeColor('keyword.declaration');
const FUNCTION = themeColor('function.definition');
const CONTROL = themeColor('keyword.control');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');
const NUMBER = themeColor('number');
const VARIABLE = themeColor('variable');

void t.test('lua: functions, control flow, calls, strings, and numbers', () => {
  const src =
    'local function greet(name)\n  if name then print("hi", 42) elseif false then return end\nend';
  const html = checkInvariants(lua.hl, src);
  assert.equal(colorOf(html, 'function'), DECL);
  assert.equal(colorOf(html, 'greet'), FUNCTION);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'elseif'), CONTROL);
  assert.equal(colorOf(html, '"hi"'), STRING);
  assert.equal(colorOf(html, '42'), NUMBER);
});

void t.test('lua: line comments and long bracket strings/comments', () => {
  const src = '-- line\n--[=[ long\ncomment ]=]\nlocal s = [==[text\nbody]==]';
  const html = checkInvariants(lua.hl, src);
  assert.equal(colorOf(html, '-- line'), COMMENT);
  assert.equal(colorOf(html, '--[=[ long'), COMMENT);
  assert.equal(colorOf(html, '[==[text'), STRING);
});

void t.test(
  'lua: concatenation, varargs, and anonymous functions reset context',
  () => {
    const src =
      'local joined = left .. right\nlocal f = function(argument) return ... end\nlocal fraction = .5';
    const html = checkInvariants(lua.hl, src);
    assert.equal(colorOf(html, 'right'), VARIABLE);
    assert.equal(colorOf(html, 'argument'), VARIABLE);
    assert.equal(colorOf(html, '.5'), NUMBER);
  }
);

void t.test('lua: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    '--[[',
    '[=[',
    "'",
    'function',
    'é_日本語',
    '0x',
    '::label::',
  ])
    checkInvariants(lua.hl, src);
  const split = loadLang('lua', '$hlLua', 6);
  checkInvariants(split.hl, 'local x = [=[a]=]\n');
});

void t.test(
  'lua: a long bracket with a huge level cannot corrupt the instance',
  () => {
    // the stream delimiter used to be built before any bound or streaming
    // check, so thousands of `=` overwrote the lexer checkpoints and keyword
    // tables that sit behind the 32-byte delimiter region
    const open = '--[' + '='.repeat(14000) + '[ unterminated\n';
    checkInvariants(lua.hl, open);
    const html = checkInvariants(lua.hl, 'local x = true and nil');
    assert.equal(colorOf(html, 'local'), DECL);
    assert.equal(colorOf(html, 'true'), themeColor('boolean'));
    assert.equal(colorOf(html, 'and'), themeColor('keyword.operator'));
    assert.equal(colorOf(html, 'nil'), themeColor('constant.builtin'));

    initFullModule();
    for (const level of [0, 3, 30, 31, 200, 14000]) {
      const code =
        '--[' + '='.repeat(level) + '[ open\nlocal x = true and nil\n';
      const streamed = lineStreamed(code);
      // token contents exclude the terminators, and the final LF opens one
      // more, empty, line
      assert.equal(
        streamed.map((l) => l.map((tk) => tk.content).join('')).join('\n'),
        code,
        `level ${level} lossless`
      );
      const after = codeToTokens('local x = true and nil', {
        lang: 'lua',
        theme: pierreDark,
      }).tokens[0];
      assert.equal(
        after.find((tk) => tk.content.trim() === 'local')?.color,
        DECL,
        `level ${level} follow-up`
      );
    }
    // a level that fits the delimiter region continues the comment line-fed
    const eq = '='.repeat(30);
    assertLineStreamParity(
      `--[${eq}[ open\nlocal x = 1\n]${eq}]\nprint(x)\n`,
      'level 30'
    );
  }
);

void t.test(
  'lua: long brackets, labels, and goto stream line-fed like whole-buffer',
  () => {
    assertLineStreamParity(
      '--[[ a\nb ]] x = 1\nlocal s = [==[ a\nb ]==]\n::top::\ngoto top\nfoo\n(1)\n',
      'lua parity'
    );
    const html = checkInvariants(lua.hl, '::top::\ngoto top\nfoo\n(1)\n');
    assert.equal(colorOf(html, 'goto'), themeColor('keyword'));
    assert.equal(colorOf(html, 'foo'), VARIABLE);
  }
);

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(lua.hl, src, { theme: distinctTheme });

void t.test('lua: every comment form', () => {
  assert.deepEqual(
    tokenKinds(
      'lua',
      '-- line\n--- doc\n--[[ block\nmulti ]]\n--[==[ level\ntwo ]==]\n--[[]] x = 1'
    ),
    [
      ['-- line', 'comment'],
      ['--- doc', 'comment.doc'],
      ['--[[ block', 'comment'],
      ['multi ]]', 'comment'],
      ['--[==[ level', 'comment'],
      ['two ]==]', 'comment'],
      ['--[[]]', 'comment'],
      ['x', 'variable'],
      ['=', 'operator'],
      ['1', 'number'],
    ]
  );
});

void t.test('lua: string escapes, long strings, and concatenation', () => {
  assert.deepEqual(
    tokenKinds(
      'lua',
      's = "a\\n b\\t c\\"" .. \'d\\\'\' .. [[long]] .. [=[level\none]=]'
    ),
    [
      ['s', 'variable'],
      ['=', 'operator'],
      ['"a', 'string'],
      ['\\n', 'string.escape'],
      ['b', 'string'],
      ['\\t', 'string.escape'],
      ['c', 'string'],
      ['\\"', 'string.escape'],
      ['"', 'string'],
      ['..', 'operator'],
      ["'d", 'string'],
      ["\\'", 'string.escape'],
      ["'", 'string'],
      ['..', 'operator'],
      ['[[long]]', 'string'],
      ['..', 'operator'],
      ['[=[level', 'string'],
      ['one]=]', 'string'],
    ]
  );
});

void t.test('lua: numeric literal forms', () => {
  const html = hl('n = 0x1F + 0x1p4 + 1e10 + .5 + 0xA.8p1 + 1_000 + 42 + 3.25');
  for (const n of [
    '0x1F',
    '0x1p4',
    '1e10',
    '.5',
    '0xA.8p1',
    '1_000',
    '42',
    '3.25',
  ]) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
});

void t.test('lua: every keyword in its bucket', () => {
  const html = hl(
    'local x = nil; if a and b then return elseif not c then break else goto e end; while d or f do end; repeat until false; for i in t do end; function g() end; y = true'
  );
  for (const word of ['local', 'function']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  for (const word of ['and', 'not', 'or', 'in']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.operator'),
      word
    );
  }
  for (const word of [
    'if',
    'then',
    'elseif',
    'break',
    'else',
    'end',
    'while',
    'do',
    'repeat',
    'until',
    'for',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('keyword.control'), word);
  }
  for (const word of ['return', 'goto']) {
    assert.equal(wordColor(html, word), distinctColor('keyword'), word);
  }
  assert.equal(wordColor(html, 'nil'), distinctColor('constant.builtin'));
  assert.equal(wordColor(html, 'false'), distinctColor('boolean'));
  assert.equal(wordColor(html, 'true'), distinctColor('boolean'));
});

void t.test('lua: every operator', () => {
  const html = hl(
    'a = b .. c; a == b; a ~= b; a <= b; a >= b; a // b; #t; a ^ b; a % b; a & b; a | b; a ~ b; a << b; a >> b; a < b; a > b; -a; a + b; a * b; a / b; f(...)'
  );
  for (const op of [
    '=',
    '..',
    '==',
    '~=',
    '<=',
    '>=',
    '//',
    '#',
    '^',
    '%',
    '&',
    '|',
    '~',
    '<<',
    '>>',
    '<',
    '>',
    '-',
    '+',
    '*',
    '/',
    '...',
  ]) {
    assert.equal(exactColor(html, op), distinctColor('operator'), op);
  }
});

void t.test('lua: calls, methods, fields, and indexing', () => {
  assert.deepEqual(
    tokenKinds(
      'lua',
      'obj:method(1)\nobj.field.sub = 2\nf()\nt[1]\nt["k"]\nt.k()'
    ),
    [
      ['obj', 'variable'],
      [':', 'punctuation.delimiter'],
      ['method', 'function.method'],
      ['(', 'punctuation.bracket'],
      ['1', 'number'],
      [')', 'punctuation.bracket'],
      ['obj', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['field', 'property'],
      ['.', 'punctuation.delimiter'],
      ['sub', 'property'],
      ['=', 'operator'],
      ['2', 'number'],
      ['f', 'function'],
      ['()', 'punctuation.bracket'],
      ['t', 'variable'],
      ['[', 'punctuation.bracket'],
      ['1', 'number'],
      [']', 'punctuation.bracket'],
      ['t', 'variable'],
      ['[', 'punctuation.bracket'],
      ['"k"', 'string'],
      [']', 'punctuation.bracket'],
      ['t', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['k', 'function.method'],
      ['()', 'punctuation.bracket'],
    ]
  );
});

void t.test('lua: function definition forms', () => {
  assert.deepEqual(
    tokenKinds(
      'lua',
      'function M.f() end\nfunction M:g(self, x) end\nlocal function h() end\nlocal f = function() end'
    ),
    [
      ['function', 'keyword.declaration'],
      ['M', 'function.definition'],
      ['.', 'punctuation.delimiter'],
      ['f', 'function.method'],
      ['()', 'punctuation.bracket'],
      ['end', 'keyword.control'],
      ['function', 'keyword.declaration'],
      ['M', 'function.definition'],
      [':', 'punctuation.delimiter'],
      ['g', 'function.method'],
      ['(', 'punctuation.bracket'],
      ['self', 'variable'],
      [',', 'punctuation.delimiter'],
      ['x', 'variable'],
      [')', 'punctuation.bracket'],
      ['end', 'keyword.control'],
      ['local function', 'keyword.declaration'],
      ['h', 'function.definition'],
      ['()', 'punctuation.bracket'],
      ['end', 'keyword.control'],
      ['local', 'keyword.declaration'],
      ['f', 'variable'],
      ['=', 'operator'],
      ['function', 'keyword.declaration'],
      ['()', 'punctuation.bracket'],
      ['end', 'keyword.control'],
    ]
  );
});

void t.test('lua: table constructors and control structures', () => {
  const html = hl(
    'local t = { a = 1, ["b"] = 2, [3] = 3 }\nrepeat\n  x = x + 1\nuntil x > 10\nfor k, v in pairs(t) do end\nfor i = 1, 10, 2 do end'
  );
  assert.equal(exactColor(html, '"b"'), distinctColor('string'));
  assert.equal(exactColor(html, '3'), distinctColor('number'));
  assert.equal(exactColor(html, 'repeat'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'until'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'pairs'), distinctColor('function'));
  assert.equal(exactColor(html, 'in'), distinctColor('keyword.operator'));
  assert.equal(exactColor(html, '10'), distinctColor('number'));
  assert.equal(exactColor(html, ','), distinctColor('punctuation.delimiter'));
});

void t.test('lua: comments, long strings, and blocks stream line-fed', () => {
  assertLineFedParity(
    'lua',
    '--[==[ a\nb ]==]\nlocal s = [[x\ny]] .. "z"\nfunction f()\n  return {\n    a = 1,\n  }\nend\n'
  );
});
