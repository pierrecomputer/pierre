import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spanKinds,
  type TestLang,
  themeColor,
  tokenKinds,
} from './_util';

let wat: TestLang;
t.before(() => (wat = loadLang('wat', '$hlWat')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(wat.hl, src, { theme: distinctTheme });

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

void t.test('wat: every module field keyword and the value types', () => {
  const html = hl(
    '(module (func) (export "x" (func 0)) (import "a" "b" (func)) (type (func (param i32) (result i64))) (global (mut f32)) (memory 1) (data) (elem) (table 1 funcref) (start 0) (local f64) (param v128))'
  );
  for (const word of [
    'module',
    'func',
    'export',
    'import',
    'type',
    'param',
    'result',
    'global',
    'mut',
    'memory',
    'data',
    'elem',
    'table',
    'start',
    'local',
  ]) {
    assert.equal(exactColor(html, word), distinctColor('keyword'), word);
  }
  for (const type of ['i32', 'i64', 'f32', 'f64', 'v128']) {
    assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
  }
  assert.equal(exactColor(html, '"x"'), distinctColor('string'));
  assert.equal(exactColor(html, '"a" "b"'), distinctColor('string'));
  assert.equal(exactColor(html, '1'), distinctColor('number'));
});

void t.test('wat: numeric literal forms, including signs and nan', () => {
  const html = hl(
    '(f64.const -1.5e2) (i32.const 0x7f) (i32.const +5) (i64.const 1_000) (f32.const nan) (f32.const inf)'
  );
  for (const n of ['-1.5e2', '0x7f', '+5', '1_000']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  // the special float words are bare words, so they read as keywords
  assert.equal(exactColor(html, 'nan'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'inf'), distinctColor('keyword'));
});

void t.test('wat: names may carry punctuation and dots', () => {
  assert.deepEqual(
    spanKinds(
      hl('(func $a-b (local $x! i32) (local.get $foo.bar) (call $a-b))')
    ),
    [
      ['(', 'punctuation.bracket'],
      ['func', 'keyword'],
      ['$a-b', 'variable'],
      ['(', 'punctuation.bracket'],
      ['local', 'keyword'],
      ['$x!', 'variable'],
      ['i32', 'type.builtin'],
      [') (', 'punctuation.bracket'],
      ['local.get', 'function'],
      ['$foo.bar', 'variable'],
      [') (', 'punctuation.bracket'],
      ['call', 'keyword'],
      ['$a-b', 'variable'],
      ['))', 'punctuation.bracket'],
    ]
  );
});

void t.test(
  'wat: dotted instructions are functions, bare ones keywords',
  () => {
    const html = hl(
      '(i32.add (local.get 0) (memory.grow (i32.const 1))) (v128.load offset=16 align=4 (i32.const 0)) (i8x16.splat (i32.const 0)) (ref.null func) (table.get $t) (br_if 0) (br_table 0 1) (return) (call 0) (call_indirect (type 0)) (drop) (select) (unreachable)'
    );
    for (const instr of [
      'i32.add',
      'local.get',
      'memory.grow',
      'i32.const',
      'v128.load',
      'i8x16.splat',
      'ref.null',
      'table.get',
    ]) {
      assert.equal(exactColor(html, instr), distinctColor('function'), instr);
    }
    for (const word of [
      'br_if',
      'br_table',
      'return',
      'call',
      'call_indirect',
      'drop',
      'select',
      'unreachable',
      'offset=16 align=4',
    ]) {
      assert.equal(exactColor(html, word), distinctColor('keyword'), word);
    }
    assert.equal(exactColor(html, '$t'), distinctColor('variable'));
  }
);

void t.test('wat: strings carry escapes and may be unterminated', () => {
  const html = hl('(data (i32.const 8) "hi\\n\\00")\n(data "unterminated');
  assert.equal(exactColor(html, '"hi'), distinctColor('string'));
  assert.equal(colorOf(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '"unterminated'), distinctColor('string'));
});

void t.test(
  'wat: comments nest to any depth and never start inside strings',
  () => {
    assert.deepEqual(
      tokenKinds(
        'wat',
        '(; a (; b (; c ;) ;) ;) nop\n(;;) nop\n"(; in string ;)"\n;; ;; double'
      ),
      [
        ['(; a (; b (; c ;) ;) ;)', 'comment'],
        ['nop', 'keyword'],
        ['(;;)', 'comment'],
        ['nop', 'keyword'],
        ['"(; in string ;)"', 'string'],
        [';; ;; double', 'comment'],
      ]
    );
    // a comment right after a name ends the name
    assert.deepEqual(tokenKinds('wat', '(func $f;;comment\n)'), [
      ['(', 'punctuation.bracket'],
      ['func', 'keyword'],
      ['$f', 'variable'],
      [';;comment', 'comment'],
      [')', 'punctuation.bracket'],
    ]);
  }
);

void t.test('wat: parentheses and lone semicolons are punctuation', () => {
  assert.deepEqual(spanKinds(hl('( ) ; ;;x')), [
    ['( )', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    [';;x', 'comment'],
  ]);
});

void t.test('wat: nested comments and strings stream line-fed', () => {
  assertLineFedParity(
    'wat',
    '(module\n  (; open (; nested\n  still ;) more\n  ;)\n  (func $f (result i32)\n    i32.const 1)\n  (data "a\n b")\n)\n'
  );
  assertLineFedParity('wat', '(func ;; trailing\n  nop)\n');
});

void t.test('wat: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    '(',
    ')',
    '(;',
    ';;',
    ';',
    '"\\é',
    '"',
    '$',
    'i32.',
    '.',
    'é_日本語',
    '(; (; unbalanced',
    '-',
    '+',
  ])
    checkInvariants(wat.hl, src);
  const split = loadLang('wat', '$hlWat', 6);
  checkInvariants(split.hl, '(func $x (result i32))');
});
