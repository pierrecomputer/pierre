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

let swift;
t.before(() => (swift = loadLang('swift', '$hlSwift')));

t.test('swift: declarations, control flow, types, and functions', () => {
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

t.test('swift: nested comments and documentation buckets', () => {
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

t.test('swift: ordinary, multiline, raw, and interpolated strings', () => {
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

t.test('swift: interpolation lexes nested call expressions', () => {
  const src = String.raw`print("distance² = \(origin.distanceSquared(to: Point(x: 3, y: 4)))")`;
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

t.test(
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

t.test('swift: malformed constructs stay total and lossless', () => {
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

t.test('swift: split ranges bound nested and hash-delimited scans', () => {
  const src = String.raw`/* a /* b */ c */ ##"raw"## """multi
line""" "value \(outer(inner()))" @available #if obj.call()`;
  const size = new TextEncoder().encode(src).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('swift', '$hlSwift', split).hl, src);
});

t.test(
  'swift: malformed UTF-8 remains balanced and lossless after decoding',
  () => {
    const bytes = Uint8Array.of(0x40, 0x61, 0x20, 0xf0, 0x28, 0x8c, 0x28, 0xff);
    const html = swift.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

t.test('swift: deterministic fuzz preserves lexer invariants', () => {
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
