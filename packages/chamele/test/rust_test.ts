import assert from 'node:assert';
import t from 'node:test';

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
t.before(() => (rust = loadLang('rust', '$hlRust')));

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
