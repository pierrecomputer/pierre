import { expect, test } from 'bun:test';

import { codeToTokens, LiveTokenizer, StreamTokenizer } from '../lib/index';
import { samples } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  tokenKinds,
} from './_util';

test('shaderlab: blocks, properties, attributes, and render state', () => {
  expect(
    tokenKinds(
      'shaderlab',
      '[HideInInspector][Toggle(_FOG)] _Fog ("Fog", 2D) = "white" {}\nCull [_Cull] ZTest LEqual'
    )
  ).toEqual([
    ['[', 'punctuation.bracket'],
    ['HideInInspector', 'attribute'],
    ['][', 'punctuation.bracket'],
    ['Toggle', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['_FOG', 'constant'],
    [')]', 'punctuation.bracket'],
    ['_Fog', 'property'],
    ['(', 'punctuation.bracket'],
    ['"Fog"', 'string'],
    [',', 'punctuation.delimiter'],
    ['2D', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['"white"', 'string'],
    ['{}', 'punctuation.bracket'],
    ['Cull', 'keyword'],
    ['[', 'punctuation.bracket'],
    ['_Cull', 'variable'],
    [']', 'punctuation.bracket'],
    ['ZTest', 'keyword'],
    ['LEqual', 'constant.builtin'],
  ]);
  // ShaderLab ignores case; `OneMinus` blend factors and channel masks
  expect(
    tokenKinds(
      'shaderlab',
      'SUBSHADER { blend oneminussrcalpha OneMinusDstColor\nColorMask RGBA\nFailBack Keep }'
    )
  ).toEqual([
    ['SUBSHADER', 'keyword.declaration'],
    ['{', 'punctuation.bracket'],
    ['blend', 'keyword'],
    ['oneminussrcalpha OneMinusDstColor', 'constant.builtin'],
    ['ColorMask', 'keyword'],
    ['RGBA', 'constant.builtin'],
    ['FailBack', 'keyword'],
    ['Keep', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
  ]);
  const tokens = tokenKinds('shaderlab', samples.shaderlab.code);
  for (const [text, kind] of [
    ['Shader', 'keyword.declaration'],
    ['Fallback', 'keyword.declaration'],
    ['LOD', 'keyword'],
    ['Range', 'type.builtin'],
    ['HDR', 'attribute'],
    ['CGPROGRAM', 'keyword'],
    ['ENDCG', 'keyword'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('shaderlab: CG and HLSL bodies use the HLSL lexer, GLSL bodies the GLSL lexer', () => {
  expect(
    tokenKinds(
      'shaderlab',
      'Pass {\nCGPROGRAM\nfloat4 frag() : SV_Target { return 1; }\nENDCG\n}'
    )
  ).toEqual([
    ['Pass', 'keyword.declaration'],
    ['{', 'punctuation.bracket'],
    ['CGPROGRAM', 'keyword'],
    ['float4', 'type.builtin'],
    ['frag', 'function.definition'],
    ['()', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['SV_Target', 'variable.special'],
    ['{', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['ENDCG', 'keyword'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('shaderlab', 'HLSLINCLUDE half4 c; ENDHLSL Pass')).toEqual([
    ['HLSLINCLUDE', 'keyword'],
    ['half4', 'type.builtin'],
    ['c', 'variable'],
    [';', 'punctuation.delimiter'],
    ['ENDHLSL', 'keyword'],
    ['Pass', 'keyword.declaration'],
  ]);
  expect(
    tokenKinds('shaderlab', 'GLSLPROGRAM\nuniform vec4 c;\nENDGLSL')
  ).toEqual([
    ['GLSLPROGRAM', 'keyword'],
    ['uniform', 'keyword'],
    ['vec4', 'type.builtin'],
    ['c', 'variable'],
    [';', 'punctuation.delimiter'],
    ['ENDGLSL', 'keyword'],
  ]);
  // a closer inside a body comment still ends it; a longer word does not
  expect(
    tokenKinds('shaderlab', 'CGPROGRAM /* ENDCG_X x ENDCG */ Pass')
  ).toEqual([
    ['CGPROGRAM', 'keyword'],
    ['/* ENDCG_X x', 'comment'],
    ['ENDCG', 'keyword'],
    ['*/', 'operator'],
    ['Pass', 'keyword.declaration'],
  ]);
});

test('shaderlab: open bodies and comments resume across chunks', () => {
  for (const code of [
    'CGPROGRAM\n/* open\nENDCG\n*/ int x;\nENDCG\nPass {}\n',
    'CGPROGRAM\nfloat4 a = "s\\\nt";\nENDCG Cull Off\n',
    'GLSLPROGRAM\n/* a\nb */ void main() {}\nENDGLSL\n// done\n',
    'HLSLPROGRAM\n#pragma vertex v\nfloat4 v() : SV_Position;\n',
    '/* ShaderLab\n comment */ Shader "x" {}\n',
    samples.shaderlab.code,
  ]) {
    assertLineFedParity('shaderlab', code);
    assertLineFedParity('shaderlab', code.replaceAll('\n', '\r\n'));
  }
});

test('shaderlab: a body edit leaves later live lines matching a fresh run', () => {
  initFullModule();
  const code = samples.shaderlab.code;
  const at = code.indexOf('ENDCG');
  const before = code.slice(0, at).split('\n');
  const live = new LiveTokenizer({
    lang: 'shaderlab',
    theme: distinctTheme,
    code,
  });
  try {
    const position = {
      line: before.length - 1,
      character: before.at(-1)!.length,
    };
    live.applyEdits([
      {
        range: {
          start: position,
          end: { ...position, character: position.character + 5 },
        },
        newText: '',
      },
    ]);
    const edited = code.slice(0, at) + code.slice(at + 5);
    const expected = codeToTokens(edited, {
      lang: 'shaderlab',
      theme: distinctTheme,
    }).tokens;
    const lines = edited.split('\n');
    let offset = 0;
    for (const [line, text] of lines.entries()) {
      expect(live.getLineTokens(line).tokens).toEqual(
        expected[line].map((token) => ({
          ...token,
          offset: token.offset - offset,
        }))
      );
      offset += text.length + 1;
    }
  } finally {
    live.dispose();
  }
  // a pooled stream that ends inside a body does not leak it into the next
  const stream = new StreamTokenizer({
    lang: 'shaderlab',
    theme: distinctTheme,
  });
  stream.pushCode('CGPROGRAM\nint x;\n');
  stream.end();
  expect(tokenKinds('shaderlab', 'Pass {}')).toEqual([
    ['Pass', 'keyword.declaration'],
    ['{}', 'punctuation.bracket'],
  ]);
});
