import { expect, test } from 'bun:test';

import { codeToTokens } from '../lib/index';
import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  initFullModule,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('lean: declarations, proof tactics, attributes, and commands', () => {
  const tokens = tokenKinds('lean', samples.lean.code);
  for (const [text, kind] of [
    ['import', 'keyword.import'],
    ['Mathlib', 'namespace'],
    ['theorem', 'keyword.declaration'],
    ['identity', 'function.definition'],
    ['Prop', 'type.builtin'],
    ['intro', 'keyword.control'],
    ['exact', 'keyword.control'],
    ['simp', 'attribute'],
    ['#check', 'preproc'],
    ['12', 'number'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(
    tokenKinds('lean', 'structure Point where\n  x : Nat\n')
  ).toContainEqual(['Point', 'type']);
  expect(tokenKinds('lean', 'def Nat.answer := 42')).toContainEqual([
    'answer',
    'function.definition',
  ]);
});

test('lean: Unicode operators remain separate from adjacent identifiers', () => {
  expect(tokenKinds('lean', 'α→β ∀x, x∈s ∧ x≤n ⟨x⟩')).toEqual([
    ['α', 'variable'],
    ['→', 'operator'],
    ['β', 'variable'],
    ['∀', 'keyword.operator'],
    ['x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['∈', 'operator'],
    ['s', 'variable'],
    ['∧', 'operator'],
    ['x', 'variable'],
    ['≤', 'operator'],
    ['n', 'variable'],
    ['⟨', 'punctuation.bracket'],
    ['x', 'variable'],
    ['⟩', 'punctuation.bracket'],
  ]);
  // Adjacent equal styles may merge across whitespace; test each name's
  // lexical boundary independently of that renderer optimization.
  for (const name of ['f₁', 'x?', 'foo!', "name'", 'ℕ', '𝒜']) {
    expect(tokenKinds('lean', name)).toEqual([[name, 'variable']]);
  }
});

test('lean: colliding keyword hashes retain their distinct categories', () => {
  for (const [word, kind] of [
    ['where', 'keyword.declaration'],
    ['while', 'keyword.control'],
    ['private', 'keyword'],
    ['prelude', 'keyword'],
    ['repeat', 'keyword.control'],
    ['revert', 'keyword.control'],
  ]) {
    expect(tokenKinds('lean', word)).toEqual([[word, kind]]);
    expect(tokenKinds('lean', word + '_user')).toEqual([
      [word + '_user', 'variable'],
    ]);
  }
});

test('lean: nested comments and both documentation forms retain their category', () => {
  expect(
    tokenKinds(
      'lean',
      '/- a /- b -/ c -/\n/-- docs /- nested -/ -/\n/-! module docs -/\n-- line\ndef next := 1'
    )
  ).toContainEqual(['/- a /- b -/ c -/', 'comment']);
  for (const code of ['/-- docs /- nested -/ -/', '/-! module docs -/']) {
    expect(tokenKinds('lean', code)).toEqual([[code, 'comment.doc']]);
  }
});

test('lean: escaped identifiers, characters, ordinary and counted raw strings', () => {
  expect(tokenKinds('lean', 'def «if» := "-- text /- text -/"')).toContainEqual(
    ['«if»', 'function.definition']
  );
  expect(tokenKinds('lean', 'def «two\nlines» := 0')).toContainEqual([
    '«two',
    'function.definition',
  ]);
  expect(tokenKinds('lean', String.raw`'λ' '\n' "hi\n"`)).toContainEqual([
    '\\n',
    'string.escape',
  ]);
  const raw = String.raw`r##"quote "# and \n /- --"##`;
  expect(tokenKinds('lean', raw)).toEqual([[raw, 'string']]);
  const long = `r${'#'.repeat(48)}"one\n"# two\n"${'#'.repeat(48)}`;
  const tokens = assertLineFedParity('lean', long);
  expect(
    tokens
      .flat()
      .map((token) => token.content)
      .join('')
  ).toContain('two');
});

test('lean: multiline literals, names and nested comments resume line-fed', () => {
  for (const code of [
    samples.lean.code,
    'def text := "first\n-- still text\nlast"\ndef ok := true\n',
    '/-- a /- nested\nmore -/\nend -/\ntheorem t : True := by\n  trivial\n',
    'def «escaped\nname» := r##"raw\n"# text\n"##\n',
  ]) {
    assertLineFedParity('lean', code);
  }
});

test('lean: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('lean', '$hlLean');
  const rand = makeRand(0x1ea4);
  const alphabet = Array.from(
    'abcXYZ09_!? /\\"\'`\n\r\t{}[]().,:;+-*=<>&|#@α→∀λℕ₁«»😀'
  );
  for (const code of [
    '',
    '/-',
    '/--',
    'r#',
    'r#"',
    '«',
    "'",
    '"\\',
    '#',
    '@[',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  for (let n = 0; n < 160; n++) {
    const code = Array.from(
      { length: rand() & 63 },
      () => alphabet[rand() % alphabet.length]
    ).join('');
    checkInvariants(lexer.hl, code);
  }
});

test('lean4 alias highlights the same proof as lean', () => {
  initFullModule();
  expect(
    codeToTokens(samples.lean.code, { lang: 'lean4', theme: distinctTheme })
  ).toEqual(
    codeToTokens(samples.lean.code, { lang: 'lean', theme: distinctTheme })
  );
});
