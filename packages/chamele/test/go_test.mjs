import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  textOf,
  themeColor,
} from './util.mjs';

let go;
t.before(() => (go = loadLang('go', '$hlGo')));

t.test('go: declarations, control flow, types, and builtins', () => {
  const src = `package demo
import "fmt"
type Box struct { Value int }
func main() { var ok bool = true; if ok { defer fmt.Println(nil) } }`;
  const html = checkInvariants(go.hl, src);
  assert.equal(colorOf(html, 'package'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'demo'), themeColor('namespace'));
  assert.equal(colorOf(html, 'import'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'int'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
  assert.equal(colorOf(html, 'nil'), themeColor('constant.builtin'));
  assert.equal(colorOf(html, 'main'), themeColor('function.definition'));
});

t.test('go: comments and documentation buckets', () => {
  const src = '// plain\n/// docs\n//! inner\n/* block */\n/** docs */';
  const theme = {
    name: 'go-comments',
    appearance: 'dark',
    style: {
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const html = checkInvariants(go.hl, src, { theme });
  assert.equal(colorOf(html, '// plain'), '#111111');
  assert.equal(colorOf(html, '/// docs'), '#222222');
  assert.equal(colorOf(html, '//! inner'), '#222222');
  assert.equal(colorOf(html, '/** docs */'), '#222222');
});

t.test('go: strings, raw strings, runes, escapes, and numbers', () => {
  const src =
    String.raw`"a\n\x41" + ` +
    '`raw\\n`' +
    String.raw` + '\u263a' + 0xff + 0b101 + 1.2e-3i`;
  const html = checkInvariants(go.hl, src);
  assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
  assert.equal(colorOf(html, '`raw\\n`'), themeColor('string'));
  for (const n of ['0xff', '0b101', '1.2e-3i'])
    assert.equal(colorOf(html, n), themeColor('number'));
});

t.test('go: functions, members, constants, operators, and punctuation', () => {
  const src =
    'func add(x int) int { obj.Field += obj.Method(x); return MAX_VALUE << 1 }';
  const html = checkInvariants(go.hl, src);
  assert.equal(colorOf(html, 'add'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'Field'), themeColor('property'));
  assert.equal(colorOf(html, 'Method'), themeColor('function.method'));
  assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
  assert.equal(colorOf(html, '+='), themeColor('operator'));
  assert.equal(colorOf(html, '('), themeColor('punctuation.bracket'));
});

t.test('go: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '`raw',
    '0x_',
    'é 日本語',
  ]) {
    checkInvariants(go.hl, src);
  }
});

t.test('go: split ranges bound every lookahead', () => {
  const src = 'x// tail\n`raw text` + "a\\n" + obj.Method(0xff)';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('go', '$hlGo', split).hl, src);
  }
});

t.test('go: malformed UTF-8 stays balanced and decodes losslessly', () => {
  const bytes = Uint8Array.of(
    0x66,
    0x6f,
    0x6f,
    0x20,
    0xf0,
    0x28,
    0x8c,
    0x28,
    0x20,
    0xff
  );
  const html = go.hl(bytes);
  assert.equal(textOf(html), new TextDecoder().decode(bytes));
  spansOf(html);
});

t.test('go: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(go.hl, src);
  }
});
