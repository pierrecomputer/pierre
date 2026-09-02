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
  lexer = loadLang('c3', '$hlC3');
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
  'c3: modules, declarations, compile-time words, and members',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'module demo::app;\nimport std::io;\n<* Doc *>\nconst int MAX = 10;\nstruct Point { int x; }\nmacro @swap(&a, &b) { $typeof(a) tmp = a; }\nfn void Point.scale(&self, int k) @inline { self.x *= k; }\nfn int! divide(int a, int b) {\n  $if $defined(a): return a / b; $endif\n  List{int} list; io::printn("x");\n  foreach (i, v : list) { defer io::printfn("%d", v); }\n  return a ?? 0;\n}',
      { theme: distinct }
    );
    assert.equal(exact(html, 'module'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'demo'), distinctColor('namespace'));
    assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
    assert.equal(exact(html, 'io'), distinctColor('namespace'));
    assert.equal(within(html, 'Doc'), distinctColor('comment.doc'));
    assert.equal(exact(html, 'MAX'), distinctColor('constant'));
    assert.equal(exact(html, 'struct'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Point'), distinctColor('type'));
    assert.equal(exact(html, 'macro'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, '@swap'), distinctColor('attribute'));
    assert.equal(exact(html, '$typeof'), distinctColor('keyword'));
    assert.equal(exact(html, 'fn'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'scale'), distinctColor('function.definition'));
    assert.equal(exact(html, '@inline'), distinctColor('attribute'));
    assert.equal(exact(html, 'divide'), distinctColor('function.definition'));
    assert.equal(exact(html, '$if'), distinctColor('keyword.control'));
    assert.equal(exact(html, '$defined'), distinctColor('keyword'));
    assert.equal(exact(html, 'printn'), distinctColor('function'));
    assert.equal(exact(html, 'foreach'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'defer'), distinctColor('keyword.control'));
  }
);

void t.test(
  'c3: strings, raw strings, chars, byte strings, and numbers',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'String s = `raw\nstring`; char c = \'a\'; char[] h = x"41"; int n = 0x1F + 1_000u; // note\n/* a /* b */ c */',
      { theme: distinct }
    );
    assert.equal(within(html, 'raw'), distinctColor('string'));
    assert.equal(exact(html, "'a'"), distinctColor('string'));
    assert.equal(exact(html, 'x"41"'), distinctColor('string'));
    assert.equal(exact(html, '0x1F'), distinctColor('number'));
    assert.equal(exact(html, '1_000u'), distinctColor('number'));
    assert.equal(within(html, '// note'), distinctColor('comment'));
    assert.equal(within(html, '/* a /* b */ c */'), distinctColor('comment'));
  }
);

void t.test('c3: malformed constructs stay total and lossless', () => {
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
    '`',
    '<*',
    'x"',
    '$',
    '::',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('c3: split ranges bound every lookahead', () => {
  const src = 'x// tail\nString s = `a\nb`; io::f(0xff);';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('c3', '$hlC3', split).hl, src);
  }
});

void t.test('c3: malformed UTF-8 stays balanced and decodes losslessly', () => {
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
});

void t.test('c3: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('c3: multi-line constructs resume line-fed', () => {
  for (const code of [
    'String s = `one\ntwo`;\nint x;\n',
    '/* a /* b */\nc */\nint x;\n',
    '<* doc\nmore *>\nfn void f() {}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('c3', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
