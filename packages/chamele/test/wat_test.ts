import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  type TestLang,
  themeColor,
} from './util';

let wat: TestLang;
t.before(() => (wat = loadLang('wat', '$hlWat')));

const KEYWORD = themeColor('keyword');
const CONTROL = themeColor('keyword.control');
const TYPE = themeColor('type.builtin');
const FUNCTION = themeColor('function');
const VARIABLE = themeColor('variable');
const NUMBER = themeColor('number');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');

void t.test(
  'wat: module forms, instructions, identifiers, and literals',
  () => {
    const src =
      '(module (func $add (param $x i32) (result i32) local.get $x i32.const 1 i32.add) (export "add" (func $add)))';
    const html = checkInvariants(wat.hl, src);
    assert.equal(colorOf(html, 'module'), KEYWORD);
    assert.equal(colorOf(html, 'i32'), TYPE);
    assert.equal(colorOf(html, 'local.get'), FUNCTION);
    assert.equal(colorOf(html, '$add'), VARIABLE);
    assert.equal(colorOf(html, '1'), NUMBER);
    assert.equal(colorOf(html, '"add"'), STRING);
  }
);

void t.test('wat: structured control words', () => {
  const html = checkInvariants(
    wat.hl,
    '(block (loop (if (then br 0) (else nop))))'
  );
  assert.equal(colorOf(html, 'block'), CONTROL);
  assert.equal(colorOf(html, 'loop'), CONTROL);
  assert.equal(colorOf(html, 'br'), CONTROL);
});

void t.test('wat: line and nested block comments', () => {
  const src =
    ';; line\n(module (; outer (; inner ;) end ;)) nop;; attached\n$x;; named';
  const html = checkInvariants(wat.hl, src);
  assert.equal(colorOf(html, ';; line'), COMMENT);
  assert.equal(colorOf(html, '(; outer'), COMMENT);
  assert.equal(colorOf(html, ';; attached'), COMMENT);
  assert.equal(colorOf(html, ';; named'), COMMENT);
});

void t.test('wat: malformed and split ranges stay lossless', () => {
  for (const src of ['', '(', '(;', ';;', '"\\é', '$', 'i32.', 'é_日本語'])
    checkInvariants(wat.hl, src);
  const split = loadLang('wat', '$hlWat', 6);
  checkInvariants(split.hl, '(func $x (result i32))');
});
