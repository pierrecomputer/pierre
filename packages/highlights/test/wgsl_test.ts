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
  lexer = loadLang('wgsl', '$hlWgsl');
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'wgsl: directives, aliases, structs, address spaces, and module-scope declarations',
  () => {
    const html = distinctHl(
      'enable f16;\nrequires readonly_and_readwrite_storage_textures;\ndiagnostic(off, derivative_uniformity);\nalias Vec = vec3<f32>;\nstruct Uniforms { mvp: mat4x4<f32>, @size(16) time: f32, @align(8) pad: u32, }\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@group(0) @binding(1) var tex: texture_2d<f32>;\n@group(0) @binding(2) var samp: sampler;\n@group(1) @binding(0) var<storage, read_write> buf: array<f32>;\nvar<workgroup> shared_data: array<u32, 64>;\nvar<private> counter: i32 = 0;\nconst PI: f32 = 3.14159;\noverride scale: f32 = 1.0;\nlet x = 1;'
    );
    for (const word of [
      'enable',
      'requires',
      'diagnostic',
      'alias',
      'struct',
      'var',
      'const',
      'override',
      'let',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const word of [
      'uniform',
      'storage',
      'read_write',
      'workgroup',
      'private',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const type of [
      'f16',
      'vec3',
      'f32',
      'mat4x4',
      'u32',
      'texture_2d',
      'sampler',
      'array',
      'i32',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const type of ['Vec', 'Uniforms']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const attr of ['@size', '@align', '@group', '@binding']) {
      assert.equal(wordColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const name of [
      'mvp',
      'time',
      'pad',
      'u',
      'tex',
      'samp',
      'buf',
      'shared_data',
      'counter',
      'scale',
      'x',
    ]) {
      assert.equal(wordColor(html, name), distinctColor('variable'), name);
    }
    assert.equal(wordColor(html, 'PI'), distinctColor('constant'));
    for (const n of ['16', '8', '64', '3.14159', '1.0']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
  }
);

void t.test(
  'wgsl: numeric suffixes, constructors, pointers, atomics, and texture types',
  () => {
    const html = distinctHl(
      'let a = 0x1Fu + 1i + 2u + 3.0f + 4.5h + 1e3 + 1_000 + 0b1010;\nlet b = true && false || !true;\nlet v = vec4<f32>(1.0, 2.0, 3.0, 4.0);\nlet m = mat2x2<f32>(1.0, 0.0, 0.0, 1.0);\nlet arr = array<i32, 3>(1, 2, 3);\nlet p: ptr<function, i32> = &x;\nlet at = atomic<u32>();\nlet t: texture_storage_2d<rgba8unorm, write>;\nlet bvec = vec3<bool>(true);\nlet f16v = vec2<f16>(1.0h);'
    );
    for (const n of [
      '0x1Fu',
      '1i',
      '2u',
      '3.0f',
      '4.5h',
      '1e3',
      '1_000',
      '0b1010',
      '1.0h',
    ]) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    for (const b of ['true', 'false']) {
      assert.equal(wordColor(html, b), distinctColor('boolean'), b);
    }
    for (const type of [
      'vec4',
      'f32',
      'mat2x2',
      'array',
      'i32',
      'ptr',
      'atomic',
      'u32',
      'texture_storage_2d',
      'vec3',
      'bool',
      'vec2',
      'f16',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const word of ['function', 'write']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const op of ['&&', '||', '!', '&', '<', '>']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test(
  'wgsl: entry points, attribute arguments, control flow, builtins, and conversions',
  () => {
    const html = distinctHl(
      '@vertex\nfn vs_main(@location(0) in_pos: vec3<f32>, @builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> { return vec4<f32>(in_pos, 1.0); }\n@fragment\nfn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { if (uv.x > 0.5 && uv.y < 0.5 || !flag) { discard; } else if (idx == 1u) { return vec4(0.0); } else { } for (var i = 0; i < 4; i++) { if (i == 2) { continue; } break; } loop { continue; break; continuing { i = i + 1; } } while (x) { } switch (k) { case 1, 2: { } case 3: { } default: { } } var y: f32 = textureSample(tex, samp, uv).x; let n = normalize(cross(a, b)); let c = clamp(mix(a, b, 0.5), 0.0, 1.0); let s = sin(t) + select(a, b, c) + any(bv) + all(bv) + arrayLength(&buf) + atomicAdd(&at, 1u) + f32(idx) + u32(1) + workgroupBarrier(); x <<= 1u; x |= y; a = ~b; let r = *p; y = -y; }\n@compute @workgroup_size(8, 8, 1)\nfn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) { _ = gid; }'
    );
    for (const attr of [
      '@vertex',
      '@fragment',
      '@compute',
      '@workgroup_size',
      '@location',
      '@builtin',
    ]) {
      assert.equal(wordColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const fn of ['vs_main', 'fs_main', 'cs_main']) {
      assert.equal(
        wordColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const word of [
      'return',
      'if',
      'else',
      'discard',
      'for',
      'continue',
      'break',
      'loop',
      'continuing',
      'while',
      'switch',
      'case',
      'default',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const fn of [
      'textureSample',
      'normalize',
      'cross',
      'clamp',
      'mix',
      'sin',
      'select',
      'any',
      'all',
      'arrayLength',
      'atomicAdd',
      'workgroupBarrier',
    ]) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const name of [
      'vertex_index',
      'position',
      'global_invocation_id',
      'in_pos',
      'idx',
      'gid',
      '_',
    ]) {
      assert.equal(wordColor(html, name), distinctColor('variable'), name);
    }
    // conversions are the builtin type names used as calls
    for (const type of ['f32', 'u32', 'vec4', 'vec3', 'vec2']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const op of [
      '->',
      '&&',
      '||',
      '!',
      '==',
      '++',
      '<<=',
      '|=',
      '~',
      '*',
      '-',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('wgsl: nested block comments', () => {
  assert.deepEqual(
    tokenKinds(
      'wgsl',
      '// line\n/* block\n /* nested */ */\nfn f() {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['/* nested */ */', 'comment'],
      ['fn', 'keyword.declaration'],
      ['f', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'wgsl: attributes, nested comments, and bodies stream line-fed',
  () => {
    assertLineFedParity(
      'wgsl',
      '/* block\n /* nested */ */\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@vertex\nfn vs_main(\n  @location(0) in_pos: vec3<f32>,\n) -> @builtin(position) vec4<f32> {\n  return vec4<f32>(in_pos, 1.0);\n}\n'
    );
  }
);
