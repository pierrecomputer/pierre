import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  distinctColor as distinctColorOf,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './_util';

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
  const url = new URL('../src/highlights.wat', import.meta.url);
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('erlang: every module attribute form', () => {
  const html = distinctHl(
    '-module(shop).\n-export([start/0, add/2]).\n-import(lists, [map/2]).\n-include("x.hrl").\n-include_lib("kernel/include/file.hrl").\n-record(item, {name :: string(), price = 0 :: number()}).\n-define(MAX, 100).\n-type t() :: #item{} | undefined.\n-spec add(t(), integer()) -> t().\n-behaviour(gen_server).\n-ifdef(TEST).\n-endif.\n-callback f() -> ok.\n-opaque o() :: term().\n-export_type([t/0]).\n-compile(export_all).\n-vsn("1").'
  );
  for (const attr of [
    '-module',
    '-export',
    '-record',
    '-define',
    '-type',
    '-spec',
    '-behaviour',
    '-ifdef',
    '-endif',
    '-callback',
    '-opaque',
    '-export_type',
    '-compile',
    '-vsn',
  ]) {
    assert.equal(wordColor(html, attr), distinctColorOf('keyword'), attr);
  }
  for (const attr of ['-import', '-include', '-include_lib']) {
    assert.equal(
      wordColor(html, attr),
      distinctColorOf('keyword.import'),
      attr
    );
  }
  assert.equal(exactColor(html, 'shop'), distinctColorOf('namespace'));
  for (const fn of [
    'start',
    'add',
    'map',
    'string',
    'number',
    'integer',
    'term',
    'f',
  ]) {
    assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
  }
  for (const type of ['item', 'o']) {
    assert.equal(exactColor(html, type), distinctColorOf('type'), type);
  }
  assert.equal(exactColor(html, 'MAX'), distinctColorOf('constant'));
  for (const sym of [
    'lists',
    'gen_server',
    'export_all',
    'name',
    'price',
    'ok',
  ]) {
    assert.equal(
      wordColor(html, sym),
      distinctColorOf('string.special.symbol'),
      sym
    );
  }
  assert.equal(exactColor(html, '"x.hrl"'), distinctColorOf('string'));
  assert.equal(
    exactColor(html, 'undefined'),
    distinctColorOf('constant.builtin')
  );
  assert.equal(exactColor(html, '#'), distinctColorOf('punctuation.special'));
  for (const op of ['/', '::', '->', '|']) {
    assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
  }
});

void t.test(
  'erlang: numeric, char, string, binary, list, map, and record literals',
  () => {
    const html = distinctHl(
      'X = 16#FF + 2#101 + 1_000 + 1.5e3 + $a + 36#Z; S = "str\\t" ++ "multi\nline"; A = atom; Q = \'quoted atom\'; B = <<"bin", X:8, Y/binary>>; L = [1, 2 | T]; M = #{k => v}; R = #item{name = N}; F = R#item.name; true; false; undefined; nil'
    );
    for (const n of ['16#FF', '2#101', '1_000', '1.5e3', '36#Z']) {
      assert.equal(exactColor(html, n), distinctColorOf('number'), n);
    }
    assert.equal(exactColor(html, '$a'), distinctColorOf('string.special'));
    assert.equal(exactColor(html, '"str'), distinctColorOf('string'));
    assert.equal(exactColor(html, '\\t'), distinctColorOf('string.escape'));
    assert.equal(exactColor(html, '"multi\nline"'), distinctColorOf('string'));
    for (const sym of ['atom', 'binary', 'k', 'v', 'name', 'nil']) {
      assert.equal(
        wordColor(html, sym),
        distinctColorOf('string.special.symbol'),
        sym
      );
    }
    assert.equal(
      exactColor(html, "'quoted atom'"),
      distinctColorOf('string.special.symbol')
    );
    for (const b of ['<<', '>>', '[', ']']) {
      assert.equal(
        wordColor(html, b),
        distinctColorOf('punctuation.bracket'),
        b
      );
    }
    assert.equal(exactColor(html, 'item'), distinctColorOf('type'));
    assert.equal(exactColor(html, '#'), distinctColorOf('punctuation.special'));
    for (const op of ['++', '|', '=>', '/']) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
    assert.equal(exactColor(html, 'true'), distinctColorOf('boolean'));
    assert.equal(
      exactColor(html, 'undefined'),
      distinctColorOf('constant.builtin')
    );
  }
);

void t.test(
  'erlang: clauses, funs, macros, control forms, and word operators',
  () => {
    const html = distinctHl(
      'start() ->\n    Pid = spawn(fun() -> loop([]) end),\n    register(?MODULE, Pid),\n    {ok, Pid}.\nadd(Name, Price) when is_integer(Price), Price > 0; Price =:= 0 ->\n    ?MODULE ! {add, Name},\n    io:format("~s~n", [Name]),\n    F = fun add/2,\n    case Name of "a" -> a; _ when true -> b end,\n    if Price > 1 -> big; true -> small end,\n    try f() of V -> V catch throw:E -> E after ok end,\n    receive {msg, M} -> M after 5000 -> timeout end,\n    begin x end,\n    [X || X <- L, X > 1],\n    A andalso B orelse not C, A and B or C xor D, A div B, A rem B, A band B, A bor B, A bxor B, A bnot B, A bsl B, A bsr B,\n    A =:= B, A =/= B, A == B, A /= B, A =< B, A >= B, A -- B, ?LOG("x"), ?MAX.'
    );
    for (const fn of ['start', 'add']) {
      assert.equal(
        wordColor(html, fn),
        distinctColorOf('function.definition'),
        fn
      );
    }
    for (const fn of [
      'spawn',
      'loop',
      'register',
      'is_integer',
      'format',
      'f',
    ]) {
      assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
    }
    assert.equal(wordColor(html, 'fun'), distinctColorOf('keyword'));
    for (const c of ['?MODULE', '?LOG', '?MAX']) {
      assert.equal(wordColor(html, c), distinctColorOf('constant'), c);
    }
    assert.equal(exactColor(html, 'io'), distinctColorOf('namespace'));
    for (const word of [
      'end',
      'case',
      'of',
      'if',
      'try',
      'catch',
      'after',
      'receive',
      'begin',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.control'),
        word
      );
    }
    for (const word of [
      'when',
      'andalso',
      'orelse',
      'not',
      'and',
      'or',
      'xor',
      'div',
      'rem',
      'band',
      'bor',
      'bxor',
      'bnot',
      'bsl',
      'bsr',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.operator'),
        word
      );
    }
    for (const op of [
      '->',
      '!',
      '||',
      '<-',
      '=:=',
      '=/=',
      '==',
      '/=',
      '=<',
      '>=',
      '--',
      '>',
    ]) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
    for (const v of [
      'Pid',
      'Name',
      'Price',
      'V',
      'E',
      'M',
      'X',
      'L',
      'A',
      'B',
    ]) {
      assert.equal(wordColor(html, v), distinctColorOf('variable'), v);
    }
  }
);

void t.test('erlang: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'erlang',
      '% comment\n%% double\n%%% triple\n-module(x). % tail'
    ),
    [
      ['% comment', 'comment'],
      ['%% double', 'comment'],
      ['%%% triple', 'comment'],
      ['-module', 'keyword'],
      ['(', 'punctuation.bracket'],
      ['x', 'namespace'],
      [')', 'punctuation.bracket'],
      ['.', 'punctuation.delimiter'],
      ['% tail', 'comment'],
    ]
  );
});

void t.test(
  'erlang: multi-line strings, binaries, and clauses stream line-fed',
  () => {
    assertLineFedParity(
      'erlang',
      'f() ->\n    S = "a\nb",\n    B = <<\n      1,\n      2\n    >>,\n    {S, B}.\n%% done\n'
    );
  }
);
