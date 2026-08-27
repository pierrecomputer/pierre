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

let kotlin;
t.before(() => (kotlin = loadLang('kotlin', '$hlKotlin')));

t.test('kotlin: declarations, control flow, types, and functions', () => {
  const src = `package demo
import kotlin.io.println
interface Show { fun show(): Boolean }
data class Box(val value: Int)
fun main() { if (true) return else throw Error() }`;
  const html = checkInvariants(kotlin.hl, src);
  assert.equal(colorOf(html, 'package'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'interface'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'Show'), themeColor('type'));
  assert.equal(colorOf(html, 'show'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'Boolean'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
});

t.test('kotlin: nested comments and documentation buckets', () => {
  const src =
    '// plain\n/// line docs\n/* outer /* nested */ end */\n/** KDoc */';
  const theme = {
    name: 'kotlin-comments',
    appearance: 'dark',
    style: {
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const html = checkInvariants(kotlin.hl, src, { theme });
  assert.equal(colorOf(html, '// plain'), '#111111');
  assert.equal(colorOf(html, '/// line docs'), '#222222');
  assert.equal(colorOf(html, '/** KDoc */'), '#222222');
});

t.test('kotlin: quoted and triple strings expose escapes and templates', () => {
  const src =
    'val a = "hello $name \\n ${value}"; val b = """raw $name\n${value}"""; val c = \'\\u263a\'';
  const html = checkInvariants(kotlin.hl, src);
  assert.equal(colorOf(html, '$name'), themeColor('variable'));
  assert.equal(colorOf(html, '${'), themeColor('punctuation.special'));
  assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
  assert.equal(colorOf(html, '"""raw '), themeColor('string'));
  assert.equal(colorOf(html, String.raw`\u`), themeColor('string.escape'));
});

t.test(
  'kotlin: annotations, members, constants, safe access, and operators',
  () => {
    const src =
      '@JvmStatic fun run() { obj.field = obj?.call(MAX_VALUE) ?: null; x >>= 1 }';
    const html = checkInvariants(kotlin.hl, src);
    assert.equal(colorOf(html, '@JvmStatic'), themeColor('attribute'));
    assert.equal(colorOf(html, 'field'), themeColor('property'));
    assert.equal(colorOf(html, 'call'), themeColor('function.method'));
    assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
    assert.equal(colorOf(html, '?.'), themeColor('operator'));
    assert.equal(colorOf(html, 'null'), themeColor('constant.builtin'));
    assert.equal(colorOf(html, '>>='), themeColor('operator'));
  }
);

t.test('kotlin: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/* outer /* inner',
    '"unterminated',
    '"""open',
    '"$',
    '"${',
    "'\\",
    '@',
    '0x_',
    'é 日本語',
  ]) {
    checkInvariants(kotlin.hl, src);
  }
});

t.test('kotlin: split ranges bound templates, comments, and lookahead', () => {
  const src =
    '/* a /* b */ c */ "hello $name ${value}\\n" """raw\n$name""" @Jvm obj?.call()';
  const size = new TextEncoder().encode(src).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('kotlin', '$hlKotlin', split).hl, src);
});

t.test(
  'kotlin: malformed UTF-8 remains balanced and lossless after decoding',
  () => {
    const bytes = Uint8Array.of(
      0x22,
      0x24,
      0x61,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0xff,
      0x22
    );
    const html = kotlin.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

t.test('kotlin: deterministic fuzz preserves lexer invariants', () => {
  let state = 0xbadc0de;
  const alphabet = 'abcXYZ09_$@ /\\"\'\n\t{}[]().,:;+-*=!?<>&|é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(kotlin.hl, src);
  }
});
