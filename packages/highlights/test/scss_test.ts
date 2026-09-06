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
  lexer = loadLang('scss', '$hlScss');
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
  'scss: variables, mixins, functions, placeholders, control, and interpolation',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '@use "sass:math";\n// line\n$primary: #333 !default;\n$map: (key: 1px);\n%placeholder { color: red; }\n@mixin theme($color: $primary) { color: $color; }\n@function double($n) { @return $n * 2; }\n.card {\n  @include theme(blue);\n  @extend %placeholder;\n  &-title { font-size: math.div(10px, 2); }\n  &:hover { width: calc(100% - #{$gap}); }\n  @if $primary == red { margin: 0 } @else { margin: 1px }\n  @each $k, $v in $map { .#{$k} { top: $v; } }\n  @for $i from 1 through 3 { .m-#{$i} { margin: $i * 4px; } }\n}',
      { theme: distinct }
    );
    assert.equal(exact(html, '@use'), distinctColor('keyword'));
    assert.equal(within(html, '// line'), distinctColor('comment'));
    assert.equal(exact(html, '$primary'), distinctColor('variable'));
    assert.equal(exact(html, '!default'), distinctColor('keyword'));
    assert.equal(exact(html, '$map'), distinctColor('variable'));
    assert.equal(exact(html, 'key'), distinctColor('constant.builtin'));
    assert.equal(exact(html, '%placeholder'), distinctColor('selector.class'));
    assert.equal(exact(html, '@mixin'), distinctColor('keyword'));
    assert.equal(exact(html, 'theme'), distinctColor('function'));
    assert.equal(exact(html, '$color'), distinctColor('variable'));
    assert.equal(exact(html, '@function'), distinctColor('keyword'));
    assert.equal(exact(html, 'double'), distinctColor('function'));
    assert.equal(exact(html, '@return'), distinctColor('keyword'));
    assert.equal(exact(html, '.card'), distinctColor('selector.class'));
    assert.equal(exact(html, '@include'), distinctColor('keyword'));
    assert.equal(exact(html, 'blue'), distinctColor('constant.builtin'));
    assert.equal(exact(html, '@extend'), distinctColor('keyword'));
    assert.equal(exact(html, '&-title'), distinctColor('selector.class'));
    assert.equal(exact(html, 'font-size'), distinctColor('property'));
    assert.equal(exact(html, 'div'), distinctColor('function'));
    assert.equal(exact(html, ':hover'), distinctColor('selector.pseudo'));
    assert.equal(exact(html, 'width'), distinctColor('property'));
    assert.equal(exact(html, 'calc'), distinctColor('function'));
    assert.equal(exact(html, '#{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, '$gap'), distinctColor('variable'));
    assert.equal(exact(html, '@if'), distinctColor('keyword'));
    assert.equal(exact(html, 'in'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'from'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'through'), distinctColor('keyword.operator'));
    assert.equal(exact(html, '.m-'), distinctColor('selector.class'));
  }
);

void t.test('scss: malformed constructs stay total and lossless', () => {
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
    '#{',
    '$',
    '@include',
    '%',
    '@if',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('scss: split ranges bound every lookahead', () => {
  const src = 'a { // c\n  w: #{$x}; .b-#{$y} { c: 1 } }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('scss', '$hlScss', split).hl, src);
  }
});

void t.test(
  'scss: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('scss: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('scss: multi-line constructs resume line-fed', () => {
  for (const code of [
    '.a {\n  color: red; /* note\nspans lines */\n  .b { c: #{$d}; }\n}\n',
    '@mixin m {\n  // one\n  b: 1\n}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('scss', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('scss: module rules, mixins, control directives, and flags', () => {
  const html = distinctHl(
    '@use "sass:math" as m;\n@forward "x" show y;\n$map: (a: 1, b: 2) !default;\n@mixin mixin($a, $b: 2) { width: $a; }\n@mixin m2($args...) { @content; }\n.a { @include mixin(1, $b: 2); @include m2 { x: 1 } @extend %ph; color: map-get($map, a); width: m.div(10px, 2); @if $a == 1 { x: 1 } @else if $a == 2 { x: 2 } @else { x: 3 } @each $k, $v in $map { .#{$k} { y: $v } } @for $i from 1 through 3 { z: $i } @while $i > 0 { w: $i } @debug "x"; @warn "w"; @error "e"; @at-root .b { q: 1 } &__elem { r: 1 } &:hover { s: 1 } #{$prop}-top: 1px; $local: 1 !global; }\n@function f($x) { @return $x * 2; }\n%ph { t: 1 }'
  );
  for (const word of [
    '@use',
    '@forward',
    '@mixin',
    '@content',
    '@include',
    '@extend',
    '@if',
    '@else',
    '@each',
    '@for',
    '@while',
    '@debug',
    '@warn',
    '@error',
    '@at-root',
    '@function',
    '@return',
    '!default',
    '!global',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('keyword'), word);
  }
  for (const s of ['"sass:math"', '"x"', '"w"', '"e"']) {
    assert.equal(exactColor(html, s), distinctColor('string'), s);
  }
  for (const v of [
    '$map',
    '$a',
    '$b',
    '$args',
    '$k',
    '$v',
    '$i',
    '$x',
    '$prop',
    '$local',
  ]) {
    assert.equal(wordColor(html, v), distinctColor('variable'), v);
  }
  for (const fn of ['mixin', 'm2', 'map-get', 'div', 'f']) {
    assert.equal(wordColor(html, fn), distinctColor('function'), fn);
  }
  for (const c of ['.a', '%ph', '&__elem']) {
    assert.equal(wordColor(html, c), distinctColor('selector.class'), c);
  }
  assert.equal(exactColor(html, ':hover'), distinctColor('selector.pseudo'));
  for (const p of [
    'width',
    'color',
    'x',
    'z',
    'w',
    'q',
    'r',
    's',
    't',
    '-top',
  ]) {
    assert.equal(wordColor(html, p), distinctColor('property'), p);
  }
  for (const word of ['in', 'from', 'through', 'if']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.operator'),
      word
    );
  }
  for (const op of ['==', '>', '*', '&']) {
    assert.equal(wordColor(html, op), distinctColor('operator'), op);
  }
  assert.equal(exactColor(html, '#{'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '10px'), distinctColor('number'));
});

void t.test('scss: arithmetic, comparison, and interpolation operators', () => {
  const html = distinctHl(
    '.d { a: $x + $y; b: $x - $y; c: $x * $y; d: $x / $y; f: $x == $y; g: $x != $y; k: -$x; m: $x < $y; n: #{$x}px; o: "#{$x}"; }'
  );
  for (const op of ['+', '-', '*', '/', '==', '!=', '<']) {
    assert.equal(wordColor(html, op), distinctColor('operator'), op);
  }
  assert.equal(exactColor(html, '#{'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '"#{$x}"'), distinctColor('string'));
  assert.equal(exactColor(html, 'px'), distinctColor('constant.builtin'));
});

void t.test('scss: comment forms', () => {
  assert.deepEqual(
    tokenKinds('scss', '// line\n/* block */\n.a { b: 1; // tail\n}'),
    [
      ['// line', 'comment'],
      ['/* block */', 'comment'],
      ['.a', 'selector.class'],
      ['{', 'punctuation.bracket'],
      ['b', 'property'],
      [':', 'punctuation.delimiter'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
      ['// tail', 'comment'],
      ['}', 'punctuation.bracket'],
    ]
  );
});

void t.test(
  'scss: nested rules, interpolation, and block comments stream line-fed',
  () => {
    assertLineFedParity(
      'scss',
      '/* a\n b */\n.x {\n  .y {\n    c: #{$d};\n  }\n  &:hover {\n    e: 1;\n  }\n}\n'
    );
  }
);
