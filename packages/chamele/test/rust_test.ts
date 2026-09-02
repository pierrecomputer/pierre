import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, TokenizeStream } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  themeColor,
} from './util';

let rust: TestLang;
t.before(() => {
  rust = loadLang('rust', '$hlRust');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/**
 * Tokens for `code` from the whole buffer and from a TokenizeStream fed one
 * line per push - the chunk shape the LiveTokenizer uses - so a test can
 * assert that a construct crossing line boundaries resumes correctly.
 */
function wholeAndLineFed(
  lang: Lang,
  code: string
): [ThemedToken[][], ThemedToken[][]] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new TokenizeStream({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return [whole, streamed];
}

void t.test('rust: declarations, control, traits, types, and functions', () => {
  const src = `use std::fmt;
pub trait Show { fn show(&self) -> bool; }
struct Box<T> { value: T }
fn main() { let n: i32 = 1; if n > 0 { return } }`;
  const html = checkInvariants(rust.hl, src);
  assert.equal(colorOf(html, 'use'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'trait'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'Show'), themeColor('type'));
  assert.equal(colorOf(html, 'main'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'i32'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
});

void t.test('rust: nested comments and documentation buckets', () => {
  const src =
    '// plain\n/// outer docs\n//! inner docs\n/* a /* nested */ b */\n/** docs */\n/*! inner */';
  const theme = {
    name: 'rust-comments',
    appearance: 'dark',
    style: {
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const html = checkInvariants(rust.hl, src, { theme });
  assert.equal(colorOf(html, '/* a /* nested */ b */'), '#111111');
  assert.equal(colorOf(html, '/// outer docs'), '#222222');
  assert.equal(colorOf(html, '/*! inner */'), '#222222');
});

void t.test(
  'rust: strings, byte literals, raw strings, chars, and lifetimes',
  () => {
    const src = String.raw`let a = "x\n"; let b = b'\x41'; let c = br##"raw \n"##; let d = r#"raw"#; fn f<'a>(x: &'a str) {}`;
    const html = checkInvariants(rust.hl, src);
    assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
    assert.equal(colorOf(html, String.raw`\x`), themeColor('string.escape'));
    assert.equal(colorOf(html, 'br##"raw \\n"##'), themeColor('string'));
    assert.equal(colorOf(html, "'a"), themeColor('label'));
  }
);

void t.test(
  'rust: attributes, macros, members, constants, and operators',
  () => {
    const src =
      '#[derive(Debug)] async fn run() { obj.field = obj.call(MAX_VALUE); println!("x"); x >>= 1; }';
    const html = checkInvariants(rust.hl, src);
    assert.equal(colorOf(html, '#'), themeColor('attribute'));
    assert.equal(colorOf(html, 'derive'), themeColor('attribute'));
    assert.equal(colorOf(html, 'println'), themeColor('function'));
    assert.equal(colorOf(html, 'field'), themeColor('property'));
    assert.equal(colorOf(html, 'call'), themeColor('function.method'));
    assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
    assert.equal(colorOf(html, '>>='), themeColor('operator'));
  }
);

void t.test('rust: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/* outer /* inner',
    '"unterminated',
    "'",
    "'life",
    'r###"open',
    'br#"open',
    '#[cfg',
    '0x_',
    'é 日本語',
  ]) {
    checkInvariants(rust.hl, src);
  }
});

void t.test('rust: split ranges bound comments, strings, and lookahead', () => {
  const src = '/* a /* b */ c */ r##"raw"## b"x\\n" \'a obj.call() println!()';
  const size = new TextEncoder().encode(src).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('rust', '$hlRust', split).hl, src);
});

void t.test(
  'rust: malformed UTF-8 remains balanced and lossless after decoding',
  () => {
    const bytes = Uint8Array.of(0x72, 0x23, 0x20, 0xf0, 0x28, 0x8c, 0x28, 0xff);
    const html = rust.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('rust: deterministic fuzz preserves lexer invariants', () => {
  let state = 0xc0ffee;
  const alphabet = 'abcXYZ09_# /\\"\'rnb\n\t{}[]().,:;+-*=!<>&|é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(rust.hl, src);
  }
});

void t.test('rust: fn parameters match Zed variable.parameter', () => {
  const PARAM = themeColor('variable.parameter');
  const VARIABLE = themeColor('variable');
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    rust.hl,
    'pub fn get<T: Clone>(key: &str, mut item: T, opts: Map<K, V>) -> T { item }\n' +
      'impl S { fn m(&self, data: [u8; 4]) {} }\n' +
      'let r = call(alpha, beta); let pair: (i32, u32) = (1, 2);'
  );
  for (const name of ['key', 'item', 'opts', 'data']) {
    assert.equal(word(html, name), PARAM, name);
  }
  // call arguments and tuple types stay plain
  for (const name of ['alpha', 'beta']) {
    assert.equal(word(html, name), VARIABLE, name);
  }
  assert.notEqual(word(html, 'V'), PARAM);
});

void t.test('rust: macro bang, fn types, and :: paths classify names', () => {
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    rust.hl,
    'a != b; let f: fn(i32) -> i32 = handler; println!("x");\n' +
      'use std::collections::HashMap; let m = Foo::MAX; s.field;'
  );
  // `!=` is an operator, not a macro bang
  assert.equal(word(html, 'a'), themeColor('variable'));
  assert.equal(word(html, 'println'), themeColor('function'));
  // an `fn(...)` type does not name the next identifier
  assert.equal(word(html, 'handler'), themeColor('variable'));
  // capitalised names after `::` are types or constants, fields after `.`
  assert.equal(word(html, 'HashMap'), themeColor('type'));
  assert.equal(word(html, 'Foo'), themeColor('type'));
  assert.equal(word(html, 'MAX'), themeColor('constant'));
  assert.equal(word(html, 'field'), themeColor('property'));
});

void t.test('rust: move, ref, and super are keywords', () => {
  const html = checkInvariants(rust.hl, 'move ref super::x');
  assert.equal(colorOf(html, 'move'), themeColor('keyword'));
  assert.equal(colorOf(html, 'ref'), themeColor('keyword'));
  assert.equal(colorOf(html, 'super'), themeColor('keyword.import'));
});

void t.test('rust: raw strings resume line-fed for any hash count', () => {
  const probe = 'fn main() { let x: i32 = 1; }\n';
  const before = codeToTokens(probe, { lang: 'rust', theme: pierreDark });
  for (const hashes of [0, 1, 30, 31, 40, 300, 5000]) {
    const h = '#'.repeat(hashes);
    const code = `let s = br${h}"one\n"${h.slice(1)}"two"${h};\nlet x = 1;\n`;
    const [whole, streamed] = wholeAndLineFed('rust', code);
    assert.deepEqual(streamed, whole, `${hashes} hashes`);
    assert.equal(whole[1][0].color, themeColor('string'), `${hashes} hashes`);
  }
  // long hash runs never spill past the stream delimiter into lexer state
  assert.deepEqual(
    codeToTokens(probe, { lang: 'rust', theme: pierreDark }),
    before
  );
});

void t.test('rust: nested comments at even depth match line-fed', () => {
  const code = '/* /* a\nb\n*/ */\nc\n';
  const [whole, streamed] = wholeAndLineFed('rust', code);
  assert.deepEqual(streamed, whole);
  assert.equal(whole[2][0].color, themeColor('comment'));
  assert.equal(whole[3][0].color, themeColor('variable'));
});
