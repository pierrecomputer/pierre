import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let haskell;

t.before(() => {
  haskell = loadLang('haskell', '$hlHaskell');
});

const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const STRING = themeColor('string');
const CHAR = themeColor('string.special');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const CONTROL = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const IMPORT = themeColor('keyword.import');
const TYPE = themeColor('type');
const CONSTRUCTOR = themeColor('constructor');
const FUNCTION = themeColor('function');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

void t.test('haskell: line, nested block, and documentation comments', () => {
  const src =
    '-- plain\n-- | line docs\n{- outer {- nested -} tail -}\n{-| block docs -}';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '-- plain'), COMMENT);
  assert.equal(colorOf(html, '{- outer {- nested -} tail -}'), COMMENT);

  const bucketTheme = {
    name: 'haskell-comment-buckets',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const bucketed = checkInvariants(haskell.hl, src, { theme: bucketTheme });
  assert.equal(colorOf(bucketed, '-- | line docs'), '#222222');
  assert.equal(colorOf(bucketed, '{-| block docs -}'), '#222222');
});

void t.test('haskell: pragmas are preprocessor tokens', () => {
  const src =
    '{-# LANGUAGE OverloadedStrings #-}\n{-# OPTIONS_GHC -Wall #-}\nmodule Demo where';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '{-# LANGUAGE OverloadedStrings #-}'), PREPROC);
  assert.equal(colorOf(html, '{-# OPTIONS_GHC -Wall #-}'), PREPROC);
});

void t.test('haskell: strings, characters, and escapes', () => {
  const src = "message = \"line\\n\\x41\"\nletter = 'λ'\nquote = '\\''";
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '"line'), STRING);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\x`), ESCAPE);
  assert.equal(colorOf(html, "'λ'"), CHAR);
  assert.equal(colorOf(html, String.raw`\'`), ESCAPE);
});

void t.test('haskell: numeric literals', () => {
  const src = 'values = [42, 0xff, 0o755, 0b1010, 1_000, 3.14, .5, 1e-6]';
  const html = checkInvariants(haskell.hl, src);
  for (const n of [
    '42',
    '0xff',
    '0o755',
    '0b1010',
    '1_000',
    '3.14',
    '.5',
    '1e-6',
  ]) {
    assert.equal(colorOf(html, n), NUMBER, n);
  }
});

void t.test(
  'haskell: modules, imports, declarations, types, and constructors',
  () => {
    const src =
      'module Demo.Core where\nimport qualified Data.Text as T\ndata Maybe a = Nothing | Just a\nnewtype User = User String\nclass Render a where\ninstance Render User where';
    const html = checkInvariants(haskell.hl, src);
    assert.equal(colorOf(html, 'module'), IMPORT);
    assert.equal(colorOf(html, 'import'), IMPORT);
    assert.equal(colorOf(html, 'qualified'), IMPORT);
    assert.equal(colorOf(html, 'data'), DECLARATION);
    assert.equal(colorOf(html, 'newtype'), DECLARATION);
    assert.equal(colorOf(html, 'class'), DECLARATION);
    assert.equal(colorOf(html, 'instance'), DECLARATION);
    assert.equal(colorOf(html, 'Maybe'), TYPE);
    assert.equal(colorOf(html, 'Nothing'), CONSTRUCTOR);
    assert.equal(colorOf(html, 'Just'), CONSTRUCTOR);
  }
);

void t.test('haskell: control flow, definitions, calls, and operators', () => {
  const src =
    'render :: Show a => a -> IO ()\nrender value = do\n  let text = show value\n  if null text then pure () else print text\ncontains = value `elem` values';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, 'render'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'do'), CONTROL);
  assert.equal(colorOf(html, 'let'), CONTROL);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'then'), CONTROL);
  assert.equal(colorOf(html, 'else'), CONTROL);
  assert.equal(colorOf(html, 'show'), FUNCTION);
  assert.equal(colorOf(html, 'print'), FUNCTION);
  assert.equal(colorOf(html, 'elem'), FUNCTION);
  for (const op of ['::', '=>', '->', '='])
    assert.equal(colorOf(html, op), OPERATOR, op);
  assert.equal(colorOf(html, '('), BRACKET);
});

void t.test('haskell: malformed and UTF-8 input remains lossless', () => {
  for (const src of [
    '{- unterminated {- nested -}',
    '{-# LANGUAGE λ',
    '-- | docs 雪',
    '"unterminated \\',
    "'λ",
    "value' = café 🚀",
    '0x + 1e+',
    '-}',
  ])
    checkInvariants(haskell.hl, src);
});

void t.test('haskell: lookahead is bounded by split ranges', () => {
  for (const [prefix, tail] of [
    ['{', '- block -}'],
    ['{-', '# LANGUAGE GADTs #-}'],
    ['-', '- comment\nx = 1'],
    ['"a\\', 'n" tail'],
    [':', ': Int'],
    ['`', 'elem` xs'],
  ]) {
    const ranged = loadLang('haskell', '$hlHaskell', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('haskell: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ \'\\"{}()[]`#.:,+-*/|&=<>\nλ雪';
  let state = 0x13579bdf;
  for (let sample = 0; sample < 180; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(haskell.hl, src);
  }
});
