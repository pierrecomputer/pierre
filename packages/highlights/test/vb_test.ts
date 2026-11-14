import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('vb: comments, imports, namespaces, classes, and modifiers', () => {
  expect(
    tokenKinds(
      'vb',
      "' note\n''' <summary>doc</summary>\nImports System.Text\nNamespace App\n  Public MustInherit Class Shape : Inherits Base\n    Overloads Shared ReadOnly Property Me2 As String\n  End Class\nEnd Namespace"
    )
  ).toEqual([
    ["' note", 'comment'],
    ["''' <summary>doc</summary>", 'comment.doc'],
    ['Imports', 'keyword.import'],
    ['System', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Text', 'namespace'],
    ['Namespace', 'keyword.declaration'],
    ['App', 'namespace'],
    ['Public MustInherit Class', 'keyword.declaration'],
    ['Shape', 'type'],
    [':', 'punctuation.delimiter'],
    ['Inherits', 'keyword'],
    ['Base', 'type'],
    ['Overloads Shared ReadOnly Property', 'keyword.declaration'],
    ['Me2', 'function.definition'],
    ['As', 'keyword'],
    ['String', 'type.builtin'],
    ['End', 'keyword'],
    ['Class', 'keyword.declaration'],
    ['End', 'keyword'],
    ['Namespace', 'keyword.declaration'],
  ]);
});

test('vb: routine heads, parameters, and End/Exit statements', () => {
  expect(
    tokenKinds(
      'vb',
      'Private Sub Button1_Click(sender As Object, e As EventArgs) Handles Button1.Click\n  If a < b AndAlso Not IsNothing(x) Then Exit Sub\nEND SUB\nsub Main()\nend sub'
    )
  ).toEqual([
    ['Private Sub', 'keyword.declaration'],
    ['Button1_Click', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['sender', 'variable.parameter'],
    ['As', 'keyword'],
    ['Object', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['e', 'variable.parameter'],
    ['As', 'keyword'],
    ['EventArgs', 'type'],
    [')', 'punctuation.bracket'],
    ['Handles', 'keyword.declaration'],
    ['Button1', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Click', 'property'],
    ['If', 'keyword.control'],
    ['a', 'variable'],
    ['<', 'operator'],
    ['b', 'variable'],
    ['AndAlso Not', 'keyword.operator'],
    ['IsNothing', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['Then Exit', 'keyword.control'],
    ['Sub', 'keyword.declaration'],
    ['END', 'keyword'],
    ['SUB', 'keyword.declaration'],
    ['sub', 'keyword.declaration'],
    ['Main', 'function.definition'],
    ['()', 'punctuation.bracket'],
    ['end', 'keyword'],
    ['sub', 'keyword.declaration'],
  ]);
});

test('vb: strings, interpolation, Rem comments, numbers, dates, and directives', () => {
  const code =
    'Dim s$ = Left$(name, 3) & "a""b" & $"{x:N2} {{y}}"\nrem whole\nx = &HFF + &o17 + &B101 + 1.5E+3R + .5\nd = #12/31/2024 11:59 PM#\n  #If DEBUG Then';
  expect(tokenKinds('vb', code)).toEqual([
    ['Dim', 'keyword.declaration'],
    ['s$', 'variable'],
    ['=', 'operator'],
    ['Left$', 'function'],
    ['(', 'punctuation.bracket'],
    ['name', 'variable'],
    [',', 'punctuation.delimiter'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    ['&', 'operator'],
    ['"a', 'string'],
    ['""', 'string.escape'],
    ['b"', 'string'],
    ['&', 'operator'],
    ['$"', 'string'],
    ['{', 'punctuation.special'],
    ['x', 'variable'],
    [':', 'punctuation.delimiter'],
    ['N2', 'variable'],
    ['}', 'punctuation.special'],
    ['{{', 'string.escape'],
    ['y', 'string'],
    ['}}', 'string.escape'],
    ['"', 'string'],
    ['rem whole', 'comment'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['&HFF', 'number'],
    ['+', 'operator'],
    ['&o17', 'number'],
    ['+', 'operator'],
    ['&B101', 'number'],
    ['+', 'operator'],
    ['1.5E+3R', 'number'],
    ['+', 'operator'],
    ['.5', 'number'],
    ['d', 'variable'],
    ['=', 'operator'],
    ['#12/31/2024 11:59 PM#', 'string.special'],
    ['#If DEBUG Then', 'preproc'],
  ]);
  assertLineFedParity('vb', code);
});

test('vb: attributes, generics, escaped names, and line continuations', () => {
  const code =
    '<Assembly: AssemblyVersion("1.0")>\nPublic Function F(<Out> ByRef x As List(Of Integer)) As Integer()\n  Dim [Date] As New Dictionary(Of String, Decimal)\n  Return If(x Is Nothing, 0, _\n    x.Count)\nEnd Function';
  expect(tokenKinds('vb', code)).toEqual([
    ['<', 'punctuation.bracket'],
    ['Assembly', 'attribute'],
    [':', 'punctuation.delimiter'],
    ['AssemblyVersion', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"1.0"', 'string'],
    [')>', 'punctuation.bracket'],
    ['Public Function', 'keyword.declaration'],
    ['F', 'function.definition'],
    ['(<', 'punctuation.bracket'],
    ['Out', 'attribute'],
    ['>', 'punctuation.bracket'],
    ['ByRef', 'keyword.declaration'],
    ['x', 'variable.parameter'],
    ['As', 'keyword'],
    ['List', 'type'],
    ['(', 'punctuation.bracket'],
    ['Of', 'keyword'],
    ['Integer', 'type.builtin'],
    ['))', 'punctuation.bracket'],
    ['As', 'keyword'],
    ['Integer', 'type.builtin'],
    ['()', 'punctuation.bracket'],
    ['Dim', 'keyword.declaration'],
    ['[Date]', 'variable'],
    ['As New', 'keyword'],
    ['Dictionary', 'type'],
    ['(', 'punctuation.bracket'],
    ['Of', 'keyword'],
    ['String', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['Decimal', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['Return If', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['Is', 'keyword.operator'],
    ['Nothing', 'constant.builtin'],
    [',', 'punctuation.delimiter'],
    ['0', 'number'],
    [',', 'punctuation.delimiter'],
    ['_', 'punctuation.special'],
    ['x', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Count', 'property'],
    [')', 'punctuation.bracket'],
    ['End', 'keyword'],
    ['Function', 'keyword.declaration'],
  ]);
  assertLineFedParity('vb', code);
});

test('vb: an unclosed interpolation hole ends with its line', () => {
  const code = 'x = $"a{b\ny = {1}';
  expect(tokenKinds('vb', code)).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['$"a', 'string'],
    ['{', 'punctuation.special'],
    ['b', 'variable'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['{', null],
    ['1', 'number'],
    ['}', null],
  ]);
  assertLineFedParity('vb', code);
});

test('vb: a file number is not a date literal', () => {
  const code = 'Print #1, "Item #" & n\nd = #1/31/2024 12:30 PM#\n';
  expect(tokenKinds('vb', code)).toEqual([
    ['Print', 'variable'],
    ['#', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['"Item #"', 'string'],
    ['&', 'operator'],
    ['n', 'variable'],
    ['d', 'variable'],
    ['=', 'operator'],
    ['#1/31/2024 12:30 PM#', 'string.special'],
  ]);
  assertLineFedParity('vb', code);
});

test('vb: Property Get/Let/Set and Sub New name a definition', () => {
  expect(
    tokenKinds(
      'vb',
      'Public Property Get FullName() As String\nPublic Sub New(x As Integer)\n'
    )
  ).toEqual([
    ['Public Property Get', 'keyword.declaration'],
    ['FullName', 'function.definition'],
    ['()', 'punctuation.bracket'],
    ['As', 'keyword'],
    ['String', 'type.builtin'],
    ['Public Sub', 'keyword.declaration'],
    ['New', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable.parameter'],
    ['As', 'keyword'],
    ['Integer', 'type.builtin'],
    [')', 'punctuation.bracket'],
  ]);
});

test('vb: an escaped name holds only name bytes', () => {
  expect(tokenKinds('vb', 'x = [a + b] + [Class]')).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['b', 'variable'],
    [']', 'punctuation.bracket'],
    ['+', 'operator'],
    ['[Class]', 'variable'],
  ]);
});
