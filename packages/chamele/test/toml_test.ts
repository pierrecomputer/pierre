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

let toml: TestLang;
t.before(() => (toml = loadLang('toml', '$hlToml')));

void t.test(
  'toml: assignment, dotted, quoted, header, and inline-table keys',
  () => {
    const src = `title = "chamele"
physical.color = "orange"
site."google.com" = true
[owner.profile]
name = "Ada"
point = { x = 1, "y axis" = 2 }
[[products]]
sku = 738594937
`;
    const html = checkInvariants(toml.hl, src);
    for (const key of [
      'title',
      'physical',
      'color',
      '"google.com"',
      'owner',
      'profile',
      'x',
      '"y axis"',
      'products',
    ]) {
      assert.equal(colorOf(html, key), themeColor('property'), key);
    }
    assert.equal(colorOf(html, '='), themeColor('operator'));
  }
);

void t.test('toml: only space/tab and LF/CRLF drive record state', () => {
  const src =
    'first\t = 1\r\nsecond = 2 # comment\r\nthird = 3\rbad = 4\nafter = 5';
  const html = checkInvariants(toml.hl, src);
  for (const key of ['first', 'second', 'third', 'after']) {
    assert.equal(colorOf(html, key), themeColor('property'), key);
  }
  assert.equal(colorOf(html, 'bad'), undefined);
  assert.equal(colorOf(html, '# comment'), themeColor('comment'));
});

void t.test(
  'toml: numbers, special floats, booleans, and date/time values',
  () => {
    const src = `int = -17
hex = 0xdead_beef
octal = 0o755
binary = 0b1101_0010
float = 6.626e-34
large = 1_234.5_6E+7_8
infinity = +inf
not_number = nan
enabled = true
disabled = false
offset = 1979-05-27T07:32:00.999999-07:00
lowercase = 1979-05-27t07:32:00z
local_date = 1979-05-27
local_time = 07:32:00
short_time = 07:32
spaced = 1979-05-27 07:32:00Z
short_spaced = 1979-05-27 07:32Z
`;
    const html = checkInvariants(toml.hl, src);
    for (const value of [
      '-17',
      '0xdead_beef',
      '0o755',
      '0b1101_0010',
      '6.626e-34',
      '1_234.5_6E+7_8',
      '+inf',
      'nan',
    ]) {
      assert.equal(colorOf(html, value), themeColor('number'), value);
    }
    for (const value of ['true', 'false']) {
      assert.equal(colorOf(html, value), themeColor('constant'), value);
    }
    for (const value of [
      '1979-05-27T07:32:00.999999-07:00',
      '1979-05-27t07:32:00z',
      '1979-05-27',
      '07:32:00',
      '07:32',
    ]) {
      assert.equal(colorOf(html, value), themeColor('string.special'), value);
    }
    assert.equal(
      colorOf(html, '1979-05-27 07:32:00Z'),
      themeColor('string.special')
    );
    assert.equal(
      colorOf(html, '1979-05-27 07:32Z'),
      themeColor('string.special')
    );
  }
);

void t.test('toml: atom scanners stop at the grammar boundary', () => {
  const src = `suffix = 123abc
hex_suffix = 0xF?tail
bool_suffix = trueish
float_suffix = infinitude
date_gap = 1979-05-27 # comment
date_padded = 1980-06-28${'   '}
date_array = [1981-07-29 , 1982-08-30]
leap = 2024-02-29
bad_leap = 2023-02-29
bad_day = 2024-04-31
bad_month = 2024-13-01
bad_time = 24:00
bad_offset = 1979-05-27T07:32:00+24:00
`;
  const html = checkInvariants(toml.hl, src);
  assert.equal(colorOf(html, '123'), themeColor('number'));
  assert.equal(colorOf(html, '123abc'), undefined);
  assert.equal(colorOf(html, '0xF'), themeColor('number'));
  assert.equal(colorOf(html, '0xF?tail'), undefined);
  assert.equal(colorOf(html, 'trueish'), undefined);
  assert.equal(colorOf(html, 'infinitude'), undefined);
  for (const value of [
    '1979-05-27',
    '1980-06-28',
    '1981-07-29',
    '1982-08-30',
    '2024-02-29',
  ]) {
    assert.equal(colorOf(html, value), themeColor('string.special'), value);
  }
  for (const value of [
    '2023-02-29',
    '2024-04-31',
    '2024-13-01',
    '24:00',
    '1979-05-27T07:32:00+24:00',
  ]) {
    assert.notEqual(colorOf(html, value), themeColor('string.special'), value);
  }
});

void t.test('toml: all four string forms and basic-string escapes', () => {
  const src = String.raw`basic = "a\n\e\xE9\u0041\U0001F600"
invalid = "\q\xF\u12\U1234"
literal = 'C:\Users\name'
multiline = """
The quick brown \
  fox says \"hi\".
"""
raw = '''one ' and '' two
C:\raw
'''
`;
  const html = checkInvariants(toml.hl, src);
  assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
  assert.equal(colorOf(html, String.raw`\e`), themeColor('string.escape'));
  assert.equal(colorOf(html, String.raw`\xE9`), themeColor('string.escape'));
  assert.equal(colorOf(html, String.raw`\u0041`), themeColor('string.escape'));
  assert.equal(
    colorOf(html, String.raw`\U0001F600`),
    themeColor('string.escape')
  );
  assert.equal(
    colorOf(html, String.raw`\q\xF\u12\U1234`),
    themeColor('string')
  );
  assert.equal(
    colorOf(html, String.raw`'C:\Users\name'`),
    themeColor('string')
  );
  assert.equal(colorOf(html, 'The quick brown'), themeColor('string'));
  assert.equal(colorOf(html, 'C:\\raw'), themeColor('string'));
});

void t.test(
  'toml: multiline escaped newlines include indentation and blank lines',
  () => {
    const continuation = '\\ \t\r\n \n\t';
    const src = `continued = """one ${continuation}two"""
broken = "one\\
next = 1
`;
    const html = checkInvariants(toml.hl, src);
    assert.equal(colorOf(html, continuation), themeColor('string.escape'));
    assert.equal(colorOf(html, 'next'), themeColor('property'));
  }
);

void t.test('toml: arrays, nested arrays, punctuation, and comments', () => {
  const src = `values = [1, [2, 3], { name = "four", tags = ["a", "b"] }]
# full line
tail = 1 # trailing
`;
  const html = checkInvariants(toml.hl, src);
  assert.equal(colorOf(html, '['), themeColor('punctuation.bracket'));
  assert.equal(colorOf(html, ','), themeColor('punctuation.delimiter'));
  assert.equal(colorOf(html, 'name'), themeColor('property'));
  assert.equal(colorOf(html, 'tags'), themeColor('property'));
  assert.equal(colorOf(html, '# full line'), themeColor('comment'));
  assert.equal(colorOf(html, '# trailing'), themeColor('comment'));
});

void t.test(
  'toml: nested inline containers restore the right key context',
  () => {
    const src = `nested = { inner = { a = 1, b = 2 }, tail = 3 }
mixed = { rows = [{ a = 1, b = 2 }], tail = 3 }
`;
    const html = checkInvariants(toml.hl, src);
    for (const key of ['b', 'tail']) {
      assert.equal(colorOf(html, key), themeColor('property'), key);
    }
  }
);

void t.test(
  'toml: multiline inline tables and deep container stacks preserve key context',
  () => {
    const multiline = `point = {
  x = 1,
  # TOML 1.1 permits comments here
  y = 2,
}
`;
    let value = '0';
    const tails = [];
    for (let depth = 0; depth < 96; depth++) {
      if ((depth & 1) !== 0) value = `[${value}]`;
      else {
        tails.push(`tail_${depth}`);
        value = `{ inner = ${value}, tail_${depth} = ${depth} }`;
      }
    }
    const html = checkInvariants(toml.hl, multiline + `deep = ${value}\n`);
    for (const key of ['x', 'y', ...tails]) {
      assert.equal(colorOf(html, key), themeColor('property'), key);
    }
    checkInvariants(
      toml.hl,
      `deep = ${'['.repeat(1100)}0${']'.repeat(1100)}\n`
    );
    assert.equal(
      colorOf(checkInvariants(toml.hl, 'value = { a = 1, b = 2 }'), 'b'),
      themeColor('property')
    );
  }
);

void t.test(
  'toml: malformed constructs and every byte split stay lossless',
  () => {
    for (const src of [
      '',
      '#',
      'key =',
      'key = "unterminated',
      "key = '''unterminated",
      '[table',
      'array = [[1]',
      'value = 0xF?tail',
      'date = 1979-05-27 07:32:00Z',
      'value = """a\\  \r\n \n b"""',
      'é = 日本語',
      'key = "\\é',
    ])
      checkInvariants(toml.hl, src);

    const src =
      'date = 1979-05-27 07:32:00Z\nkey = "a\\u0041é" # tail\nnext = 2';
    const size = new TextEncoder().encode(src).length;
    for (let split = 0; split <= size; split++) {
      checkInvariants(loadLang('toml', '$hlToml', split).hl, src);
    }
  }
);

void t.test(
  'toml: malformed UTF-8 and deterministic fuzz preserve invariants',
  () => {
    const bytes = Uint8Array.of(
      0x6b,
      0x20,
      0x3d,
      0x20,
      0x22,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x22,
      0xff
    );
    const html = toml.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);

    let state = 0x74_6f_6d_6c;
    const alphabet = 'abcXYZ09_- #=.,\'\\"\n\r\t[]{}:+é';
    for (let sample = 0; sample < 160; sample++) {
      let src = '';
      for (let n = state & 63; n-- !== 0; ) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        src += alphabet[state % alphabet.length];
      }
      checkInvariants(toml.hl, src);
    }
  }
);
