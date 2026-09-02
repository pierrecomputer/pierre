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
  lexer = loadLang('hlsl', '$hlHlsl');
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
  'hlsl: declarations, types, semantics, attributes, and calls',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '#include <common.hlsli>\n#define MAX 4\ncbuffer Params : register(b0) { float4x4 mvp; };\nTexture2D<float4> tex : register(t0);\nstruct VSOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };\n[numthreads(8, 8, 1)]\nvoid csMain(uint3 id : SV_DispatchThreadID) {\n  min16float2 a = min16float2(1.0h, 2);\n  float4 c = tex.Sample(samp, uv).rgba * 0.5f;\n  int16_t n = 3; sampler2D s;\n  if (c.x > MAX || !true) discard;\n  [unroll] for (int i = 0; i < 4; ++i) c += 1;\n}',
      { theme: distinct }
    );
    assert.equal(within(html, '#include'), distinctColor('preproc'));
    assert.equal(within(html, '<common.hlsli>'), distinctColor('string'));
    assert.equal(exact(html, 'MAX'), distinctColor('constant'));
    assert.equal(exact(html, 'cbuffer'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Params'), distinctColor('type'));
    assert.equal(exact(html, 'register'), distinctColor('keyword'));
    assert.equal(exact(html, 'float4x4'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'Texture2D'), distinctColor('type'));
    assert.equal(exact(html, 'float4'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'SV_Position'), distinctColor('variable.special'));
    assert.equal(exact(html, 'TEXCOORD0'), distinctColor('constant'));
    assert.equal(exact(html, 'numthreads'), distinctColor('attribute'));
    assert.equal(exact(html, 'csMain'), distinctColor('function.definition'));
    assert.equal(exact(html, 'uint3'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'min16float2'), distinctColor('type.builtin'));
    assert.equal(exact(html, '1.0h'), distinctColor('number'));
    assert.equal(exact(html, 'Sample'), distinctColor('function.method'));
    assert.equal(exact(html, 'rgba'), distinctColor('property'));
    assert.equal(exact(html, 'int16_t'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'sampler2D'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'discard'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'unroll'), distinctColor('attribute'));
  }
);

void t.test('hlsl: malformed constructs stay total and lossless', () => {
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
    '#include <',
    '[',
    'float4x',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('hlsl: split ranges bound every lookahead', () => {
  const src = 'x// tail\n#include <a.h>\nfloat4 f(float2 v) { return v.xy; }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('hlsl', '$hlHlsl', split).hl, src);
  }
});

void t.test(
  'hlsl: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('hlsl: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('hlsl: multi-line constructs resume line-fed', () => {
  for (const code of [
    'float4 main() { /* open\nstill */ return 0; }\n',
    'struct A {\n  float x : POSITION;\n};\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('hlsl', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
