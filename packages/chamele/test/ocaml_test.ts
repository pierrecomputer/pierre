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
  lexer = loadLang('ocaml', '$hlOcaml');
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
  'ocaml: declarations, control flow, types, constructors, and modules',
  () => {
    const html = checkInvariants(
      lexer.hl,
      "open Printf\nmodule M = Map.Make (String)\ntype 'a tree = Leaf | Node of 'a tree * 'a [@@deriving show]\nexception Bad of string\nlet rec insert x = function\n  | Leaf -> Node (Leaf, x)\n  | Node (l, v) as n -> if x < v then insert x l else n\nlet count : int ref = ref 0\nlet greet ?(loud = false) ~name () = List.iter print_endline [name]; raise (Bad \"no\")",
      { theme: distinct }
    );
    assert.equal(exact(html, 'open'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Printf'), distinctColor('namespace'));
    assert.equal(exact(html, 'module'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'M'), distinctColor('namespace'));
    assert.equal(exact(html, 'type'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, "'a tree"), distinctColor('type'));
    assert.equal(exact(html, 'Leaf'), distinctColor('constructor'));
    assert.equal(exact(html, 'of'), distinctColor('keyword.control'));
    assert.equal(exact(html, '[@@'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'deriving'), distinctColor('attribute'));
    assert.equal(
      exact(html, 'exception'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exact(html, 'let rec'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'insert'), distinctColor('function.definition'));
    assert.equal(exact(html, 'function'), distinctColor('keyword.control'));
    assert.equal(exact(html, '->'), distinctColor('operator'));
    assert.equal(exact(html, 'count'), distinctColor('variable'));
    assert.equal(exact(html, 'int ref'), distinctColor('type.builtin'));
    assert.equal(exact(html, '~name'), distinctColor('variable.parameter'));
    assert.equal(exact(html, 'List'), distinctColor('namespace'));
    assert.equal(exact(html, 'iter'), distinctColor('function'));
    assert.equal(exact(html, 'raise'), distinctColor('function'));
  }
);

void t.test(
  'ocaml: comments, strings, quoted strings, chars, and numbers',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '(* a (* nested *) b *)\n(** doc *)\nlet s = {id|hello "x"|id} ^ "a\\n" in let c = \'x\' and n = 1_000 + 0xff and v = `Ok',
      { theme: distinct }
    );
    assert.equal(within(html, 'nested'), distinctColor('comment'));
    assert.equal(within(html, 'doc'), distinctColor('comment.doc'));
    assert.equal(exact(html, '{id|hello "x"|id}'), distinctColor('string'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
    assert.equal(exact(html, "'x'"), distinctColor('string'));
    assert.equal(exact(html, '1_000'), distinctColor('number'));
    assert.equal(exact(html, '`Ok'), distinctColor('variant'));
  }
);

void t.test('ocaml: malformed constructs stay total and lossless', () => {
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
    '(*',
    '{id|',
    "'",
    '[@',
    '`',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('ocaml: split ranges bound every lookahead', () => {
  const src = "x(* c *)\nlet s = {q|a\nb|q} in f 'c' [@attr]";
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('ocaml', '$hlOcaml', split).hl, src);
  }
});

void t.test(
  'ocaml: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('ocaml: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('ocaml: multi-line constructs resume line-fed', () => {
  for (const code of [
    'let s = {id|one\ntwo|id}\nlet x = 1\n',
    '(* open\nstill *)\nlet x = 1\n',
    'let s = "one\ntwo"\nlet y = 2\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('ocaml', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
