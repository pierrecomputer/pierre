import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('qml: imports, objects, and attribute declarations', () => {
  expect(
    tokenKinds(
      'qml',
      'import QtQuick.Controls 2.15 as QQC2\nimport "x.js" as X'
    )
  ).toEqual([
    ['import', 'keyword.import'],
    ['QtQuick', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Controls', 'namespace'],
    ['2.15', 'number'],
    ['as', 'keyword.import'],
    ['QQC2', 'namespace'],
    ['import', 'keyword.import'],
    ['"x.js"', 'string'],
    ['as', 'keyword.import'],
    ['X', 'namespace'],
  ]);
  const tokens = tokenKinds('qml', samples.qml.code);
  for (const [text, kind] of [
    ['Rectangle', 'type'],
    ['id', 'keyword'],
    ['root', 'variable'],
    ['readonly property', 'keyword.declaration'],
    ['string', 'type.builtin'],
    ['title', 'property'],
    ['clicked', 'function.definition'],
    ['name', 'variable.parameter'],
    ['Mode', 'type'],
    ['Idle', 'constant'],
    ['onClicked', 'function'],
    ['reset', 'function.definition'],
    ['value', 'variable.parameter'],
    ['bool', 'type.builtin'],
    ['anchors', 'property'],
    ['centerIn', 'property'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(
    tokenKinds('qml', 'default property list<Item> items\nBehavior on x {}')
  ).toEqual([
    ['default property', 'keyword.declaration'],
    ['list', 'type.builtin'],
    ['<', 'operator'],
    ['Item', 'type'],
    ['>', 'operator'],
    ['items', 'property'],
    ['Behavior', 'type'],
    ['on', 'keyword'],
    ['x', 'property'],
    ['{}', 'punctuation.bracket'],
  ]);
});

test('qml: binding values are JavaScript up to `;`, the line end, or `}`', () => {
  expect(
    tokenKinds('qml', 'Item { width: a ? 1 : 2; text: "x;y"; color: "red" }')
  ).toEqual([
    ['Item', 'type'],
    ['{', 'punctuation.bracket'],
    ['width', 'property'],
    [':', 'punctuation.delimiter'],
    ['a', 'variable'],
    ['?', 'operator'],
    ['1', 'number'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['text', 'property'],
    [':', 'punctuation.delimiter'],
    ['"x;y"', 'string'],
    [';', 'punctuation.delimiter'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['"red"', 'string'],
    ['}', 'punctuation.bracket'],
  ]);
  // `{` blocks keep their `;`, and a comment is never split
  expect(tokenKinds('qml', 'onA: { f(); g() }\nx: 1 // y; z: 2\n')).toEqual([
    ['onA', 'function'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['f', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['g', 'function'],
    ['() }', 'punctuation.bracket'],
    ['x', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['// y; z: 2', 'comment'],
  ]);
  // object and list values stay QML
  expect(
    tokenKinds('qml', 'model: ListModel {}\nstates: [State { name: "a" }]')
  ).toEqual([
    ['model', 'property'],
    [':', 'punctuation.delimiter'],
    ['ListModel', 'type'],
    ['{}', 'punctuation.bracket'],
    ['states', 'property'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['State', 'type'],
    ['{', 'punctuation.bracket'],
    ['name', 'property'],
    [':', 'punctuation.delimiter'],
    ['"a"', 'string'],
    ['}]', 'punctuation.bracket'],
  ]);
});

test('qml: JavaScript blocks and open brackets continue on later lines', () => {
  const code =
    'Item {\n' +
    '  onClicked: {\n' +
    '    var s = `a\n' +
    '    ${b}`; /* note\n' +
    '    */ f()\n' +
    '  }\n' +
    '  width: Math.max(a,\n' +
    '                  b)\n' +
    '  function g(x)\n' +
    '  {\n' +
    '    return x\n' +
    '  }\n' +
    '  height: 2\n' +
    '}\n';
  const tokens = tokenKinds('qml', code);
  for (const [text, kind] of [
    ['var', 'keyword.declaration'],
    ['*/', 'comment'],
    ['f', 'function'],
    ['b', 'variable'],
    ['return', 'keyword.control'],
    ['height', 'property'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  for (const input of [code, samples.qml.code, 'Item {\n  onX: {\n']) {
    assertLineFedParity('qml', input);
  }
});
