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
  lexer = loadLang('gleam', '$hlGleam');
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
  'gleam: imports, types, constructors, functions, labels, and attributes',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'import gleam/io\nimport gleam/list\n\n/// A shape\npub type Shape {\n  Circle(radius: Float)\n}\n\npub fn area(shape: Shape) -> Float {\n  case shape {\n    Circle(radius: r) -> 3.14 *. r *. r\n  }\n}\n\n@external(erlang, "mod", "fn")\npub fn main() {\n  let shapes = [Circle(1.0)]\n  shapes\n  |> list.map(area)\n  |> io.debug\n  let assert Ok(x) = Ok(1)\n  let t = #(1, "two", True, Nil)\n  todo as "later"\n}',
      { theme: distinct }
    );
    assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
    assert.equal(exact(html, 'gleam'), distinctColor('namespace'));
    assert.equal(exact(html, '/'), distinctColor('punctuation.delimiter'));
    assert.equal(exact(html, 'io'), distinctColor('namespace'));
    assert.equal(within(html, '/// A shape'), distinctColor('comment.doc'));
    assert.equal(exact(html, 'pub type'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Shape'), distinctColor('type'));
    assert.equal(exact(html, 'Circle'), distinctColor('constructor'));
    assert.equal(exact(html, 'radius'), distinctColor('variable.parameter'));
    assert.equal(exact(html, 'Float'), distinctColor('type'));
    assert.equal(exact(html, 'area'), distinctColor('function.definition'));
    assert.equal(exact(html, '->'), distinctColor('operator'));
    assert.equal(exact(html, 'case'), distinctColor('keyword.control'));
    assert.equal(exact(html, '3.14'), distinctColor('number'));
    assert.equal(exact(html, '*.'), distinctColor('operator'));
    assert.equal(exact(html, '@external'), distinctColor('attribute'));
    assert.equal(exact(html, '"mod"'), distinctColor('string'));
    assert.equal(exact(html, 'main'), distinctColor('function.definition'));
    assert.equal(exact(html, 'let'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, '|>'), distinctColor('operator'));
    assert.equal(exact(html, 'map'), distinctColor('function.method'));
    assert.equal(exact(html, 'debug'), distinctColor('property'));
    assert.equal(exact(html, 'assert'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'Ok'), distinctColor('constructor'));
    assert.equal(exact(html, '#'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'True'), distinctColor('boolean'));
    assert.equal(exact(html, 'Nil'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'todo'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'as'), distinctColor('keyword.import'));
  }
);

void t.test('gleam: type context keeps type applications as types', () => {
  const html = checkInvariants(
    lexer.hl,
    'fn f(a: List(Int), b: Result(a, Nil)) -> Option(Int) {\n  Some(1)\n}\nconst x: List(Int) = [1_000, 0xff]',
    { theme: distinct }
  );
  assert.equal(exact(html, 'List'), distinctColor('type'));
  assert.equal(exact(html, 'Result'), distinctColor('type'));
  assert.equal(exact(html, 'Option'), distinctColor('type'));
  assert.equal(exact(html, 'Some'), distinctColor('constructor'));
  assert.equal(exact(html, 'const'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, '1_000'), distinctColor('number'));
  assert.equal(exact(html, '0xff'), distinctColor('number'));
});

void t.test('gleam: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '//',
    '"unterminated',
    '"a\\',
    '@',
    '@$',
    '$',
    '#',
    '#(',
    '<<',
    '..',
    '.',
    ':',
    'é 日本語',
    'import',
    'fn',
    'type',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('gleam: split ranges bound every lookahead', () => {
  const src = 'import a/b\nfn f(x: Int) -> Int {\n  x |> g("s\\n") // c\n}';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('gleam', '$hlGleam', split).hl, src);
  }
});

void t.test(
  'gleam: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('gleam: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x61ea3d;
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

void t.test('gleam: multi-line constructs resume line-fed', () => {
  for (const code of [
    'pub fn main() {\n  "one\ntwo"\n}\n',
    'import gleam/io\nfn f() -> Int {\n  Ok(1)\n}\n',
    'fn g(\n  a: Int,\n) -> List(Int) {\n  [a]\n}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('gleam', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('gleam: import forms and type declarations', () => {
  const html = distinctHl(
    'import gleam/io\nimport gleam/list.{map, filter}\nimport gleam/option.{type Option, None, Some}\n\npub type Shape {\n  Circle(radius: Float)\n  Rect(width: Float, height: Float)\n}\npub opaque type Id { Id(Int) }\nconst pi = 3.14\n@external(erlang, "m", "f")\npub fn ext(x: Int) -> Int'
  );
  assert.equal(wordColor(html, 'import'), distinctColorOf('keyword.import'));
  for (const ns of ['gleam', 'io', 'list', 'option']) {
    assert.equal(wordColor(html, ns), distinctColorOf('namespace'), ns);
  }
  assert.equal(exactColor(html, '/'), distinctColorOf('punctuation.delimiter'));
  for (const v of ['map', 'filter']) {
    assert.equal(exactColor(html, v), distinctColorOf('variable'), v);
  }
  for (const word of [
    'type',
    'pub type',
    'pub opaque type',
    'const',
    'pub fn',
  ]) {
    assert.equal(
      exactColor(html, word),
      distinctColorOf('keyword.declaration'),
      word
    );
  }
  for (const type of ['Option', 'None', 'Some', 'Shape', 'Float', 'Int']) {
    assert.equal(wordColor(html, type), distinctColorOf('type'), type);
  }
  for (const c of ['Circle', 'Rect']) {
    assert.equal(wordColor(html, c), distinctColorOf('constructor'), c);
  }
  // the opaque type's own name comes first; its constructor follows
  assert.deepEqual(
    tokenKinds('gleam', 'pub opaque type Id { Id(Int) }').slice(1, 4),
    [
      ['Id', 'type'],
      ['{', 'punctuation.bracket'],
      ['Id', 'constructor'],
    ]
  );
  for (const p of ['radius', 'width', 'height', 'x']) {
    assert.equal(exactColor(html, p), distinctColorOf('variable.parameter'), p);
  }
  assert.equal(exactColor(html, 'pi'), distinctColorOf('variable'));
  assert.equal(exactColor(html, '3.14'), distinctColorOf('number'));
  assert.equal(exactColor(html, '@external'), distinctColorOf('attribute'));
  assert.equal(exactColor(html, '"m"'), distinctColorOf('string'));
  assert.equal(exactColor(html, 'ext'), distinctColorOf('function.definition'));
  assert.equal(exactColor(html, '->'), distinctColorOf('operator'));
});

void t.test('gleam: literal forms and float operators', () => {
  const html = distinctHl(
    'let x = 0x1F + 0b101 + 0o17 + 1_000 + 1.5e3\nlet f = 2.5 +. 3.0 *. 4.0 /. 5.0 -. 1.0\nlet s = "esc\\t" <> "multi\nline"\nlet b = True && False || !True\nlet t = #(1, "a")\nlet l = [1, ..rest]\nlet n = Nil\nlet r = Ok(1)\nlet e = Error("x")'
  );
  for (const n of ['0x1F', '0b101', '0o17', '1_000', '1.5e3', '2.5', '3.0']) {
    assert.equal(exactColor(html, n), distinctColorOf('number'), n);
  }
  for (const op of ['+', '+.', '*.', '/.', '-.', '<>', '&&', '||', '!', '..']) {
    assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
  }
  assert.equal(exactColor(html, '"esc'), distinctColorOf('string'));
  assert.equal(exactColor(html, '\\t'), distinctColorOf('string.escape'));
  assert.equal(exactColor(html, '"multi\nline"'), distinctColorOf('string'));
  for (const b of ['True', 'False']) {
    assert.equal(wordColor(html, b), distinctColorOf('boolean'), b);
  }
  assert.equal(exactColor(html, '#'), distinctColorOf('punctuation.special'));
  assert.equal(exactColor(html, 'Nil'), distinctColorOf('constant.builtin'));
  for (const c of ['Ok', 'Error']) {
    assert.equal(exactColor(html, c), distinctColorOf('constructor'), c);
  }
});

void t.test(
  'gleam: case clauses, guards, use, captures, and member access',
  () => {
    const html = distinctHl(
      'pub fn area(shape: Shape) -> Float {\n  case shape {\n    Circle(r) if r >. 0.0 -> 3.14 *. r *. r\n    Rect(w, h) | Rect(h, w) -> w *. h\n    _ -> 0.0\n  }\n}\nfn main() {\n  let assert Ok(x) = f()\n  use y <- result.try(g(x))\n  let z = fn(a, b) { a + b }\n  let w = f(_, 1)\n  io.println("x")\n  x.field\n  panic as "never"\n  todo as "later"\n  echo x\n  x == 1 && x != 2 || x < 3 && x > 4 && x <= 5 && x >= 6 && x % 2 == 0\n}'
    );
    for (const fn of ['area', 'main']) {
      assert.equal(
        exactColor(html, fn),
        distinctColorOf('function.definition'),
        fn
      );
    }
    assert.equal(
      exactColor(html, 'shape'),
      distinctColorOf('variable.parameter')
    );
    for (const word of [
      'case',
      'if',
      'assert',
      'use',
      'panic',
      'todo',
      'echo',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.control'),
        word
      );
    }
    for (const word of ['let', 'fn']) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.declaration'),
        word
      );
    }
    for (const c of ['Circle', 'Rect', 'Ok']) {
      assert.equal(wordColor(html, c), distinctColorOf('constructor'), c);
    }
    for (const fn of ['f', 'g']) {
      assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
    }
    for (const m of ['try', 'println']) {
      assert.equal(exactColor(html, m), distinctColorOf('function.method'), m);
    }
    assert.equal(exactColor(html, 'field'), distinctColorOf('property'));
    for (const op of [
      '>.',
      '->',
      '|',
      '<-',
      '==',
      '!=',
      '<',
      '>',
      '<=',
      '>=',
      '%',
    ]) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
    assert.equal(exactColor(html, '_'), distinctColorOf('variable'));
  }
);

void t.test('gleam: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'gleam',
      '// comment\n/// doc\n//// module doc\nfn f() {} // tail'
    ),
    [
      ['// comment', 'comment'],
      ['/// doc', 'comment.doc'],
      ['//// module doc', 'comment.doc'],
      ['fn', 'keyword.declaration'],
      ['f', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test('gleam: multi-line strings and case blocks stream line-fed', () => {
  assertLineFedParity(
    'gleam',
    'fn f() {\n  let s = "a\n  b"\n  case s {\n    "x" -> 1\n    _ -> 2\n  }\n}\n'
  );
});
