import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  colorOf,
  loadLang,
  type TestLang,
  themeColor,
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
