import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('gdscript: declarations, annotations, calls, members, and node paths', () => {
  const tokens = tokenKinds(
    'gdscript',
    `@tool
class_name Player
extends Node2D
signal moved(position: Vector2)
@onready var sprite = $Visual/Sprite2D
func _ready() -> void:
    var target = %Target
    sprite.position = target.position
    moved.emit(position)
    super._ready()
    var remainder = value%divisor
`
  );
  for (const [text, kind] of [
    ['@tool', 'attribute'],
    ['Player', 'type'],
    ['Node2D', 'type'],
    ['moved', 'function.definition'],
    ['@onready', 'attribute'],
    ['$Visual/Sprite2D', 'variable.special'],
    ['_ready', 'function.definition'],
    ['%Target', 'variable.special'],
    ['position', 'property'],
    ['emit', 'function.method'],
    ['super', 'variable.special'],
    ['%', 'operator'],
    ['divisor', 'variable'],
  ])
    expect(tokens).toContainEqual([text, kind]);
});

test('gdscript: keywords, builtin types, and constants', () => {
  for (const word of [
    'if',
    'elif',
    'else',
    'for',
    'while',
    'match',
    'when',
    'await',
    'return',
    'pass',
  ])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'keyword.control']]);
  for (const word of ['and', 'or', 'not', 'in', 'is', 'as'])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'keyword.operator']]);
  for (const word of ['true', 'false'])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'boolean']]);
  for (const word of ['null', 'PI', 'TAU', 'INF', 'NAN'])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'constant.builtin']]);
  for (const word of [
    'bool',
    'int',
    'float',
    'StringName',
    'NodePath',
    'Vector2i',
    'Vector3i',
    'Vector4i',
    'Transform2D',
    'Transform3D',
    'Array',
    'Dictionary',
    'PackedByteArray',
    'PackedInt32Array',
    'PackedInt64Array',
    'PackedFloat32Array',
    'PackedFloat64Array',
    'PackedVector2Array',
    'PackedVector3Array',
    'PackedVector4Array',
    'PackedStringArray',
    'PackedColorArray',
  ])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'type.builtin']]);
  for (const word of ['Vector5i', 'PackedUnknownArray', 'Transform4D'])
    expect(tokenKinds('gdscript', word)).toEqual([[word, 'type']]);
});

test('gdscript: prefixed, raw, triple-quoted, and escaped strings', () => {
  for (const literal of [
    '&"name"',
    '^"Node/Label"',
    '$"Node/Label"',
    '%"Unique Node"',
    'r"\\w+\\\"quoted"',
    "r'\\w+'",
    '"""one\ntwo"""',
    "'''one\ntwo'''",
    'r"""\\w+\n\\d+"""',
  ]) {
    const tokens = tokenKinds('gdscript', literal);
    expect(tokens.every(([, kind]) => kind === 'string')).toBe(true);
    assertLineFedParity('gdscript', `${literal}\nvar after = true\n`);
  }
  const code =
    'var s = "\\u03bb/\\U01F600/\\n"\nvar continued = "one\\\ntwo"\n';
  const tokens = tokenKinds('gdscript', code);
  for (const escape of ['\\u03bb', '\\U01F600', '\\n'])
    expect(tokens).toContainEqual([escape, 'string.escape']);
  assertLineFedParity('gdscript', code);
  expect(tokenKinds('gdscript', '# comment\n## documentation')).toEqual([
    ['# comment', 'comment'],
    ['## documentation', 'comment.doc'],
  ]);
});

test('gdscript: numeric forms and operators', () => {
  for (const number of [
    '0b1010_0011',
    '0xFF_A0',
    '12_345',
    '3.141_592',
    '.5',
    '1.5e-3',
  ])
    expect(tokenKinds('gdscript', number)).toEqual([[number, 'number']]);
  for (const operator of [':=', '**=', '<<=', '>>=', '!=', '&&', '||', '->'])
    expect(tokenKinds('gdscript', operator)).toEqual([[operator, 'operator']]);
});

test('gdshader: directives, hints, modes, and engine builtins', () => {
  for (const word of [
    'shader_type',
    'render_mode',
    'group_uniforms',
    'global',
    'instance',
  ])
    expect(tokenKinds('gdshader', word)).toEqual([[word, 'keyword']]);
  for (const word of ['canvas_item', 'spatial', 'particles', 'sky', 'fog'])
    expect(tokenKinds('gdshader', `shader_type ${word};`)).toEqual([
      [`shader_type ${word}`, 'keyword'],
      [';', 'punctuation.delimiter'],
    ]);
  expect(tokenKinds('gdshader', 'shader_type texture_blit;')).toEqual([
    ['shader_type texture_blit', 'keyword'],
    [';', 'punctuation.delimiter'],
  ]);
  for (const word of [
    'source_color',
    'hint_range',
    'hint_depth_texture',
    'hint_default_white',
    'hint_normal_roughness_texture',
    'filter_linear_mipmap_anisotropic',
    'filter_nearest_mipmap_anisotropic',
  ])
    expect(tokenKinds('gdshader', word)).toEqual([[word, 'attribute']]);
  for (const word of [
    'TIME',
    'UV',
    'COLOR',
    'ALBEDO',
    'VERTEX',
    'NORMAL',
    'MODEL_MATRIX',
  ])
    expect(tokenKinds('gdshader', word)).toEqual([[word, 'variable.special']]);
  for (const word of ['PI', 'TAU', 'E'])
    expect(tokenKinds('gdshader', word)).toEqual([[word, 'constant.builtin']]);
  expect(tokenKinds('gdshader', '#include "res://common.gdshaderinc"')).toEqual(
    [
      ['#include', 'preproc'],
      ['"res://common.gdshaderinc"', 'string'],
    ]
  );
  expect(tokenKinds('glsl', 'shader_type')).toEqual([
    ['shader_type', 'variable'],
  ]);
  expect(tokenKinds('glsl', 'texture_blit')).not.toContainEqual([
    'texture_blit',
    'keyword',
  ]);
  expect(tokenKinds('glsl', 'ALBEDO')).toEqual([['ALBEDO', 'constant']]);
});

test('gdshader: mode names are keywords only inside shader_type and render_mode lists', () => {
  const code = `shader_type sky;
render_mode use_half_res_pass, // half resolution
  depth_prepass_alpha;
void sky() {
  float fog = unshaded;
}
void fog() {}
`;
  const tokens = tokenKinds('gdshader', code);
  for (const [text, kind] of [
    ['shader_type sky', 'keyword'],
    ['render_mode use_half_res_pass', 'keyword'],
    ['depth_prepass_alpha', 'keyword'],
    ['sky', 'function'],
    ['fog', 'variable'],
    ['unshaded', 'variable'],
    ['fog', 'function'],
  ])
    expect(tokens).toContainEqual([text, kind]);
  expect(tokens).not.toContainEqual(['sky', 'keyword']);
  expect(tokens).not.toContainEqual(['fog', 'keyword']);
  assertLineFedParity('gdshader', code);
});

test('gdresource: headers, slash-delimited properties, references, and typed arrays', () => {
  const code = `[gd_resource type="Resource" format=3]
[resource]
metadata/values = Array[Vector3]([Vector3(1, 2, 3)])
script = ExtResource("1_script")
material = SubResource("Material_1")
name = &"player"
enabled = true
optional = null
`;
  const tokens = tokenKinds('gdresource', code);
  for (const [text, kind] of [
    ['gd_resource', 'tag'],
    ['resource', 'tag'],
    ['metadata/values', 'property'],
    ['Array', 'type.builtin'],
    ['Vector3', 'type.builtin'],
    ['ExtResource', 'function'],
    ['SubResource', 'function'],
    ['&"player"', 'string'],
    ['true', 'boolean'],
    ['null', 'constant.builtin'],
  ])
    expect(tokens).toContainEqual([text, kind]);
  assertLineFedParity('gdresource', code);
});

test('gdresource: multiline shader strings preserve comments and escapes', () => {
  const code =
    '[sub_resource type="Shader"]\ncode = "shader_type canvas_item;\n// λ😀 <>&\\n\nvoid fragment() {}"\n; comment\nvalue = 1\n';
  const tokens = tokenKinds('gdresource', code);
  expect(tokens).toContainEqual(['// λ😀 <>&', 'string']);
  expect(tokens).toContainEqual(['; comment', 'comment']);
  expect(tokens).toContainEqual(['value', 'property']);
  assertLineFedParity('gdresource', code);
});

test('gdresource: only line-leading brackets open section headers', () => {
  const code = `[node name="A" type="Node2D"]
colors = [Color(1, 0, 0, 1)]
nested = [1, [2, [3]]]
[node name="B" parent="."]
typed = Array[node]([])
points = [1, 2
[sub_resource type="Curve" id="1"]
`;
  const tokens = tokenKinds('gdresource', code);
  expect(tokens.filter(([text]) => text === 'node')).toEqual([
    ['node', 'tag'],
    ['node', 'tag'],
    ['node', 'variable'],
  ]);
  expect(tokens).toContainEqual(['sub_resource', 'tag']);
  assertLineFedParity('gdresource', code);
});

test('gdresource: digit-led TileSet keys are properties', () => {
  const code = `[resource]
0:0/0 = 0
0:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8)
values = {
1: 2
}
`;
  const tokens = tokenKinds('gdresource', code);
  for (const [text, kind] of [
    ['0:0/0', 'property'],
    ['0:0/0/physics_layer_0/polygon_0/points', 'property'],
    ['1', 'number'],
    ['2', 'number'],
  ])
    expect(tokens).toContainEqual([text, kind]);
  assertLineFedParity('gdresource', code);
});
