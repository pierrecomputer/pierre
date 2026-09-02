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

let kotlin: TestLang;
t.before(() => {
  kotlin = loadLang('kotlin', '$hlKotlin');
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

void t.test('kotlin: declarations, control flow, types, and functions', () => {
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

void t.test('kotlin: nested comments and documentation buckets', () => {
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

void t.test(
  'kotlin: quoted and triple strings expose escapes and templates',
  () => {
    const src =
      'val a = "hello $name \\n ${value}"; val b = """raw $name\n${value}"""; val c = \'\\u263a\'';
    const html = checkInvariants(kotlin.hl, src);
    assert.equal(colorOf(html, '$name'), themeColor('variable'));
    assert.equal(colorOf(html, '${'), themeColor('punctuation.special'));
    assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
    assert.equal(colorOf(html, '"""raw '), themeColor('string'));
    assert.equal(colorOf(html, String.raw`\u`), themeColor('string.escape'));
  }
);

void t.test(
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

void t.test('kotlin: malformed constructs stay total and lossless', () => {
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

void t.test(
  'kotlin: split ranges bound templates, comments, and lookahead',
  () => {
    const src =
      '/* a /* b */ c */ "hello $name ${value}\\n" """raw\n$name""" @Jvm obj?.call()';
    const size = new TextEncoder().encode(src).length;
    for (let split = 0; split <= size; split++)
      checkInvariants(loadLang('kotlin', '$hlKotlin', split).hl, src);
  }
);

void t.test(
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

void t.test('kotlin: deterministic fuzz preserves lexer invariants', () => {
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

void t.test(
  'kotlin: template expressions lex nested strings and braces',
  () => {
    // distinct colors: Pierre Dark shares one between keywords and `${`
    const theme = {
      name: 'kotlin-templates',
      appearance: 'dark',
      style: {
        syntax: {
          string: { color: '#111111' },
          'punctuation.special': { color: '#222222' },
          variable: { color: '#333333' },
          keyword: { color: '#444444' },
        },
      },
    };
    const html = checkInvariants(
      kotlin.hl,
      'val s = "${map["key"]} end"; val t = "${if (x) "a" else "b"}"; ' +
        'val u = """${list.map { it }} $c"""',
      { theme }
    );
    const spans = spansOf(html);
    const texts = (color: string) =>
      spans.filter((s) => s.color === color).map((s) => s.text);
    assert.deepEqual(texts('#222222'), ['${', '}', '${', '}', '${', '}']);
    assert.deepEqual(texts('#111111'), [
      '"',
      '"key"',
      ' end"',
      '"',
      '"a" ',
      '"b"',
      '"',
      '"""',
      ' ',
      '"""',
    ]);
    assert.equal(colorOf(html, 'map'), '#333333');
    assert.equal(colorOf(html, 'if'), '#444444');
    assert.equal(colorOf(html, 'it'), '#333333');
    assert.equal(colorOf(html, '$c'), '#333333');
  }
);

void t.test('kotlin: template expressions resume line-fed', () => {
  for (const code of [
    'val s = "${\nmap["key"]\n} end $x"\nval t = 2\n',
    'val s = """${\nx\n}\n$y\n"""\nval t = 2\n',
    'val s = "${ "${x}" } ${y}"\nval t = 2\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('kotlin', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
    assert.equal(whole.at(-2)?.[0].color, themeColor('keyword.declaration'));
  }
});

void t.test('kotlin: escaped line breaks continue a string line-fed', () => {
  for (const nl of ['\n', '\r\n']) {
    const code = `val s = "abc\\${nl}def $x \\n"${nl}val z = 1${nl}`;
    const [whole, streamed] = wholeAndLineFed('kotlin', code);
    assert.deepEqual(streamed, whole, JSON.stringify(nl));
    // the continuation is still string, with its template lexed
    const line = whole[1];
    assert.equal(line[0].content, 'def ');
    assert.equal(line[0].color, themeColor('string'));
    assert.equal(line[1].content, '$x');
    assert.equal(line[1].color, themeColor('variable'));
    assert.equal(whole[2][0].color, themeColor('keyword.declaration'));
  }
});

void t.test('kotlin: strings without templates lex in linear time', () => {
  // the `$` search is bounded by the string, not by the rest of the file:
  // 20k template-free strings used to rescan the remaining input each
  const line = 'val s = "hello world"';
  const code = Array.from({ length: 20000 }, () => line).join('\n') + '\n';
  const start = performance.now();
  const { tokens } = codeToTokens(code, { lang: 'kotlin', theme: pierreDark });
  const elapsed = performance.now() - start;
  assert.equal(tokens.length, 20001);
  assert.equal(tokens[19999][3].color, themeColor('string'));
  assert.ok(elapsed < 100, `took ${elapsed} ms`);
});

void t.test('kotlin: fun heads keep the name past type parameters', () => {
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    kotlin.hl,
    'fun <T> foo(x: T) {}\n' +
      'fun <T : Comparable<T>> List<T>.max(): T? = null\n' +
      'fun Foo?.bar() {}\n' +
      'class Box<T>(val v: T)'
  );
  assert.equal(word(html, 'foo'), themeColor('function.definition'));
  assert.equal(word(html, 'max'), themeColor('function.definition'));
  assert.equal(word(html, 'bar'), themeColor('function.definition'));
  for (const name of ['T', 'Comparable', 'List', 'Foo', 'Box']) {
    assert.equal(word(html, name), themeColor('type'), name);
  }
});

void t.test('kotlin: modifier and declaration keywords', () => {
  const html = checkInvariants(
    kotlin.hl,
    'companion lateinit const init by inner operator infix vararg reified ' +
      'out where while Short'
  );
  const KEYWORD = themeColor('keyword');
  for (const w of [
    'companion',
    'lateinit',
    'const',
    'by',
    'inner',
    'operator',
    'infix',
    'vararg',
    'reified',
    'out',
    'where',
  ]) {
    assert.equal(colorOf(html, w), KEYWORD, w);
  }
  assert.equal(colorOf(html, 'init'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'while'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'Short'), themeColor('type.builtin'));
});

void t.test('kotlin: an operator run stops at a comment opener', () => {
  const html = checkInvariants(kotlin.hl, 'i++//c\nj--/*d*/ k');
  const spans = spansOf(html);
  assert.equal(
    spans.find((s) => s.text === '++')?.color,
    themeColor('operator')
  );
  assert.equal(colorOf(html, '//c'), themeColor('comment'));
  assert.equal(
    spans.find((s) => s.text === '--')?.color,
    themeColor('operator')
  );
  assert.equal(colorOf(html, '/*d*/'), themeColor('comment'));
  assert.equal(colorOf(html, 'k'), themeColor('variable'));
});

void t.test('kotlin: nested comments at even depth match line-fed', () => {
  const code = '/* /* a\nb\n*/ */\nc\n';
  const [whole, streamed] = wholeAndLineFed('kotlin', code);
  assert.deepEqual(streamed, whole);
  assert.equal(whole[2][0].color, themeColor('comment'));
  assert.equal(whole[3][0].color, themeColor('variable'));
});
