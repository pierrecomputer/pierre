import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
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

let cpp: TestLang;
t.before(() => {
  cpp = loadLang('cpp', '$hlCpp');
  const url = new URL('../src/chamele.wat', import.meta.url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, transformWat(url).code)));
});

/**
 * Tokens from the full module for a whole-buffer run and for a stream fed
 * one line per chunk, the shape the live tokenizer uses; both must agree.
 */
function lineFed(code: string): {
  direct: ThemedToken[][];
  streamed: ThemedToken[][];
} {
  const options = { lang: 'cpp' as const, theme: pierreDark };
  const direct = codeToTokens(code, options).tokens;
  const stream = new TokenizeStream(options);
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return { direct, streamed };
}

const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const CONTROL = themeColor('keyword.control');
const DECL = themeColor('keyword.declaration');
const TYPE = themeColor('type.builtin');
const FUNCTION = themeColor('function');
const PROPERTY = themeColor('property');
const OPERATOR = themeColor('operator');
const PUNCT = themeColor('punctuation.bracket');

void t.test('cpp: comments, documentation comments, and directives', () => {
  const src = `#include <vector>
# include "detail/item.hpp"
#define SUM(a, b) \\
  ((a) + (b))
/// line docs
/** block docs */
// line
  /* block */`;
  const html = checkInvariants(cpp.hl, src);
  assert.equal(colorOf(html, '#include'), PREPROC);
  assert.equal(colorOf(html, '<vector>'), STRING);
  assert.equal(colorOf(html, '"detail/item.hpp"'), STRING);
  assert.equal(colorOf(html, '#define SUM'), PREPROC);
  for (const text of [
    '/// line docs',
    '/** block docs */',
    '// line',
    '/* block */',
  ]) {
    assert.equal(colorOf(html, text), COMMENT, text);
  }
});

void t.test('cpp: ordinary, prefixed, character, and raw literals', () => {
  const src = `auto s = u8"a\\n\\u0041\\x42";
auto c = L'\\123';
auto r = u8R"tag(raw \\n+text )tag"sv;`;
  const html = checkInvariants(cpp.hl, src);
  assert.equal(colorOf(html, 'u8"a'), STRING);
  for (const escape of ['\\n', '\\u0041', '\\x42', '\\123']) {
    assert.equal(colorOf(html, escape), ESCAPE, escape);
  }
  assert.equal(colorOf(html, "L'"), NUMBER);
  assert.equal(colorOf(html, 'u8R"tag(raw'), STRING);
  const raw = spansOf(html).find((span) => span.text.includes('u8R"tag('));
  assert.ok(raw?.text.includes('\\n') === true && raw.color === STRING);
});

void t.test(
  'cpp: numbers include radix, separators, exponents, and suffixes',
  () => {
    const src = "0xffu 0b1010'0011 1.2e-3f 0x1.fp+2 .5 42_km";
    const html = checkInvariants(cpp.hl, src);
    for (const number of [
      '0xffu',
      "0b1010'0011",
      '1.2e-3f',
      '0x1.fp+2',
      '.5',
      '42_km',
    ]) {
      assert.equal(colorOf(html, number), NUMBER, number);
    }
  }
);

void t.test('cpp: keywords, types, functions, members, and constants', () => {
  const src = `template <typename T>
namespace demo { demo::Widget item; }
class Box {
 public:
  constexpr bool ok() const noexcept { return true and not false; }
};
int main() { std::vector<int> xs; obj.field = ptr->method(MAX_VALUE); }`;
  const html = checkInvariants(cpp.hl, src);
  assert.equal(colorOf(html, 'template'), DECL);
  assert.equal(colorOf(html, 'demo'), themeColor('namespace'));
  assert.equal(colorOf(html, 'class'), DECL);
  assert.equal(colorOf(html, 'bool'), TYPE);
  assert.equal(colorOf(html, 'return'), CONTROL);
  assert.equal(colorOf(html, 'main'), FUNCTION);
  assert.equal(colorOf(html, 'method'), FUNCTION);
  assert.equal(colorOf(html, 'field'), PROPERTY);
  assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
});

void t.test('cpp: typeid is a keyword and a lone capital is a type', () => {
  const html = checkInvariants(
    cpp.hl,
    'template <typename T> T max(T a, T b) { return typeid(a) == typeid(b) ? a : b; }'
  );
  assert.equal(colorOf(html, 'typeid'), themeColor('keyword'));
  const exact = (text: string) =>
    spansOf(html).find((span) => span.text.trim() === text)?.color;
  assert.equal(exact('T'), themeColor('type'));
  assert.equal(exact('max'), FUNCTION);
});

void t.test(
  'cpp: operators, scope/member access, delimiters, and brackets',
  () => {
    const src =
      'ns::Type::value->field += (a <=> b) && arr[i] != 0; obj.*member; f(...);';
    const html = checkInvariants(cpp.hl, src);
    for (const op of ['->', '+=', '<=>', '&&', '!=', '.*', '...']) {
      assert.equal(colorOf(html, op), OPERATOR, op);
    }
    assert.equal(colorOf(html, 'field'), PROPERTY);
    assert.equal(colorOf(html, '('), PUNCT);
    assert.equal(colorOf(html, '['), PUNCT);
  }
);

void t.test('cpp: labels, booleans, nullptr, this, and module words', () => {
  const src =
    'export module demo; start: if (this == nullptr) goto start; bool yes = true;';
  const html = checkInvariants(cpp.hl, src);
  assert.equal(colorOf(html, 'export'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'start'), themeColor('label'));
  assert.equal(colorOf(html, 'this'), themeColor('variable.special'));
  assert.equal(colorOf(html, 'nullptr'), themeColor('constant.builtin'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
});

void t.test('cpp: malformed constructs remain total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// no newline',
    '"unterminated',
    "'\\",
    'R"tag(unclosed',
    'R"0123456789abcdefg(x)',
    '#define X \\',
    '#include <unterminated',
    '"\\é',
    'é 日本語',
    "0x'p+",
    '[[nodiscard]',
  ]) {
    checkInvariants(cpp.hl, src);
  }
});

void t.test('cpp: every lookahead respects split scan ranges', () => {
  checkInvariants(loadLang('cpp', '$hlCpp', 2).hl, 'x//tail\n');
  checkInvariants(loadLang('cpp', '$hlCpp', 2).hl, 'R"tag(x)tag"');
  checkInvariants(loadLang('cpp', '$hlCpp', 7).hl, 'auto "x\\ny";');
  const include = '# include <é/path.hpp>';
  const size = new TextEncoder().encode(include).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('cpp', '$hlCpp', split).hl, include);
});

void t.test('cpp: long SIMD literal and comment scans', () => {
  const src = `/* ${'comment '.repeat(200)}*/\nR"d(${'raw text '.repeat(300)})d"\n"${'text'.repeat(500)}"`;
  checkInvariants(cpp.hl, src);
});

void t.test(
  'cpp: backslash-continued directives and literals resume across lines',
  () => {
    // Whole-buffer: the continuation line stays inside the directive and
    // the literal, and a `#` after a resumed literal is not a directive.
    const html = checkInvariants(
      cpp.hl,
      '#define X \\\n  foo(1)\ns = "abc\\\ndef" # x;\nint y;\n'
    );
    assert.equal(colorOf(html, 'foo(1)'), PREPROC);
    assert.equal(colorOf(html, 'def"'), STRING);
    assert.equal(colorOf(html, '#'), PREPROC);
    assert.equal(
      spansOf(html).find((span) => span.text.includes('# '))?.color,
      OPERATOR
    );
    // Line-fed streaming must checkpoint each open construct at the chunk
    // end and produce the whole-buffer tokens.
    for (const code of [
      '#define X \\\n  foo(1)\nint y;\n',
      '#define X \\\r\n  foo(1) \\\r\n  bar(2)\r\nint y;\r\n',
      '#define X \\\n\nint y;\n',
      '#include \\\n<foo.h>\nint z;\n',
      's = "abc\\\ndef" # x;\nint y;\n',
      's = "abc\\\r\ndef"\r\nz = 1\r\n',
      's = "abc\\\n\\x41\\u0042\\101def"sv;\nz = 1\n',
      "c = 'a\\\n';\nz = 1\n",
      'x = "abc\\\ndef\nz = 1\n',
      'int x; /* a\nb */ #define Y 1\nint z;\n',
      '/* a\nb */ #define Y 1\nint z;\n',
    ]) {
      const { direct, streamed } = lineFed(code);
      assert.deepEqual(streamed, direct, JSON.stringify(code));
    }
  }
);

void t.test('cpp: a single long line highlights in linear time', () => {
  // The beginning-of-line check once rescanned the rest of the line for
  // every token, which made one 500 KB line take seconds.
  const unit = 'int x = foo(a, b) + 1; ';
  const src = unit.repeat(Math.ceil(500_000 / unit.length));
  const started = performance.now();
  const html = cpp.hl(src);
  const elapsed = performance.now() - started;
  assert.equal(textOf(html), src);
  assert.ok(elapsed < 1000, `one long line took ${elapsed.toFixed(0)}ms`);
});
