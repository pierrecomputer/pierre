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
  lexer = loadLang('wgsl', '$hlWgsl');
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

void t.test('wgsl: declarations, attributes, types, and calls', () => {
  const html = checkInvariants(
    lexer.hl,
    'struct VertexOutput { @builtin(position) pos: vec4<f32>, @location(0) color: vec3f };\n@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;\nvar tex: texture_2d<f32>; var samp: sampler;\nconst MAX_LIGHTS: u32 = 4u;\n@vertex\nfn vs_main(@location(0) position: vec3<f32>) -> VertexOutput {\n  var out: VertexOutput;\n  out.pos = mvp * vec4<f32>(position, 1.0);\n  let c = textureSample(tex, samp, vec2f(0.5, 0.5)).xyz;\n  if (c.x > 0x1p2 || c.y < 1e-3f) { discard; }\n  for (var i: i32 = 0i; i < 4; i++) { out.color += c; }\n  return out;\n}',
    { theme: distinct }
  );
  assert.equal(exact(html, 'struct'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'VertexOutput'), distinctColor('type'));
  assert.equal(exact(html, '@builtin'), distinctColor('attribute'));
  assert.equal(exact(html, 'vec4'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'f32'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'vec3f'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'var'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'uniform'), distinctColor('keyword'));
  assert.equal(exact(html, 'mat4x4'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'texture_2d'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'sampler'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'MAX_LIGHTS'), distinctColor('constant'));
  assert.equal(exact(html, '4u'), distinctColor('number'));
  assert.equal(exact(html, '@vertex'), distinctColor('attribute'));
  assert.equal(exact(html, 'fn'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'vs_main'), distinctColor('function.definition'));
  assert.equal(exact(html, '->'), distinctColor('operator'));
  assert.equal(exact(html, 'xyz'), distinctColor('property'));
  assert.equal(exact(html, 'textureSample'), distinctColor('function'));
  assert.equal(exact(html, '0x1p2'), distinctColor('number'));
  assert.equal(exact(html, '1e-3f'), distinctColor('number'));
  assert.equal(exact(html, 'discard'), distinctColor('keyword.control'));
  assert.equal(exact(html, '0i'), distinctColor('number'));
});

void t.test('wgsl: comments nest and there are no strings', () => {
  const html = checkInvariants(
    lexer.hl,
    '// line\n/* a /* nested */ b */\nlet x = "not a string";',
    { theme: distinct }
  );
  assert.equal(within(html, '// line'), distinctColor('comment'));
  assert.equal(
    within(html, '/* a /* nested */ b */'),
    distinctColor('comment')
  );
  assert.equal(exact(html, 'let'), distinctColor('keyword.declaration'));
});

void t.test('wgsl: malformed constructs stay total and lossless', () => {
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
    '@',
    '/* /*',
    'vec',
    'mat4x',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('wgsl: split ranges bound every lookahead', () => {
  const src = 'x// tail\nfn f(a: vec2<f32>) -> f32 { return a.x; }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('wgsl', '$hlWgsl', split).hl, src);
  }
});

void t.test(
  'wgsl: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('wgsl: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('wgsl: multi-line constructs resume line-fed', () => {
  for (const code of [
    'fn f() { /* open\nstill */ return; }\n',
    '/* a /* b\n*/ c */\nfn g() {}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('wgsl', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
