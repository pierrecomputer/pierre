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
  lexer = loadLang('elixir', '$hlElixir');
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
  'elixir: definitions, control flow, atoms, aliases, and attributes',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'defmodule Demo.Box do\n  @moduledoc """\n  doc\n  """\n  @max 10\n  use GenServer\n  alias Demo.Util, as: U\n  def build(name, opts \\\\ []) when is_binary(name) do\n    case Enum.map(opts, &(&1 * 2)) do\n      0 -> {:error, :empty}\n      n when n > @max -> raise ArgumentError, message: "big"\n      _ -> {:ok, %__MODULE__{name: name}}\n    end\n  end\n  defp helper?(x), do: not is_nil(x)\nend',
      { theme: distinct }
    );
    assert.equal(
      exact(html, 'defmodule'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exact(html, 'Demo'), distinctColor('type'));
    assert.equal(within(html, '\n  doc\n'), distinctColor('comment.doc'));
    assert.equal(exact(html, '@max'), distinctColor('attribute'));
    assert.equal(exact(html, 'use'), distinctColor('keyword.import'));
    assert.equal(exact(html, 'as:'), distinctColor('string.special.symbol'));
    assert.equal(exact(html, 'def'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'build'), distinctColor('function.definition'));
    assert.equal(exact(html, 'when'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'is_binary'), distinctColor('function'));
    assert.equal(within(html, 'case '), distinctColor('keyword.control'));
    assert.equal(exact(html, 'map'), distinctColor('function.method'));
    assert.equal(exact(html, '&1'), distinctColor('variable.special'));
    assert.equal(exact(html, ':error'), distinctColor('string.special.symbol'));
    assert.equal(exact(html, '__MODULE__'), distinctColor('variable.special'));
    assert.equal(exact(html, 'helper?'), distinctColor('function.definition'));
    assert.equal(exact(html, 'end'), distinctColor('keyword.control'));
  }
);

void t.test('elixir: strings, heredocs, sigils, charlists, and numbers', () => {
  const html = checkInvariants(
    lexer.hl,
    'x = "hi #{name}\\n"; y = """\nmulti #{a}\n"""; r = ~r/ab+/i; w = ~w(a b)a; c = \'chars\'; ch = ?a; n = 1_000 + 0x1F # note',
    { theme: distinct }
  );
  assert.equal(within(html, 'hi '), distinctColor('string'));
  assert.equal(exact(html, '#{'), distinctColor('punctuation.special'));
  assert.equal(within(html, '\\n'), distinctColor('string.escape'));
  assert.equal(within(html, 'multi '), distinctColor('string'));
  assert.equal(exact(html, '~r/ab+/i'), distinctColor('string.regex'));
  assert.equal(exact(html, '~w(a b)a'), distinctColor('string'));
  assert.equal(exact(html, "'chars'"), distinctColor('string'));
  assert.equal(exact(html, '?a'), distinctColor('string.special'));
  assert.equal(exact(html, '1_000'), distinctColor('number'));
  assert.equal(within(html, '# note'), distinctColor('comment'));
});

void t.test('elixir: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '0x_',
    '\u00e9 \u65e5\u672c\u8a9e',
    '#',
    '@',
    '${',
    '#{',
    '<<',
    '%',
    '"""',
    '~r/',
    '~w(',
    ':"',
    '?',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('elixir: split ranges bound every lookahead', () => {
  const src = 'x = "a #{b} c" # note\ny = ~w(a b)\n%{a: 1}';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('elixir', '$hlElixir', split).hl, src);
  }
});

void t.test(
  'elixir: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('elixir: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?\u00e9';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('elixir: multi-line constructs resume line-fed', () => {
  for (const code of [
    'x = """\none #{y}\n"""\nz = 1\n',
    's = "a #{\n  x\n} b"\n',
    '@doc """\nhello\n"""\ndef f, do: 1\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('elixir', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
