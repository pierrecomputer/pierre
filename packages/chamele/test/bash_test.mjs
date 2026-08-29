import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let bash;

t.before(() => {
  bash = loadLang('bash', '$hlBash');
});

const COMMENT = themeColor('comment');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const KEYWORD = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const FUNCTION_DEF = themeColor('function.definition');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

void t.test('bash: shebangs and lexical comments', () => {
  const src = '#!/usr/bin/env bash\necho foo#bar # trailing note';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '#!/usr/bin/env bash'), COMMENT);
  assert.equal(colorOf(html, '# trailing note'), COMMENT);
  assert.notEqual(colorOf(html, '#bar'), COMMENT);
});

void t.test('bash: strings, ANSI-C strings, and escapes', () => {
  const src = "printf '%s' \"line\\n$name\" $'tab\\t' `cmd`";
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, "'%s'"), STRING);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\t`), ESCAPE);
  assert.equal(colorOf(html, '$name'), VARIABLE);
  assert.equal(colorOf(html, '`cmd`'), themeColor('string.special'));
});

void t.test('bash: variables and substitutions', () => {
  const src = 'echo $plain ${HOME:-/tmp} $(date) $((count + 1))';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '$plain'), VARIABLE);
  assert.equal(colorOf(html, 'HOME:-/tmp'), VARIABLE);
  assert.equal(colorOf(html, '$('), themeColor('punctuation.special'));
  assert.equal(colorOf(html, 'count'), VARIABLE);
});

void t.test(
  'bash: control words, declarations, commands, and functions',
  () => {
    const src =
      'function greet { local name=world; if true; then printf \'%s\' "$name"; fi; }\ngoodbye() { return 0; }';
    const html = checkInvariants(bash.hl, src);
    assert.equal(colorOf(html, 'function'), DECLARATION);
    assert.equal(colorOf(html, 'greet'), FUNCTION_DEF);
    assert.equal(colorOf(html, 'goodbye'), FUNCTION_DEF);
    assert.equal(colorOf(html, 'local'), DECLARATION);
    assert.equal(colorOf(html, 'if'), KEYWORD);
    assert.equal(colorOf(html, 'then'), KEYWORD);
    assert.equal(colorOf(html, 'printf'), FUNCTION);
  }
);

void t.test('bash: numbers, operators, and brackets', () => {
  const src = 'if [[ $n -ge 0 && $n != 42 ]]; then n=$((n+1)); fi';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '42'), NUMBER);
  assert.equal(colorOf(html, '&&'), OPERATOR);
  assert.equal(colorOf(html, '!='), OPERATOR);
  assert.equal(colorOf(html, '[['), BRACKET);
  assert.equal(colorOf(html, ']]'), BRACKET);
});

void t.test('bash: simple here-documents are bounded strings', () => {
  const src = "cat <<'EOF'\npayload $name\nEOF\necho done";
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, "'EOF'"), STRING);
  assert.equal(colorOf(html, 'payload $name'), STRING);
  assert.equal(colorOf(html, 'EOF\n'), STRING);
  assert.equal(colorOf(html, 'echo'), FUNCTION);
});

void t.test('bash: malformed and UTF-8 input stays lossless', () => {
  for (const src of [
    "'unterminated λ",
    '"unterminated $变量 \\',
    '"\\本',
    '${missing',
    '$(unterminated',
    'cat <<EOF\n雪 $x',
    '$',
    '<<<word',
    'echo café 🚀',
  ])
    checkInvariants(bash.hl, src);
});

void t.test('bash: lookahead never crosses split ranges', () => {
  for (const [prefix, tail] of [
    ['#', '!/bin/bash\necho ok'],
    ['$', '{name}'],
    ['<', '<EOF\nbody\nEOF\n'],
    ['"a\\', 'n" tail'],
    ['[', '[ x ]]'],
  ]) {
    const ranged = loadLang('bash', '$hlBash', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('bash: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ $\'\\"`{}()[]<>|&;#-=\nλ';
  let state = 0x51a7f00d;
  for (let sample = 0; sample < 160; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(bash.hl, src);
  }
});
