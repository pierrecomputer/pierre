import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
} from './util';

// one unique color per token type so equal styles cannot merge neighboring
// spans and hide a classification behind a same-colored token
const distinct = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(
      tokenTypes
        .filter((name) => !['background', 'foreground', 'none'].includes(name))
        .map((name, i) => [name, '#' + (0x100000 + i * 0x101).toString(16)])
    ),
  },
} as unknown as Theme;

/** The distinct theme's color for a token type name. */
function distinctColor(name: string): string {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  return distinct.style.syntax?.[name] as string;
}

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('erlang', '$hlErlang');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/**
 * Tokens for `code` from the whole buffer and from a StreamTokenizer fed one
 * line per push - the chunk shape the LiveTokenizer uses - so a test can
 * assert that a construct crossing line boundaries resumes correctly.
 */
function wholeAndLineFed(
  lang: Lang,
  code: string
): [ThemedToken[][], ThemedToken[][]] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return [whole, streamed];
}

/** The color of the first span whose trimmed text is exactly `word`. */
function exact(html: string, word: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

/** The color of the first span containing `text`. */
function within(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.includes(text))?.color;
}

void t.test(
  'erlang: attributes, clauses, variables, atoms, macros, and records',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '-module(demo).\n-export([add/2]).\n-record(state, {count = 0}).\n-define(MAX, 10).\n-include_lib("kernel/include/file.hrl").\n-spec add(integer(), integer()) -> integer().\n%% two numbers\nadd(A, B) when is_integer(A) andalso B > 0 ->\n    Pid = spawn(fun() -> ok end),\n    Pid ! {add, A + B},\n    receive\n        {reply, N} -> N;\n        stop -> ?MAX\n    after 1000 -> io:format("~p~n", [#state{count = 1}])\n    end.\nhelper() -> undefined.',
      { theme: distinct }
    );
    assert.equal(exact(html, '-module'), distinctColor('keyword'));
    assert.equal(exact(html, 'demo'), distinctColor('namespace'));
    assert.equal(exact(html, 'add'), distinctColor('function'));
    assert.equal(exact(html, '-record'), distinctColor('keyword'));
    assert.equal(exact(html, 'state'), distinctColor('type'));
    assert.equal(exact(html, 'count'), distinctColor('string.special.symbol'));
    assert.equal(exact(html, 'MAX'), distinctColor('constant'));
    assert.equal(exact(html, '-include_lib'), distinctColor('keyword.import'));
    assert.equal(
      exact(html, '"kernel/include/file.hrl"'),
      distinctColor('string')
    );
    assert.equal(exact(html, '-spec'), distinctColor('keyword'));
    assert.equal(within(html, '%% two numbers'), distinctColor('comment'));
    assert.equal(exact(html, 'when'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'is_integer'), distinctColor('function'));
    assert.equal(exact(html, 'andalso'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'Pid'), distinctColor('variable'));
    assert.equal(exact(html, 'fun'), distinctColor('keyword'));
    assert.equal(exact(html, '!'), distinctColor('operator'));
    assert.equal(exact(html, 'receive'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'stop'), distinctColor('string.special.symbol'));
    assert.equal(exact(html, '?MAX'), distinctColor('constant'));
    assert.equal(exact(html, 'after'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'io'), distinctColor('namespace'));
    assert.equal(exact(html, 'format'), distinctColor('function'));
    assert.equal(exact(html, '#'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'end'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'helper'), distinctColor('function.definition'));
    assert.equal(exact(html, 'undefined'), distinctColor('constant.builtin'));
  }
);

void t.test('erlang: literals, binaries, and operators', () => {
  const html = checkInvariants(
    lexer.hl,
    'X = [16#FF, 2#1010, 1.5e3, $a, $\\n, \'quoted atom\', <<"bin"/utf8>>, true, "multi\\nline"],\nY = X =:= [] orelse X =< 3, #{a => 1}.',
    { theme: distinct }
  );
  assert.equal(exact(html, '16#FF'), distinctColor('number'));
  assert.equal(exact(html, '2#1010'), distinctColor('number'));
  assert.equal(exact(html, '1.5e3'), distinctColor('number'));
  assert.equal(exact(html, '$a'), distinctColor('string.special'));
  assert.equal(exact(html, '$\\n'), distinctColor('string.special'));
  assert.equal(
    exact(html, "'quoted atom'"),
    distinctColor('string.special.symbol')
  );
  assert.equal(exact(html, '<<'), distinctColor('punctuation.bracket'));
  assert.equal(exact(html, '"bin"'), distinctColor('string'));
  assert.equal(exact(html, 'true'), distinctColor('boolean'));
  assert.equal(exact(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exact(html, '=:='), distinctColor('operator'));
  assert.equal(exact(html, 'orelse'), distinctColor('keyword.operator'));
  assert.equal(exact(html, '=<'), distinctColor('operator'));
  assert.equal(exact(html, '=>'), distinctColor('operator'));
});

void t.test('erlang: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '%',
    '"unterminated',
    "'",
    '$',
    '$\\',
    '?',
    '??',
    '#',
    '-',
    '-x',
    '<<',
    '>>',
    '16#',
    'é 日本語',
    '::',
    '..',
    '.',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('erlang: split ranges bound every lookahead', () => {
  const src =
    '-module(m).\nf(X) -> io:format("~p", [X#r{a = $b}]). % c\ng() -> 16#F.';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('erlang', '$hlErlang', split).hl, src);
  }
});

void t.test(
  'erlang: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x66,
      0x6f,
      0x6f,
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

void t.test('erlang: deterministic fuzz preserves lexer invariants', () => {
  let state = 0xe41a96;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('erlang: multi-line constructs resume line-fed', () => {
  for (const code of [
    'f() ->\n    "one\ntwo".\n',
    '-define(X,\n  1).\ng() -> ok.\n',
    'h(A) ->\n    A#r{x = 1}.\n%% c\nk() -> ok.\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('erlang', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
