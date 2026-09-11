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
  lexer = loadLang('hlsl', '$hlHlsl');
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('hlsl: preprocessor directive forms', () => {
  assert.deepEqual(
    tokenKinds(
      'hlsl',
      '#include "common.hlsli"\n#define PI 3.14159f\n#pragma pack_matrix(row_major)\n#if 1\n#ifdef FOO\n#endif'
    ),
    [
      ['#include', 'preproc'],
      ['"common.hlsli"', 'string'],
      ['#define', 'preproc'],
      ['PI', 'constant'],
      ['3.14159f', 'number'],
      ['#pragma', 'preproc'],
      ['pack_matrix', 'function'],
      ['(', 'punctuation.bracket'],
      ['row_major', 'keyword'],
      [')', 'punctuation.bracket'],
      ['#if', 'preproc'],
      ['1', 'number'],
      ['#ifdef', 'preproc'],
      ['FOO', 'constant'],
      ['#endif', 'preproc'],
    ]
  );
});

void t.test(
  'hlsl: buffers, registers, semantics, resource types, and storage classes',
  () => {
    const html = distinctHl(
      'cbuffer Params : register(b0) { float4x4 gWorld; float gTime; }; Texture2D gTex : register(t0); SamplerState gSampler : register(s0); RWStructuredBuffer<float> gBuf : register(u0); struct VSInput { float3 pos : POSITION; float2 uv : TEXCOORD0; uint id : SV_VertexID; }; typedef float4 color_t; static const int n = 4; groupshared float cache[64];'
    );
    for (const word of ['cbuffer', 'struct', 'typedef']) {
      assert.equal(
        exactColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const word of ['register', 'static', 'const', 'groupshared']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const type of [
      'Params',
      'Texture2D',
      'SamplerState',
      'RWStructuredBuffer',
      'VSInput',
    ]) {
      assert.equal(exactColor(html, type), distinctColor('type'), type);
    }
    for (const type of [
      'float4x4',
      'float',
      'float3',
      'float2',
      'uint',
      'float4',
      'int',
    ]) {
      assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const semantic of ['POSITION', 'TEXCOORD0']) {
      assert.equal(
        exactColor(html, semantic),
        distinctColor('constant'),
        semantic
      );
    }
    assert.equal(
      exactColor(html, 'SV_VertexID'),
      distinctColor('variable.special')
    );
    for (const name of [
      'b0',
      'gWorld',
      'gTime',
      'gTex',
      't0',
      'gSampler',
      's0',
      'gBuf',
      'u0',
      'pos',
      'uv',
      'id',
      'color_t',
      'n',
      'cache',
    ]) {
      assert.equal(exactColor(html, name), distinctColor('variable'), name);
    }
    assert.equal(exactColor(html, '64'), distinctColor('number'));
  }
);

void t.test(
  'hlsl: numeric suffixes, scalar, vector, matrix, and resource types, and strings',
  () => {
    const html = distinctHl(
      'float f = 1.0f + 1.5e-3 + 0x1F + 1u + 2.0h + 3.0L + .5; bool b = true || false; half h = 1.0h; double d = 1.0L; float2 v2; float3 v3; float4 v4; int2 iv; uint3 uv; bool4 bv; float4x4 m; float3x3 m3; min16float mf; Texture2D t; SamplerState s; Buffer<float> buf; string str = "x";'
    );
    for (const n of [
      '1.0f',
      '1.5e-3',
      '0x1F',
      '1u',
      '2.0h',
      '3.0L',
      '.5',
      '1.0h',
      '1.0L',
    ]) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    for (const b of ['true', 'false']) {
      assert.equal(exactColor(html, b), distinctColor('boolean'), b);
    }
    for (const type of [
      'float',
      'bool',
      'half',
      'double',
      'float2',
      'float3',
      'float4',
      'int2',
      'uint3',
      'bool4',
      'float4x4',
      'float3x3',
      'min16float',
      'string',
    ]) {
      assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const type of ['Texture2D', 'SamplerState', 'Buffer']) {
      assert.equal(exactColor(html, type), distinctColor('type'), type);
    }
    assert.equal(exactColor(html, '"x"'), distinctColor('string'));
  }
);

void t.test(
  'hlsl: attributes, entry points, intrinsics, methods, swizzles, and control flow',
  () => {
    const html = distinctHl(
      '[numthreads(8, 8, 1)]\nvoid CSMain(uint3 id : SV_DispatchThreadID) { for (int i = 0; i < 4; ++i) { if (a && b || !c) break; else continue; } while (x) {} do {} while (y); switch (k) { case 1: break; default: return; } discard; clip(x); float4 c = gTex.Sample(gSampler, uv) * float4(1, 0, 0, 1); c.xyz = c.rgb; float l = saturate(dot(normalize(n), l)) + mul(v, m) + lerp(a, b, 0.5) + sin(t) + pow(x, 2) + max(a, b) + min(a, b) + abs(x) + sqrt(x) + frac(x) + step(a, b) + smoothstep(0, 1, x) + length(v) + rsqrt(x); a = b ? c : d; }'
    );
    assert.equal(exactColor(html, 'numthreads'), distinctColor('attribute'));
    assert.equal(
      exactColor(html, 'CSMain'),
      distinctColor('function.definition')
    );
    assert.equal(
      exactColor(html, 'SV_DispatchThreadID'),
      distinctColor('variable.special')
    );
    for (const word of [
      'for',
      'if',
      'break',
      'else',
      'continue',
      'while',
      'do',
      'switch',
      'case',
      'default',
      'return',
      'discard',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const fn of [
      'clip',
      'saturate',
      'dot',
      'normalize',
      'mul',
      'lerp',
      'sin',
      'pow',
      'max',
      'min',
      'abs',
      'sqrt',
      'frac',
      'step',
      'smoothstep',
      'length',
      'rsqrt',
    ]) {
      assert.equal(exactColor(html, fn), distinctColor('function'), fn);
    }
    assert.equal(exactColor(html, 'Sample'), distinctColor('function.method'));
    for (const swizzle of ['xyz', 'rgb']) {
      assert.equal(
        exactColor(html, swizzle),
        distinctColor('property'),
        swizzle
      );
    }
    assert.equal(exactColor(html, 'float4'), distinctColor('type.builtin'));
    for (const op of ['++', '&&', '||', '!', '*', '?']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('hlsl: comment forms including doc comments', () => {
  assert.deepEqual(
    tokenKinds('hlsl', '// line\n/* block\n */\n/// doc\nvoid f() {} // tail'),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['/// doc', 'comment.doc'],
      ['void', 'type.builtin'],
      ['f', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'hlsl: preprocessor lines, attributes, and comments stream line-fed',
  () => {
    assertLineFedParity(
      'hlsl',
      '#include "common.hlsli"\n#define PI 3.14159f\n/* block\n */\n/// doc\n[numthreads(8, 8, 1)]\nvoid CSMain(uint3 id : SV_DispatchThreadID) {\n  gBuf[id.x] = float4(1, 0, 0, 1);\n} // tail\n'
    );
  }
);
