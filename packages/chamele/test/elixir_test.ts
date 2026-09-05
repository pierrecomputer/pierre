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
  colorOf,
  distinctColor as distinctColorOf,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  wordColor,
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

void t.test('elixir: a lone quote inside a heredoc does not close it', () => {
  // the closer check once and-ed the heredoc flag mask with a boolean, so the
  // first `"` in a heredoc body closed it, and a body cut two quotes into
  // its closer emitted the NUL sentinel past the end of the input
  const html = checkInvariants(lexer.hl, 'x = """\na "b" c\n"""\ny = 1\n', {
    theme: distinct,
  });
  assert.equal(within(html, 'a "b" c'), distinctColor('string'));
  assert.equal(exact(html, 'y'), distinctColor('variable'));
  assert.equal(exact(html, '1'), distinctColor('number'));
  for (const cut of [
    'x = """\na\n""',
    'x = """\na\n"',
    "x = '''\na 'b'\n''",
    '@doc """\na "b"\n""',
  ]) {
    checkInvariants(lexer.hl, cut);
  }
  const [whole, streamed] = wholeAndLineFed(
    'elixir',
    'x = """\na "b"\n"""\ny = 1\n'
  );
  assert.deepEqual(streamed, whole);
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('elixir: module directives, attributes, and every def form', () => {
  const html = distinctHl(
    'defmodule Shop.Cart do\n  @moduledoc """\n  Doc.\n  """\n  use GenServer\n  import Enum, only: [map: 2]\n  alias Shop.{Item, Order}\n  require Logger\n  @behaviour B\n  @max 100\n  @type t :: %__MODULE__{items: [Item.t()]}\n  defstruct items: [], total: 0.0\n  defmacro __using__(_) do quote do end end\n  defguard is_pos(x) when x > 0\n  defp helper(x), do: x\n  defdelegate f(x), to: M\n  defprotocol P do end\n  defimpl P, for: Any do end\n  defexception message: "x"\nend'
  );
  for (const word of [
    'defmodule',
    'defstruct',
    'defmacro',
    'defguard',
    'defp',
    'defdelegate',
    'defprotocol',
    'defimpl',
    'defexception',
  ]) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.declaration'),
      word
    );
  }
  for (const word of ['use', 'import', 'alias', 'require']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.import'),
      word
    );
  }
  for (const type of [
    'Shop',
    'Cart',
    'GenServer',
    'Enum',
    'Item',
    'Order',
    'Logger',
    'B',
    'M',
    'P',
    'Any',
  ]) {
    assert.equal(exactColor(html, type), distinctColorOf('type'), type);
  }
  for (const attr of ['@moduledoc', '@behaviour', '@max', '@type']) {
    assert.equal(exactColor(html, attr), distinctColorOf('attribute'), attr);
  }
  assert.equal(colorOf(html, 'Doc.'), distinctColorOf('comment.doc'));
  for (const sym of [
    'only:',
    'map:',
    'items:',
    'total:',
    'to:',
    'for:',
    'message:',
  ]) {
    assert.equal(
      exactColor(html, sym),
      distinctColorOf('string.special.symbol'),
      sym
    );
  }
  assert.equal(
    exactColor(html, '__MODULE__'),
    distinctColorOf('variable.special')
  );
  assert.equal(
    exactColor(html, '__using__'),
    distinctColorOf('variable.special')
  );
  for (const fn of ['is_pos', 'helper', 'f']) {
    assert.equal(
      exactColor(html, fn),
      distinctColorOf('function.definition'),
      fn
    );
  }
  assert.equal(wordColor(html, 'when'), distinctColorOf('keyword.operator'));
  for (const word of ['do', 'end', 'quote']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.control'),
      word
    );
  }
  assert.equal(exactColor(html, '::'), distinctColorOf('operator'));
  assert.equal(exactColor(html, '%'), distinctColorOf('punctuation.special'));
});

void t.test(
  'elixir: numeric literals, char literals, escapes, and sigils',
  () => {
    const html = distinctHl(
      'x = 0x1F + 0b101 + 0o17 + 1_000 + 1e3 + 2.5 + ?a; s = "str\\t#{x}" <> ~s(sigil #{x}) <> ~r/re/i <> ~w[a b]a; :atom; :"quoted atom"; true; false; nil'
    );
    for (const n of ['0x1F', '0b101', '0o17', '1_000', '1e3', '2.5']) {
      assert.equal(exactColor(html, n), distinctColorOf('number'), n);
    }
    assert.equal(exactColor(html, '?a'), distinctColorOf('string.special'));
    assert.equal(exactColor(html, '"str'), distinctColorOf('string'));
    assert.equal(exactColor(html, '\\t'), distinctColorOf('string.escape'));
    assert.equal(
      exactColor(html, '#{'),
      distinctColorOf('punctuation.special')
    );
    for (const s of ['~s(sigil', '~w[a b]a']) {
      assert.equal(colorOf(html, s), distinctColorOf('string'), s);
    }
    assert.equal(exactColor(html, '~r/re/i'), distinctColorOf('string.regex'));
    for (const sym of [':atom', ':"quoted atom"']) {
      assert.equal(
        exactColor(html, sym),
        distinctColorOf('string.special.symbol'),
        sym
      );
    }
    assert.equal(exactColor(html, 'true'), distinctColorOf('boolean'));
    assert.equal(exactColor(html, 'nil'), distinctColorOf('constant.builtin'));
    assert.equal(exactColor(html, '<>'), distinctColorOf('operator'));
  }
);

void t.test(
  'elixir: patterns, guards, control forms, captures, and pipes',
  () => {
    const html = distinctHl(
      'def f(%{k: v} = m, [h | t], opts \\\\ []) when is_map(m) and not is_nil(v) or v in [1] do\n  case v do\n    1 -> :one\n    _ -> :none\n  end\n  cond do\n    true -> :ok\n  end\n  if a, do: b, else: c\n  unless d, do: e\n  with {:ok, x} <- g() do x else _ -> :err end\n  for i <- 1..3, into: %{}, do: i\n  try do raise E, message: "m" rescue e in E -> e catch :exit, _ -> :c after :a end\n  receive do {:msg, m} -> m after 1000 -> :t end\n  fn x, y -> x + y end; &(&1 + &2); &f/1; m.field; m.f(); M.f(); @attr; __ENV__; self(); send(pid, :x); x |> f() |> g(); a ++ b; a -- b; a =~ b; a === b; a !== b; a && b; a || b; !a; ^pin; a <<< b\nend'
    );
    for (const word of [
      'case',
      'cond',
      'if',
      'unless',
      'with',
      'for',
      'try',
      'raise',
      'rescue',
      'catch',
      'after',
      'receive',
      'fn',
      'do',
      'else',
      'end',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.control'),
        word
      );
    }
    for (const word of ['when', 'and', 'not', 'or', 'in']) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.operator'),
        word
      );
    }
    for (const fn of ['is_map', 'is_nil', 'g', 'send']) {
      assert.equal(exactColor(html, fn), distinctColorOf('function'), fn);
    }
    for (const sym of [':one', ':none', ':ok', ':err', ':exit', ':msg']) {
      assert.equal(
        wordColor(html, sym),
        distinctColorOf('string.special.symbol'),
        sym
      );
    }
    for (const op of [
      '->',
      '<-',
      '..',
      '|',
      '\\\\',
      '|>',
      '++',
      '--',
      '=~',
      '===',
      '!==',
      '&&',
      '||',
      '!',
      '^',
      '<<<',
    ]) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
    for (const v of ['&1', '&2', '__ENV__', 'self']) {
      assert.equal(exactColor(html, v), distinctColorOf('variable.special'), v);
    }
    assert.equal(exactColor(html, 'field'), distinctColorOf('property'));
    assert.equal(exactColor(html, '@attr'), distinctColorOf('attribute'));
    assert.equal(exactColor(html, 'E'), distinctColorOf('type'));
  }
);

void t.test('elixir: heredocs, sigils, and blocks stream line-fed', () => {
  assertLineFedParity(
    'elixir',
    'x = """\na #{b}\n"""\n@doc """\nc\n"""\ny = ~S"""\nd\n"""\ndef f do\n  :ok\nend\n'
  );
});
