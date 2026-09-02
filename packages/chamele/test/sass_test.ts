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
  lexer = loadLang('sass', '$hlSass');
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
  'sass: indented statements, variables, mixin lines, and nesting',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '// sass\n$primary: #333\n=theme($c: $primary)\n  color: $c\n.card\n  +theme(blue)\n  &-title\n    font-size: 10px\n  &:hover\n    width: calc(100% - #{$gap})\n  @media (min-width: 768px)\n    display: none',
      { theme: distinct }
    );
    assert.equal(within(html, '// sass'), distinctColor('comment'));
    assert.equal(exact(html, '$primary'), distinctColor('variable'));
    assert.equal(exact(html, '#333'), distinctColor('string.special'));
    assert.equal(exact(html, '='), distinctColor('keyword'));
    assert.equal(exact(html, 'theme'), distinctColor('function'));
    assert.equal(exact(html, '$c'), distinctColor('variable'));
    assert.equal(exact(html, 'color'), distinctColor('property'));
    assert.equal(exact(html, '.card'), distinctColor('selector.class'));
    assert.equal(exact(html, '+'), distinctColor('keyword'));
    assert.equal(exact(html, 'blue'), distinctColor('constant.builtin'));
    assert.equal(exact(html, '&-title'), distinctColor('selector.class'));
    assert.equal(exact(html, 'font-size'), distinctColor('property'));
    assert.equal(exact(html, '10px'), distinctColor('number'));
    assert.equal(exact(html, ':hover'), distinctColor('selector.pseudo'));
    assert.equal(exact(html, 'width'), distinctColor('property'));
    assert.equal(exact(html, 'calc'), distinctColor('function'));
    assert.equal(exact(html, '$gap'), distinctColor('variable'));
    assert.equal(exact(html, '@media'), distinctColor('keyword'));
    assert.equal(exact(html, 'min-width'), distinctColor('property'));
    assert.equal(exact(html, 'display'), distinctColor('property'));
    assert.equal(exact(html, 'none'), distinctColor('constant.builtin'));
  }
);

void t.test('sass: malformed constructs stay total and lossless', () => {
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
    '=',
    '+',
    '#{',
    '$',
    '  a: b',
    '.a\n  b',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('sass: split ranges bound every lookahead', () => {
  const src = '.a // c\n  b: #{$x}\n  =m\n  +n';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('sass', '$hlSass', split).hl, src);
  }
});

void t.test(
  'sass: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('sass: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('sass: multi-line constructs resume line-fed', () => {
  for (const code of [
    '// note\n.a\n  color: red\n  &:hover\n    color: blue\n',
    '.a\n  b: 1 /* open\nstill */\n  c: 2\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('sass', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
