import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor as exactColorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let glsl: TestLang;

t.before(() => {
  glsl = loadLang('glsl', '$hlGlsl');
  const url = new URL('../src/highlights.wat', import.meta.url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, transformWat(url).code)));
});

/**
 * Tokens from the full module for a whole-buffer run and for a stream fed
 * one line per chunk, the shape the live tokenizer uses; both must agree.
 */
function lineFed(code: string): {
  direct: ThemedToken[][];
  streamed: ThemedToken[][];
} {
  const options = { lang: 'glsl' as const, theme: pierreDark };
  const direct = codeToTokens(code, options).tokens;
  const stream = new StreamTokenizer(options);
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return { direct, streamed };
}

const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const KEYWORD = themeColor('keyword');
const TYPE = themeColor('type.builtin');
const SPECIAL = themeColor('variable.special');
const CONSTANT = themeColor('constant');
const FUNCTION = themeColor('function');
const OPERATOR = themeColor('operator');
const PUNCT = themeColor('punctuation.bracket');

const exactColor = (html: string, text: string) =>
  spansOf(html).find((span) => span.text.trim() === text)?.color;

void t.test('glsl: representative shader constructs', () => {
  const html = checkInvariants(
    glsl.hl,
    `#version 460 core
layout(location = 0) in vec3 position;
layout(set = 0, binding = 0) uniform sampler2D tex;
rayPayloadEXT vec4 payload;
struct Light { vec3 color; };
void main() {
  vec2 uv = position.xy;
  vec4 sampled = texture(tex, uv);
  gl_Position = sampled;
  if (sampled.x > 0.0) discard;
}`
  );

  assert.equal(colorOf(html, '#version'), PREPROC);
  assert.equal(exactColor(html, 'layout'), KEYWORD);
  assert.equal(exactColor(html, 'in'), KEYWORD);
  assert.equal(exactColor(html, 'uniform'), KEYWORD);
  assert.equal(exactColor(html, 'rayPayloadEXT'), KEYWORD);
  for (const type of ['vec2', 'vec3', 'vec4', 'sampler2D', 'void']) {
    assert.equal(exactColor(html, type), TYPE, type);
  }
  assert.equal(exactColor(html, 'struct'), KEYWORD);
  assert.equal(exactColor(html, 'Light'), TYPE);
  assert.equal(exactColor(html, 'main'), FUNCTION);
  assert.equal(exactColor(html, 'texture'), FUNCTION);
  assert.equal(exactColor(html, 'gl_Position'), SPECIAL);
  assert.equal(exactColor(html, 'if'), KEYWORD);
  assert.equal(exactColor(html, 'discard'), KEYWORD);
  assert.equal(exactColor(html, '0.0'), NUMBER);
});

void t.test('glsl: comments and Doxygen comments', () => {
  const theme = {
    name: 'glsl-comments',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { comment: '#112233', 'comment.doc': '#445566' },
    },
  };
  const html = checkInvariants(
    glsl.hl,
    '// line\n/// doc line\n/* block */\n/*! doc block */',
    { theme }
  );
  assert.equal(colorOf(html, '// line'), '#112233');
  assert.equal(colorOf(html, '/// doc line'), '#445566');
  assert.equal(colorOf(html, '/* block */'), '#112233');
  assert.equal(colorOf(html, '/*! doc block */'), '#445566');
});

void t.test('glsl: preprocessor paths and quoted strings with escapes', () => {
  const html = checkInvariants(
    glsl.hl,
    String.raw`#include <lighting/common.glsl>
#define MESSAGE "a\n\"b"
#define CH 'x\t'`
  );
  assert.equal(colorOf(html, '#include'), PREPROC);
  assert.equal(colorOf(html, '<lighting/common.glsl>'), STRING);
  assert.equal(colorOf(html, '#define'), PREPROC);
  assert.equal(exactColor(html, 'MESSAGE'), CONSTANT);
  assert.equal(colorOf(html, '"a'), STRING);
  assert.equal(colorOf(html, '\\n'), ESCAPE);
  assert.equal(colorOf(html, '\\"'), ESCAPE);
  assert.equal(colorOf(html, "'x"), STRING);
  assert.equal(colorOf(html, '\\t'), ESCAPE);
});

void t.test('glsl: numeric, vector, matrix, scalar and opaque forms', () => {
  const html = checkInvariants(
    glsl.hl,
    'float a=.5; double b=1.0e-2LF; uint c=42u; int d=0x1.fp2; uint e=0b1010u; ' +
      'bvec4 bv; ivec2 iv; uvec3 uv; dvec4 dv; mat3x4 m; dmat2x3 dm; ' +
      'image2D img; usamplerCube smp; atomic_uint counter; float16_t halfValue;'
  );
  for (const number of ['.5', '1.0e-2LF', '42u', '0x1.fp2', '0b1010u']) {
    assert.equal(exactColor(html, number), NUMBER, number);
  }
  for (const type of [
    'float',
    'double',
    'uint',
    'int',
    'bvec4',
    'ivec2',
    'uvec3',
    'dvec4',
    'mat3x4',
    'dmat2x3',
    'image2D',
    'usamplerCube',
    'atomic_uint',
    'float16_t',
  ]) {
    assert.equal(exactColor(html, type), TYPE, type);
  }
});

void t.test(
  'glsl: identifiers, methods, properties and constant-case names',
  () => {
    const theme = {
      name: 'glsl-identifiers',
      appearance: 'dark',
      style: {
        background: '#000000',
        foreground: '#ffffff',
        syntax: {
          variable: '#110001',
          'variable.special': '#220002',
          property: '#330003',
          constant: '#440004',
          function: '#550005',
          'function.method': '#660006',
          type: '#770007',
        },
      },
    };
    const html = checkInvariants(
      glsl.hl,
      'Thing value; value.rgb; object.fetch(uv); helper (value); gl_FragCoord; MAX_LIGHTS;',
      { theme }
    );
    assert.equal(exactColor(html, 'Thing'), '#770007');
    assert.equal(exactColor(html, 'value'), '#110001');
    assert.equal(exactColor(html, 'rgb'), '#330003');
    assert.equal(exactColor(html, 'fetch'), '#660006');
    assert.equal(exactColor(html, 'helper'), '#550005');
    assert.equal(exactColor(html, 'gl_FragCoord'), '#220002');
    assert.equal(exactColor(html, 'MAX_LIGHTS'), '#440004');
  }
);

void t.test('glsl: operators and punctuation', () => {
  const html = checkInvariants(
    glsl.hl,
    'a <<= 2; b = (a++ >= 1 && c != 0) ? a.b : x[0];'
  );
  for (const op of ['<<=', '=', '++', '>=', '&&', '!=', '?']) {
    assert.equal(colorOf(html, op), OPERATOR, op);
  }
  for (const punct of [';', '(', ')', '.', '[', ']']) {
    assert.equal(colorOf(html, punct), PUNCT, punct);
  }
});

void t.test('glsl: malformed constructs remain total and lossless', () => {
  for (const source of [
    '',
    '/',
    '//',
    '/*',
    '/**',
    '#',
    '#include <unterminated',
    '"unterminated',
    '"escape at end \\',
    "'unterminated",
    '0x',
    '0b2',
    '1e+',
    'struct {',
    'é变量',
    '\u0000\u0001\u007f',
    '<&>',
  ]) {
    checkInvariants(glsl.hl, source);
  }
});

void t.test('glsl: split scan ranges clamp every lookahead', () => {
  const source = '/** doc */ #include <x>\n"a\\n" 0x1.fp2 foo.bar()';
  for (const split of [1, 2, 3, 10, 12, 20, 25, 29, 35, source.length - 1]) {
    const ranged = loadLang('glsl', '$hlGlsl', split);
    checkInvariants(ranged.hl, source);
  }
});

void t.test('glsl: long comments and strings exercise long-run paths', () => {
  const source = `/*${'comment '.repeat(80)}*/\n#define S "${'shader'.repeat(120)}\\n"`;
  const html = checkInvariants(glsl.hl, source);
  assert.equal(colorOf(html, 'comment comment'), COMMENT);
  assert.equal(colorOf(html, 'shadershader'), STRING);
});

void t.test('glsl: a lone capital letter is a type, not a constant', () => {
  const html = checkInvariants(glsl.hl, 'T max(T a, T b);');
  assert.equal(exactColor(html, 'T'), themeColor('type'));
  assert.equal(exactColor(html, 'max'), FUNCTION);
});

void t.test('glsl: escaped line breaks inside literals resume line-fed', () => {
  const html = checkInvariants(glsl.hl, 's = "abc\\\r\ndef";');
  assert.equal(colorOf(html, 'def"'), STRING);
  for (const code of [
    's = "abc\\\ndef";\nint z = 1;\n',
    's = "abc\\\r\ndef";\r\nint z = 1;\r\n',
  ]) {
    const { direct, streamed } = lineFed(code);
    assert.deepEqual(streamed, direct, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(glsl.hl, src, { theme: distinctTheme });

void t.test('glsl: preprocessor directive forms', () => {
  assert.deepEqual(
    tokenKinds(
      'glsl',
      '#version 450 core\n#define PI 3.14\n#endif\n#pragma optimize(on)'
    ),
    [
      ['#version', 'preproc'],
      ['450', 'number'],
      ['core', 'variable'],
      ['#define', 'preproc'],
      ['PI', 'constant'],
      ['3.14', 'number'],
      ['#endif', 'preproc'],
      ['#pragma', 'preproc'],
      ['optimize', 'function'],
      ['(', 'punctuation.bracket'],
      ['on', 'variable'],
      [')', 'punctuation.bracket'],
    ]
  );
});

void t.test(
  'glsl: layout, storage, precision, and interface block qualifiers',
  () => {
    const html = distinctHl(
      'layout(location = 0, binding = 1) in vec3 aPos; layout(std140) uniform Block { mat4 mvp; }; uniform sampler2D tex; out vec4 fragColor; in flat int id; precision mediump float; const float k = 1.0; buffer SSBO { float data[]; }; shared int s; struct Light { vec3 pos; float intensity; };'
    );
    for (const word of [
      'layout',
      'in',
      'uniform',
      'out',
      'flat',
      'precision',
      'mediump',
      'const',
      'buffer',
      'shared',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    assert.equal(
      exactColorOf(html, 'struct'),
      distinctColor('keyword.declaration')
    );
    for (const type of ['vec3', 'mat4', 'sampler2D', 'vec4', 'int', 'float']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const type of ['Block', 'Light']) {
      assert.equal(exactColorOf(html, type), distinctColor('type'), type);
    }
    for (const name of [
      'location',
      'binding',
      'aPos',
      'std140',
      'mvp',
      'tex',
      'fragColor',
      'id',
      'k',
      'data',
      's',
      'pos',
      'intensity',
    ]) {
      assert.equal(exactColorOf(html, name), distinctColor('variable'), name);
    }
    assert.equal(exactColorOf(html, 'SSBO'), distinctColor('constant'));
  }
);

void t.test(
  'glsl: numeric suffixes and every scalar, vector, matrix, and opaque type',
  () => {
    const html = distinctHl(
      'float f = 1.0 + 1.5e-3 + 0x1F + 1u + 2.0f + 3.0lf + .5 + 1e3; bool b = true || false; int i = 0; uint u = 1u; double d = 1.0lf; vec2 v2; vec3 v3; vec4 v4; ivec2 iv; uvec3 uv; bvec4 bv; dvec2 dv; mat2 m2; mat3x4 m34; sampler2D s; samplerCube sc; image2D img; atomic_uint ac; void;'
    );
    for (const n of [
      '1.0',
      '1.5e-3',
      '0x1F',
      '1u',
      '2.0f',
      '3.0lf',
      '.5',
      '1e3',
      '1.0lf',
    ]) {
      assert.equal(exactColorOf(html, n), distinctColor('number'), n);
    }
    for (const b of ['true', 'false']) {
      assert.equal(exactColorOf(html, b), distinctColor('boolean'), b);
    }
    for (const type of [
      'float',
      'bool',
      'int',
      'uint',
      'double',
      'vec2',
      'vec3',
      'vec4',
      'ivec2',
      'uvec3',
      'bvec4',
      'dvec2',
      'mat2',
      'mat3x4',
      'sampler2D',
      'samplerCube',
      'image2D',
      'atomic_uint',
      'void',
    ]) {
      assert.equal(
        exactColorOf(html, type),
        distinctColor('type.builtin'),
        type
      );
    }
  }
);

void t.test(
  'glsl: control flow, builtin functions, swizzles, gl_ builtins, and operators',
  () => {
    const html = distinctHl(
      'void main() { for (int i = 0; i < 4; ++i) { if (a && b || !c) break; else continue; } while (x) {} do {} while (y); switch (k) { case 1: break; default: return; } discard; vec4 p = texture(tex, uv) * vec4(aPos, 1.0); float l = max(dot(normalize(n), light), 0.0); p.xyz = p.rgb; gl_Position = p; gl_FragColor = vec4(1); fragColor = mix(a, b, 0.5); float s = sin(t) + cos(t) + pow(x, 2.0) + sqrt(x) + clamp(x, 0.0, 1.0) + length(v) + abs(x) + floor(x) + fract(x) + step(0.5, x) + smoothstep(0.0, 1.0, x); a = b ? c : d; x <<= 1; x ^= y; x %= 3; }'
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
      'main',
      'texture',
      'max',
      'dot',
      'normalize',
      'mix',
      'sin',
      'cos',
      'pow',
      'sqrt',
      'clamp',
      'length',
      'abs',
      'floor',
      'fract',
      'step',
      'smoothstep',
    ]) {
      assert.equal(exactColorOf(html, fn), distinctColor('function'), fn);
    }
    for (const builtin of ['gl_Position', 'gl_FragColor']) {
      assert.equal(
        exactColorOf(html, builtin),
        distinctColor('variable.special'),
        builtin
      );
    }
    for (const swizzle of ['xyz', 'rgb']) {
      assert.equal(
        exactColorOf(html, swizzle),
        distinctColor('property'),
        swizzle
      );
    }
    assert.equal(exactColorOf(html, 'vec4'), distinctColor('type.builtin'));
    for (const op of ['++', '&&', '||', '!', '*', '?', '<<=', '^=', '%=']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('glsl: comment forms', () => {
  assert.deepEqual(
    tokenKinds('glsl', '// line\n/* block\n */\nvoid f() {} // tail'),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['void', 'type.builtin'],
      ['f', 'function'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'glsl: preprocessor lines, block comments, and bodies stream line-fed',
  () => {
    assertLineFedParity(
      'glsl',
      '#version 450 core\n#define PI 3.14\n/* block\n */\nlayout(location = 0) in vec3 aPos;\nvoid main() {\n  gl_Position = vec4(aPos, 1.0);\n} // tail\n'
    );
  }
);
