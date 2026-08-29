import assert from 'node:assert';
import t from 'node:test';

import {
  bodyOf,
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  textOf,
  themeColor,
} from './util.mjs';

let json = null;

t.before(() => {
  json = loadLang('json', '$hlJson');
});

// pierre-dark colors resolved from themes/pierre-dark.json (see themeColor)
const BG = themeColor('background');
const FG = themeColor('foreground');
const KEY = themeColor('property.json_key'); // -> property
const STR = themeColor('string');
const NUM = themeColor('number');
const BOOL = themeColor('boolean');
const CONST = themeColor('constant.builtin'); // -> constant
const ESC = themeColor('string.escape');
const COMMENT = themeColor('comment');

void t.test('json: wrapper carries the theme background and foreground', () => {
  const html = json.hl('1');
  assert.ok(
    html.startsWith(
      `<pre class="chamele" style="background-color:${BG};color:${FG}"><code>`
    ) === true
  );
  assert.match(html, /<\/code><\/pre>$/);
});

void t.test('json: empty input', () => {
  assert.equal(
    json.hl(''),
    `<pre class="chamele" style="background-color:${BG};color:${FG}"><code></code></pre>`
  );
});

void t.test(
  'json: accepts byte inputs and rejects unsupported input types',
  () => {
    const bytes = Uint8Array.of(91, 49, 93); // [1]
    assert.equal(textOf(json.hl(bytes)), '[1]');
    assert.equal(textOf(json.hl(bytes.buffer)), '[1]');
    for (const input of [null, undefined, 1, {}, [], new Uint16Array(1)]) {
      assert.throws(() => json.hl(input), TypeError);
    }
  }
);

void t.test('json: object keys are property, values are string', () => {
  const html = checkInvariants(json.hl, '{"key": "value"}');
  assert.equal(colorOf(html, '"key"'), KEY);
  assert.equal(colorOf(html, '"value"'), STR);
});

void t.test('json: literals', () => {
  const html = checkInvariants(json.hl, '[1, -2.5e3, true, false, null]');
  assert.equal(colorOf(html, '1'), NUM);
  assert.equal(colorOf(html, '-2.5e3'), NUM);
  assert.equal(colorOf(html, 'true'), BOOL);
  assert.equal(colorOf(html, 'null'), CONST);
});

void t.test('json: nested containers key context', () => {
  const html = checkInvariants(
    json.hl,
    '{"a": [ {"b": 1}, "s" ], "c": {"d": [2]}}'
  );
  const spans = spansOf(html);
  for (const key of ['"a"', '"b"', '"c"', '"d"']) {
    assert.equal(spans.find((s) => s.text.trim() === key)?.color, KEY, key);
  }
  assert.equal(spans.find((s) => s.text.trim() === '"s"')?.color, STR);
});

void t.test('json: top-level and array strings are not keys', () => {
  assert.equal(colorOf(checkInvariants(json.hl, '"top"'), '"top"'), STR);
  assert.equal(colorOf(checkInvariants(json.hl, '["a", "b"]'), '"a"'), STR);
});

void t.test('json: escapes get string.escape spans inside strings', () => {
  const html = checkInvariants(json.hl, '{"a": "x\\n\\u0041y"}');
  assert.equal(colorOf(html, '\\n'), ESC);
  assert.equal(colorOf(html, '\\u0041'), ESC);
});

void t.test('json: a short \\u escape never swallows the closing quote', () => {
  const html = checkInvariants(json.hl, '{"a":"\\u12","b":2}');
  const spans = spansOf(html);
  assert.equal(spans.find((s) => s.text.trim() === '\\u12')?.color, ESC);
  // quote parity survives: the next key is still a key, the number a number
  assert.equal(spans.find((s) => s.text.trim() === '"b"')?.color, KEY);
  assert.equal(spans.find((s) => s.text.trim() === '2')?.color, NUM);
});

void t.test('json: escape spans never split a UTF-8 code point', () => {
  // a backslash directly before a multi-byte char: the whole char must stay
  // inside the escape span or the output is no longer valid UTF-8
  for (const src of ['"a\\éb"', '"\\日本語"', '"\\u12é"', '"x\\']) {
    checkInvariants(json.hl, src);
  }
});

void t.test('json: html-special bytes are escaped', () => {
  const html = checkInvariants(json.hl, '{"<&>": "a<b>&c"}');
  assert.ok(bodyOf(html).includes('&lt;&amp;&gt;'));
  // stripping the span tags and known entities must leave no raw special byte
  const leftover = bodyOf(html)
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/&(lt|gt|amp);/g, '');
  assert.ok(!/[<>&]/.test(leftover), `raw special byte leaked: ${leftover}`);
});

void t.test('json: JSONC comments', () => {
  const html = checkInvariants(
    json.hl,
    '{\n  // line\n  "a": 1 /* block\n  more */\n}'
  );
  assert.equal(colorOf(html, '// line'), COMMENT);
  assert.equal(colorOf(html, '/* block'), COMMENT);
});

void t.test('json: comment lookahead does not cross $end', () => {
  const prefix = 'a/';
  const ranged = loadLang('json', '$hlJson', prefix.length);
  const html = checkInvariants(ranged.hl, prefix + '/b');
  assert.equal(colorOf(html, '/'), colorOf(json.hl(prefix), '/'));
});

void t.test('json: adjacent same-color tokens merge into one span', () => {
  const html = json.hl('[[]]');
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].text, '[[]]');
});

void t.test('json: lenient on malformed input, still lossless', () => {
  for (const src of [
    '{',
    '}',
    '{"a: 1}',
    '"unterminated',
    'tru',
    'nullx',
    '0x12zz@#!',
    '{"a" "b" : 1,: ,}',
    'éé { "kéy": "vál" }',
    '/',
    '/* unterminated',
    '// no newline',
    '"esc at end \\',
    '"\\u12',
    '[1,2,]]]',
  ]) {
    checkInvariants(json.hl, src);
  }
});

void t.test('json: large input with long clean runs (SIMD paths)', () => {
  const big = JSON.stringify(
    {
      data: Array.from({ length: 200 }, (_, i) => ({
        id: i,
        name: 'n'.repeat(50) + i,
        ok: i % 2 === 0,
      })),
    },
    null,
    2
  );
  const html = checkInvariants(json.hl, big);
  assert.ok(html.length > big.length);
});

void t.test('json: unthemed types produce no span', () => {
  const theme = {
    name: 'min',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { string: '#00ff00' },
    },
  };
  // property/number/punctuation resolve to nothing: no spans at all
  const bare = json.hl('{"a": 1}', { theme });
  assert.equal(spansOf(bare).length, 0);
  assert.equal(textOf(bare), '{"a": 1}');
  // only the value string gets a span
  const html = json.hl('{"a": "v"}', { theme });
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].color, '#00ff00');
});

void t.test('json: Zed-style theme objects with {color} values work', () => {
  const theme = {
    name: 'obj',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { string: { color: '#123456' } },
    },
  };
  assert.equal(colorOf(json.hl('["x"]', { theme }), '"x"'), '#123456');
});

void t.test(
  'json: colors normalize to lowercase hex, alpha kept only when not opaque',
  () => {
    const theme = {
      name: 'alpha',
      appearance: 'dark',
      style: {
        background: '#0A0A0A80',
        foreground: '#FAFAFA',
        syntax: { string: '#12345680', number: '#ABCDEFFF' },
      },
    };
    const html = json.hl('["x", 1]', { theme });
    assert.match(
      html,
      /^<pre class="chamele" style="background-color:#0a0a0a80;color:#fafafa">/
    );
    assert.equal(colorOf(html, '"x"'), '#12345680');
    assert.equal(colorOf(html, '1'), '#abcdef'); // ff alpha drops
  }
);

void t.test(
  'json: font_style/font_weight emit font attributes and split merging',
  () => {
    const theme = {
      name: 'fonts',
      appearance: 'dark',
      style: {
        background: '#000000',
        foreground: '#ffffff',
        syntax: {
          string: { color: '#aabbcc', font_style: 'italic', font_weight: 700 },
          number: { color: '#aabbcc' },
          boolean: { color: '#ddeeff', font_weight: 400 },
        },
      },
    };
    const html = json.hl('["x", 1, true]', { theme });
    const spans = spansOf(html);
    const str = spans.find((s) => s.text.includes('"x"'));
    assert.equal(str.color, '#aabbcc');
    assert.equal(str.font, ';font-style:italic;font-weight:700');
    const num = spans.find((s) => s.text.includes('1'));
    assert.equal(num.color, '#aabbcc');
    assert.equal(num.font, '');
    // same color but different font: the spans must not merge
    assert.ok(!str.text.includes('1'));
    assert.equal(
      spans.find((s) => s.text.includes('true')).font,
      ';font-weight:400'
    );
  }
);

void t.test('json: theme fallback walks capture-name dots', () => {
  const theme = {
    name: 'fb',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { string: '#0000ff', constant: '#ff0000' },
    },
  };
  const html = json.hl('["\\n", null]', { theme });
  assert.equal(colorOf(html, '\\n'), '#0000ff'); // string.escape -> string
  assert.equal(colorOf(html, 'null'), '#ff0000'); // constant.builtin -> constant
});

void t.test('json: a raw Zed theme-family file works unconverted', () => {
  // the shape a Zed extension ships: family wrapper, `text` +
  // `editor.background` style keys, {color} syntax values
  const family = {
    name: 'Fam',
    author: 'someone',
    themes: [
      {
        name: 'Fam Dark',
        appearance: 'dark',
        style: {
          background: '#111111',
          'editor.background': '#222222',
          text: '#eeeeee',
          syntax: { string: { color: '#aabbcc', font_style: 'italic' } },
        },
      },
    ],
  };
  const html = json.hl('["x"]', { theme: family });
  assert.match(html, /background-color:#222222;color:#eeeeee/);
  assert.equal(colorOf(html, '"x"'), '#aabbcc');
});
