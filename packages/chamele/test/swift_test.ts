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

let swift: TestLang;
t.before(() => {
  swift = loadLang('swift', '$hlSwift');
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

void t.test('swift: declarations, control flow, types, and functions', () => {
  const src = `import Foundation
protocol Show { func show() -> Bool }
struct Box { let value: Int }
func main() { if true { return } else { throw Error.bad } }`;
  const html = checkInvariants(swift.hl, src);
  assert.equal(colorOf(html, 'import'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'protocol'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'Show'), themeColor('type'));
  assert.equal(colorOf(html, 'show'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'Int'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
});

void t.test('swift: nested comments and documentation buckets', () => {
  const src =
    '// plain\n/// docs\n/* outer /* nested */ end */\n/** block docs */';
  const theme = {
    name: 'swift-comments',
    appearance: 'dark',
    style: {
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const html = checkInvariants(swift.hl, src, { theme });
  assert.equal(colorOf(html, '// plain'), '#111111');
  assert.equal(colorOf(html, '/// docs'), '#222222');
  assert.equal(colorOf(html, '/** block docs */'), '#222222');
});

void t.test('swift: ordinary, multiline, raw, and interpolated strings', () => {
  const src = String.raw`let a = "hello \(name)\n"; let b = #"raw \#(name)"#; let c = """multi
line"""; let d = ##"""raw
text"""##`;
  const html = checkInvariants(swift.hl, src);
  assert.equal(
    colorOf(html, String.raw`\(`),
    themeColor('punctuation.special')
  );
  assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
  assert.equal(colorOf(html, '#"raw \\#(name)"#'), themeColor('string'));
  assert.equal(colorOf(html, '"""multi\nline"""'), themeColor('string'));
});

void t.test('swift: interpolation lexes nested call expressions', () => {
  // Not String.raw: Bun's transpiler rewrites non-ASCII (²) in template
  // literals to \u escapes, which String.raw keeps as six literal characters.
  const src =
    'print("distance² = \\(origin.distanceSquared(to: Point(x: 3, y: 4)))")';
  const theme = {
    name: 'swift-interpolation',
    appearance: 'dark',
    style: {
      syntax: {
        string: { color: '#111111' },
        'punctuation.special': { color: '#222222' },
        variable: { color: '#333333' },
        function: { color: '#444444' },
        'function.method': { color: '#555555' },
        number: { color: '#666666' },
      },
    },
  };
  const html = checkInvariants(swift.hl, src, { theme });
  assert.equal(colorOf(html, '"distance² = '), '#111111');
  assert.equal(colorOf(html, String.raw`\(`), '#222222');
  assert.equal(colorOf(html, 'origin'), '#333333');
  assert.equal(colorOf(html, 'distanceSquared'), '#555555');
  assert.equal(colorOf(html, 'Point'), '#444444');
  assert.equal(colorOf(html, '3'), '#666666');
  assert.deepEqual(
    spansOf(html)
      .filter(({ color }) => color === '#222222')
      .map(({ text }) => text),
    [String.raw`\(`, ')']
  );
});

void t.test(
  'swift: attributes, directives, members, constants, and operators',
  () => {
    const src =
      '@available(iOS 18, *) #if DEBUG\nobj.field = obj.call(MAX_VALUE) ?? nil\n#endif';
    const html = checkInvariants(swift.hl, src);
    assert.equal(colorOf(html, '@available'), themeColor('attribute'));
    assert.equal(colorOf(html, '#if'), themeColor('preproc'));
    assert.equal(colorOf(html, 'field'), themeColor('property'));
    assert.equal(colorOf(html, 'call'), themeColor('function.method'));
    assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
    assert.equal(colorOf(html, '??'), themeColor('operator'));
    assert.equal(colorOf(html, 'nil'), themeColor('constant.builtin'));
  }
);

void t.test('swift: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/* outer /* inner',
    '"unterminated',
    String.raw`"unterminated \(call(nested(`,
    '"""open',
    '###"raw',
    '@',
    '#',
    '#if',
    '0x_',
    'é 日本語',
  ]) {
    checkInvariants(swift.hl, src);
  }
});

void t.test('swift: split ranges bound nested and hash-delimited scans', () => {
  const src = String.raw`/* a /* b */ c */ ##"raw"## """multi
line""" "value \(outer(inner()))" @available #if obj.call()`;
  const size = new TextEncoder().encode(src).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('swift', '$hlSwift', split).hl, src);
});

void t.test(
  'swift: malformed UTF-8 remains balanced and lossless after decoding',
  () => {
    const bytes = Uint8Array.of(0x40, 0x61, 0x20, 0xf0, 0x28, 0x8c, 0x28, 0xff);
    const html = swift.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('swift: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x5a17;
  const alphabet = 'abcXYZ09_#@ /\\"\'\n\t{}[]().,:;+-*=!?<>&|é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(swift.hl, src);
  }
});

void t.test('swift: parameters match Zed variable.parameter', () => {
  const PARAM = themeColor('variable.parameter');
  const VARIABLE = themeColor('variable');
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    swift.hl,
    'func greet(person: String, from hometown: String) -> String { hometown }\n' +
      'func f<T: Codable>(_ value: T, count: Int = 1) {}\n' +
      'class C { init(id: Int) {} }\n' +
      'greet(person: "x", from: "y"); print(alpha, beta)'
  );
  // Zed captures both the external label and the internal name; the merged
  // same-color span carries the label-name pair
  assert.equal(word(html, 'person'), PARAM);
  assert.equal(word(html, 'from hometown'), PARAM);
  assert.equal(word(html, 'value'), PARAM);
  assert.equal(word(html, 'count'), PARAM);
  assert.equal(word(html, 'id'), PARAM);
  // call-site labels and arguments stay plain
  for (const name of ['alpha', 'beta']) {
    assert.equal(word(html, name), VARIABLE, name);
  }
});

void t.test('swift: modifier, control, and declaration keywords', () => {
  const html = checkInvariants(
    swift.hl,
    'static private public internal fileprivate open override final ' +
      'mutating throws rethrows some any lazy weak unowned inout where ' +
      'do default defer deinit subscript while'
  );
  const KEYWORD = themeColor('keyword');
  for (const w of ['static', 'fileprivate', 'mutating', 'rethrows', 'where']) {
    assert.equal(colorOf(html, w), KEYWORD, w);
  }
  for (const w of ['do', 'default', 'defer', 'while']) {
    assert.equal(colorOf(html, w), themeColor('keyword.control'), w);
  }
  for (const w of ['deinit', 'subscript']) {
    assert.equal(colorOf(html, w), themeColor('keyword.declaration'), w);
  }
});

void t.test('swift: an operator run stops at a comment opener', () => {
  const html = checkInvariants(swift.hl, 'i++//c\nj--/*d*/ k');
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

void t.test('swift: hash-delimited bodies close on the full delimiter', () => {
  const html = checkInvariants(swift.hl, '#"a "b" c"# x ##"""d"""#e"""## y');
  assert.equal(colorOf(html, '#"a "b" c"#'), themeColor('string'));
  assert.equal(colorOf(html, '##"""d"""#e"""##'), themeColor('string'));
  assert.equal(colorOf(html, 'x'), themeColor('variable'));
  assert.equal(colorOf(html, 'y'), themeColor('variable'));
});

void t.test('swift: hash strings resume line-fed for any hash count', () => {
  const probe = 'func main() { let x: Int = 1 }\n';
  const before = codeToTokens(probe, { lang: 'swift', theme: pierreDark });
  for (const hashes of [0, 1, 29, 30, 31, 40, 300, 5000]) {
    const h = '#'.repeat(hashes);
    for (const quotes of hashes === 0 ? ['"""'] : ['"', '"""']) {
      // the body holds a near miss: one hash short, or `""` for `"""`
      const miss = hashes === 0 ? quotes.slice(1) : quotes + h.slice(1);
      const code =
        `let s = ${h}${quotes}one\n${miss}two${quotes}${h}\n` + 'let x = 1\n';
      const [whole, streamed] = wholeAndLineFed('swift', code);
      assert.deepEqual(streamed, whole, `${hashes} hashes ${quotes}`);
      assert.equal(whole[1][0].color, themeColor('string'));
      assert.equal(whole[2][0].color, themeColor('keyword.declaration'));
    }
  }
  // long hash runs never spill past the stream delimiter into lexer state
  assert.deepEqual(
    codeToTokens(probe, { lang: 'swift', theme: pierreDark }),
    before
  );
});

void t.test('swift: escaped line breaks continue a string line-fed', () => {
  for (const nl of ['\n', '\r\n']) {
    const code = `let s = "abc\\${nl}def \\(x) \\n"${nl}let z = 1${nl}`;
    const [whole, streamed] = wholeAndLineFed('swift', code);
    assert.deepEqual(streamed, whole, JSON.stringify(nl));
    // the continuation is still string, with its interpolation lexed
    const line = whole[1];
    assert.equal(line[0].content, 'def ');
    assert.equal(line[0].color, themeColor('string'));
    assert.equal(line[1].color, themeColor('punctuation.special'));
    assert.equal(whole[2][0].color, themeColor('keyword.declaration'));
  }
});

void t.test('swift: nested comments at even depth match line-fed', () => {
  const code = '/* /* a\nb\n*/ */\nc\n';
  const [whole, streamed] = wholeAndLineFed('swift', code);
  assert.deepEqual(streamed, whole);
  assert.equal(whole[2][0].color, themeColor('comment'));
  assert.equal(whole[3][0].color, themeColor('variable'));
});
