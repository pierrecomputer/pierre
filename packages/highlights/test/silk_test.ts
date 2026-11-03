import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  distinctColor,
  distinctTheme,
  loadLang,
  makeRand,
  spansOf,
  type TestLang,
  textOf,
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('silk', '$hlSilk');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

/** The color of the first span whose trimmed text is exactly `word`. */
function exact(html: string, word: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

/** The color of the first span containing `text`. */
function within(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.includes(text))?.color;
}

/**
 * Tokens for `code` from the whole buffer and from a StreamTokenizer fed one
 * line per push, so a test can assert that a construct crossing line
 * boundaries resumes correctly.
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

void t.test('silk: declarations name the next word', () => {
  const html = distinctHl(
    'pub struct Point { x: f64 }\nunion Shape { Circle, Square }\nservice Clock {}\ninterface Show {}\nrole Reader {}\ntype Id = u32\npub effect fn area(shape: Shape) -> f64 {}\nimpl Show for Point {}\nlet mut total = 0\nparam N: usize'
  );
  for (const word of ['struct', 'union', 'service', 'interface', 'role']) {
    assert.equal(
      within(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  for (const type of ['Point', 'Shape', 'Clock', 'Show', 'Reader', 'Id']) {
    assert.equal(exact(html, type), distinctColor('type'), type);
  }
  assert.equal(exact(html, 'area'), distinctColor('function.definition'));
  assert.equal(exact(html, 'shape'), distinctColor('variable.parameter'));
  assert.equal(exact(html, 'x'), distinctColor('property'));
  // `mut` keeps the binding capture for the name after it
  assert.equal(exact(html, 'total'), distinctColor('variable'));
  assert.equal(exact(html, 'N'), distinctColor('variable'));
  for (const type of ['f64', 'u32', 'usize']) {
    assert.equal(exact(html, type), distinctColor('type.builtin'), type);
  }
});

void t.test('silk: control flow, effects, and contextual words', () => {
  const html = distinctHl(
    'fn f<T>(xs: List<T>) -> T ? Error where T: Copy {\n  for x in xs { if x { break } else { continue } }\n  while true { run tick() }\n  match x { Kind.A => fail Error.Bad {}, _ => return self }\n  let n = typeof(x)\n  drop(move x)\n}'
  );
  for (const word of [
    'for',
    'if',
    'break',
    'else',
    'continue',
    'while',
    'run',
    'match',
    'fail',
    'return',
  ]) {
    assert.equal(exact(html, word), distinctColor('keyword.control'), word);
  }
  for (const word of ['where', 'in', 'typeof', 'drop', 'move']) {
    assert.equal(exact(html, word), distinctColor('keyword'), word);
  }
  assert.equal(exact(html, 'true'), distinctColor('boolean'));
  assert.equal(exact(html, 'self'), distinctColor('variable.special'));
  assert.equal(exact(html, 'tick'), distinctColor('function'));
  assert.equal(exact(html, 'Kind'), distinctColor('type'));
  assert.equal(exact(html, 'A'), distinctColor('constructor'));
  assert.equal(exact(html, 'Bad'), distinctColor('constructor'));
  assert.equal(exact(html, '=>'), distinctColor('operator'));
});

void t.test('silk: imports, members, directives, and lifetimes', () => {
  const html = distinctHl(
    "import silk.core.option {Option}\nimport lexer.span as sp\n@inline\nfn get('a, v: &'a View) -> u8 {\n  v.items.len() + v.inner.count + pair.0\n}\nconst MAX_LEN = 4"
  );
  assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
  assert.equal(exact(html, 'as'), distinctColor('keyword.import'));
  for (const ns of ['silk', 'core', 'option', 'lexer', 'span', 'sp']) {
    assert.equal(exact(html, ns), distinctColor('namespace'), ns);
  }
  assert.equal(exact(html, 'Option'), distinctColor('type'));
  assert.equal(exact(html, '@inline'), distinctColor('attribute'));
  assert.equal(exact(html, "'a"), distinctColor('label'));
  assert.equal(exact(html, 'items'), distinctColor('property'));
  assert.equal(exact(html, 'len'), distinctColor('function.method'));
  assert.equal(exact(html, 'count'), distinctColor('property'));
  assert.equal(exact(html, '0'), distinctColor('number'));
  assert.equal(exact(html, 'MAX_LEN'), distinctColor('constant'));
});

void t.test('silk: comments, strings, characters, and numbers', () => {
  const html = distinctHl(
    '//! module\n/// item\n//// plain\n// note\nlet a = "x\\n"\nlet b = b"\\x00"\nlet r = r"C:\\dir"\nlet c = \'\\t\'\nlet d = \'é\'\nlet m = """\n  one "two"\n  """\nlet n = 0xff_ff + 1_000 + 2.5e3 + 1h30m'
  );
  assert.equal(within(html, '//! module'), distinctColor('comment.doc'));
  assert.equal(within(html, '/// item'), distinctColor('comment.doc'));
  assert.equal(within(html, '//// plain'), distinctColor('comment'));
  assert.equal(within(html, '// note'), distinctColor('comment'));
  assert.equal(exact(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exact(html, '\\x'), distinctColor('string.escape'));
  assert.equal(exact(html, 'b"'), distinctColor('string'));
  // raw strings keep backslashes as text
  assert.equal(exact(html, 'r"C:\\dir"'), distinctColor('string'));
  assert.equal(exact(html, '\\t'), distinctColor('string.escape'));
  assert.equal(exact(html, "'é'"), distinctColor('string'));
  assert.equal(within(html, 'one "two"'), distinctColor('string'));
  for (const n of ['0xff_ff', '1_000', '2.5e3', '1h30m']) {
    assert.equal(exact(html, n), distinctColor('number'), n);
  }
});

void t.test('silk: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '//',
    '"unterminated',
    '"""open',
    'r"""open',
    'b"',
    "'",
    "'\\",
    "'a",
    '@',
    '#',
    '0x',
    '.',
    '...',
    'import',
    'import a.',
    'fn',
    '\u00e9 \u65e5\u672c\u8a9e',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('silk: split ranges bound every lookahead', () => {
  const src = 'x// t\nlet s = """a\\"""b""" + r"q" + \'c\' + \'a';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('silk', '$hlSilk', split).hl, src);
  }
});

void t.test(
  'silk: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(0x66, 0x6e, 0x20, 0xf0, 0x28, 0x8c, 0x28, 0xff);
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('silk: deterministic fuzz preserves lexer invariants', () => {
  const rand = makeRand(0x5111c);
  const alphabet = 'abrXYZ09_ /\\"\'\n\t{}[]().,:;+-*=!<>&|#@%~?\u00e9';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('silk: multi-line strings resume line-fed', () => {
  for (const code of [
    'let s = """\none\ntwo"""\nlet x = 1\n',
    'let s = r"""\nC:\\dir\n"""\nlet x = 1\n',
    'let s = """\nescaped \\"""\nstill"""\nlet x = 1\n',
    'let b = b"""\nbytes\n"""\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('silk', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
