import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('coq: vernacular, declarations, tactics, and qualified names', () => {
  const tokens = tokenKinds('coq', samples.coq.code);
  for (const [text, kind] of [
    ['(** Natural number lemmas: λ😀 <&> *)', 'comment.doc'],
    ['Require Import', 'keyword.import'],
    ['Coq', 'namespace'],
    ['Set Implicit Arguments', 'keyword'],
    ['Inductive', 'keyword.declaration'],
    ['tree', 'type'],
    ['Leaf', 'constructor'],
    ['Fixpoint', 'keyword.declaration'],
    ['size', 'function.definition'],
    ['match', 'keyword.control'],
    ['Theorem', 'keyword.declaration'],
    ['add_0_r', 'function.definition'],
    ['forall', 'keyword.control'],
    ['nat', 'type.builtin'],
    ['Proof', 'keyword'],
    ['induction', 'keyword.control'],
    ['as', 'keyword'],
    ['-', 'punctuation.list_marker'],
    ['reflexivity', 'keyword.control'],
    ['Qed', 'keyword'],
    ['export', 'attribute'],
    ['Hint Resolve', 'keyword'],
    ['0x10', 'number'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('coq: a capitalized word is a command only at a sentence start', () => {
  expect(
    tokenKinds('coq', 'Set Implicit Arguments.\nDefinition t : Set := nat.')
  ).toEqual([
    ['Set Implicit Arguments', 'keyword'],
    ['.', 'punctuation.delimiter'],
    ['Definition', 'keyword.declaration'],
    ['t', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['Set', 'type.builtin'],
    [':=', 'operator'],
    ['nat', 'type.builtin'],
    ['.', 'punctuation.delimiter'],
  ]);
  // a command's leading words, but not a name it ends with
  expect(
    tokenKinds('coq', 'Hint Resolve foo : core.\nCheck Foo.\nCheck Nat.add.')
  ).toEqual([
    ['Hint Resolve', 'keyword'],
    ['foo', 'variable'],
    [':', 'punctuation.delimiter'],
    ['core', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Check', 'keyword'],
    ['Foo', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Check', 'keyword'],
    ['Nat', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['add', 'variable'],
    ['.', 'punctuation.delimiter'],
  ]);
  // imports name namespaces until the sentence ends
  expect(
    tokenKinds('coq', 'From Coq Require Import ssreflect ssrbool.')
  ).toEqual([
    ['From', 'keyword.import'],
    ['Coq', 'namespace'],
    ['Require Import', 'keyword.import'],
    ['ssreflect ssrbool', 'namespace'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('coq: inductive and record bodies name their constructors', () => {
  expect(
    tokenKinds(
      'coq',
      'Inductive color := red | green.\nRecord point := mk { px : nat }.'
    )
  ).toEqual([
    ['Inductive', 'keyword.declaration'],
    ['color', 'type'],
    [':=', 'operator'],
    ['red', 'constructor'],
    ['|', 'operator'],
    ['green', 'constructor'],
    ['.', 'punctuation.delimiter'],
    ['Record', 'keyword.declaration'],
    ['point', 'type'],
    [':=', 'operator'],
    ['mk', 'constructor'],
    ['{', 'punctuation.bracket'],
    ['px', 'variable'],
    [':', 'punctuation.delimiter'],
    ['nat', 'type.builtin'],
    ['}', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
  ]);
  // intro patterns outside an inductive body stay plain
  expect(tokenKinds('coq', "destruct n as [| n'].")).toContainEqual([
    "n'",
    'variable',
  ]);
});

test('coq: bullets, focus braces, attributes, and colliding tactic hashes', () => {
  expect(
    tokenKinds(
      'coq',
      'Proof.\n  - split.\n    + auto.\n  { exact I. }\nQed.\n#[local] Instance x : Foo := {}.'
    )
  ).toEqual([
    ['Proof', 'keyword'],
    ['.', 'punctuation.delimiter'],
    ['-', 'punctuation.list_marker'],
    ['split', 'keyword.control'],
    ['.', 'punctuation.delimiter'],
    ['+', 'punctuation.list_marker'],
    ['auto', 'keyword.control'],
    ['.', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['exact', 'keyword.control'],
    ['I', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['Qed', 'keyword'],
    ['.', 'punctuation.delimiter'],
    ['#[', 'punctuation.special'],
    ['local', 'attribute'],
    [']', 'punctuation.special'],
    ['Instance', 'keyword.declaration'],
    ['x', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['Foo', 'variable'],
    [':=', 'operator'],
    ['{}', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
  ]);
  for (const word of [
    'induction',
    'inversion',
    'injection',
    'intuition',
    'repeat',
    'revert',
    'rewrite',
  ]) {
    expect(tokenKinds('coq', `${word} H.`)[0]).toEqual([
      word,
      'keyword.control',
    ]);
  }
  expect(tokenKinds('coq', 'inversions.')[0]).toEqual([
    'inversions',
    'variable',
  ]);
});

test('coq: nested and doc comments, doubled quotes, and multi-line strings', () => {
  expect(
    tokenKinds('coq', '(* a (* b *) c *) (** doc *) (**) "say ""hi"""')
  ).toEqual([
    ['(* a (* b *) c *)', 'comment'],
    ['(** doc *)', 'comment.doc'],
    ['(**)', 'comment'],
    ['"say ""hi"""', 'string'],
  ]);
  for (const code of [
    samples.coq.code,
    '(* open (* nested\n*) still\n*) Lemma x : True.\n',
    'Definition s := "one\n""two""\nthree".\nCheck s.\n',
    'Inductive t :=\n  | A\n  | B.\nProof.\n- auto.\nQed.\n',
    '#[export]\nInstance i : C := {}.\r\nCheck i.\r\n',
  ]) {
    assertLineFedParity('coq', code);
  }
});

test('coq: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('coq', '$hlCoq');
  for (const code of [
    '',
    '(*',
    '(**',
    '(* (*',
    '"',
    '""',
    '#[',
    '#[x',
    '.',
    'Inductive',
    'Inductive t :=',
    '→',
    'é',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  const rand = makeRand(0xc0c0);
  const alphabet = Array.from('abcXYZ09_\' "\n\r\t()[]{}.,:;+-*=<>|/\\#@%λ→😀');
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
    assertLineFedParity('coq', src);
  }
});
