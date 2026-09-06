import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  themeColor,
  tokenKinds,
  wordColor,
} from './_util';

let rust: TestLang;
t.before(() => {
  rust = loadLang('rust', '$hlRust');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/**
 * Tokens for `code` from the whole buffer and from a StreamTokenizer fed one
 * line per push - the chunk shape the LiveTokenizer uses - so a test can
 * assert that a construct crossing line boundaries resumes correctly.
 */
function wholeAndLineFed(
  lang: Lang,
  code: string
): [ThemedToken[][], ThemedToken[][]] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(rust.hl, src, { theme: distinctTheme });

void t.test('rust: modules, visibility, and item paths', () => {
  const html = distinctHl(
    'use std::collections::HashMap;\nmod inner { pub(crate) fn f() {} }\nextern crate foo;'
  );
  assert.equal(exactColor(html, 'use'), distinctColor('keyword.import'));
  assert.equal(exactColor(html, '::'), distinctColor('punctuation.delimiter'));
  assert.equal(exactColor(html, 'HashMap'), distinctColor('type'));
  assert.equal(exactColor(html, 'mod'), distinctColor('keyword.declaration'));
  assert.equal(exactColor(html, 'pub'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'crate'), distinctColor('keyword.import'));
  assert.equal(exactColor(html, 'fn'), distinctColor('keyword.declaration'));
  assert.equal(exactColor(html, 'f'), distinctColor('function.definition'));
  assert.equal(
    exactColor(html, 'extern crate'),
    distinctColor('keyword.import')
  );
});

void t.test('rust: attributes, enums, generics, lifetimes, and bounds', () => {
  const html = distinctHl(
    "#[derive(Debug)]\n#![allow(dead_code)]\npub enum Shape<'a, T: Clone + 'static> where T: Copy { Circle { r: f64 }, Named(&'a str) }"
  );
  for (const attr of ['#', '#!', 'derive', 'allow']) {
    assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
  }
  assert.equal(exactColor(html, 'enum'), distinctColor('keyword.declaration'));
  for (const type of ['Debug', 'Shape', 'Clone', 'Copy']) {
    assert.equal(exactColor(html, type), distinctColor('type'), type);
  }
  for (const life of ["'a", "'static"]) {
    assert.equal(exactColor(html, life), distinctColor('label'), life);
  }
  assert.equal(exactColor(html, 'where'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'f64'), distinctColor('type.builtin'));
  assert.equal(exactColor(html, 'str'), distinctColor('type.builtin'));
  assert.equal(exactColor(html, 'r'), distinctColor('variable'));
});

void t.test('rust: impls, traits, self, and associated items', () => {
  const html = distinctHl(
    'impl<T> fmt::Display for Shape<T> { fn fmt(&self, f: &mut fmt::Formatter<\'_>) -> fmt::Result { write!(f, "{}", 1) } }\ntrait Area { fn area(&self) -> f64; const PI: f64; type Output; }'
  );
  for (const word of ['impl', 'fn', 'trait', 'const', 'type']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  assert.equal(exactColor(html, 'Display'), distinctColor('type'));
  assert.equal(exactColor(html, 'for'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'self'), distinctColor('variable.special'));
  assert.equal(exactColor(html, 'f'), distinctColor('variable.parameter'));
  assert.equal(exactColor(html, 'mut'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'Formatter'), distinctColor('type'));
  assert.equal(exactColor(html, "'_"), distinctColor('label'));
  assert.equal(exactColor(html, 'write'), distinctColor('function'));
  assert.equal(exactColor(html, '!'), distinctColor('operator'));
  assert.equal(exactColor(html, 'PI'), distinctColor('constant'));
  assert.equal(exactColor(html, 'Output'), distinctColor('type'));
  assert.equal(exactColor(html, 'area'), distinctColor('function.definition'));
});

void t.test('rust: numeric, char, byte, raw, and C string literals', () => {
  const html = distinctHl(
    'let x = 0x1F + 0b101 + 0o17 + 1_000u32 + 1e3f64 + 1.5 + b\'a\' as u8 + \'\\n\' as u8; let s = "esc\\t"; let r = r#"raw "x""#; let b = b"bytes"; let c = c"cstr";'
  );
  for (const n of ['0x1F', '0b101', '0o17', '1_000u32', '1e3f64', '1.5']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  for (const s of ["b'a'", 'r#"raw "x""#', 'b"bytes"', 'c"cstr"', '"esc']) {
    assert.equal(exactColor(html, s), distinctColor('string'), s);
  }
  assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
  assert.equal(exactColor(html, 'as'), distinctColor('keyword.operator'));
  assert.equal(exactColor(html, 'u8'), distinctColor('type.builtin'));
});

void t.test(
  'rust: match arms, let bindings, loops, async, unsafe, and closures',
  () => {
    const html = distinctHl(
      "match opt { Some(ref x) if *x > 0 => x, None => &0, _ => other } if let Some(v) = it.next() { loop { break 'outer; } } while let Some(_) = q.pop() { continue } for i in 0..10 { } async fn f() { g().await } unsafe { *ptr } move || {}; return; static X: i32 = 1;"
    );
    for (const word of [
      'match',
      'if',
      'loop',
      'break',
      'while',
      'continue',
      'for',
      'return',
      'await',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of ['ref', 'async', 'unsafe', 'move']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const word of ['let', 'fn', 'static']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    assert.equal(exactColor(html, 'in'), distinctColor('keyword.operator'));
    assert.equal(exactColor(html, "'outer"), distinctColor('label'));
    for (const op of ['=>', '..', '||', '*']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(exactColor(html, 'Some'), distinctColor('function'));
    assert.equal(exactColor(html, 'None'), distinctColor('type'));
    assert.equal(exactColor(html, 'next'), distinctColor('function.method'));
    assert.equal(exactColor(html, 'i32'), distinctColor('type.builtin'));
  }
);

void t.test('rust: comment forms, including nested block comments', () => {
  assert.deepEqual(
    tokenKinds(
      'rust',
      '// line\n/// doc\n//! inner doc\n/* block\n   /* nested */ */\nfn main() {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/// doc', 'comment.doc'],
      ['//! inner doc', 'comment.doc'],
      ['/* block', 'comment'],
      ['/* nested */ */', 'comment'],
      ['fn', 'keyword.declaration'],
      ['main', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test('rust: macros, paths, and expression operators', () => {
  const html = distinctHl(
    'macro_rules! m { ($x:expr) => { $x }; } println!("{x}", 1); vec![1, 2]; assert_eq!(a, b); Self::new(); self.x; super::f(); crate::g(); i32::MAX; a = true; b = false; Box<dyn Fn(i32) -> i32>; &mut x; a..=b; |x| x + 1; T::default()'
  );
  for (const mac of ['macro_rules', 'println', 'vec', 'assert_eq']) {
    assert.equal(exactColor(html, mac), distinctColor('function'), mac);
  }
  assert.equal(exactColor(html, '!'), distinctColor('operator'));
  assert.equal(exactColor(html, 'Self'), distinctColor('variable.special'));
  assert.equal(exactColor(html, 'new'), distinctColor('function.method'));
  assert.equal(exactColor(html, 'self'), distinctColor('variable.special'));
  // the first bare `x` is the field of `self.x`
  assert.equal(exactColor(html, 'x'), distinctColor('property'));
  for (const word of ['super', 'crate']) {
    assert.equal(exactColor(html, word), distinctColor('keyword.import'), word);
  }
  assert.equal(exactColor(html, 'MAX'), distinctColor('constant'));
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'Box'), distinctColor('type'));
  assert.equal(exactColor(html, 'dyn'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'Fn'), distinctColor('function'));
  assert.equal(exactColor(html, '..='), distinctColor('operator'));
  assert.equal(exactColor(html, 'default'), distinctColor('function.method'));
});

void t.test(
  'rust: raw strings, block comments, and attributes spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'rust',
      'let s = r#"a\nb"#;\n/* c\n /* d */\n */\n#[derive(\n  Debug\n)]\nstruct S;\n'
    );
  }
);
