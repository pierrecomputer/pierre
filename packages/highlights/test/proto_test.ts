import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './_util';

// one unique color per token type so equal styles cannot merge neighboring
// spans and hide a classification behind a same-colored token
const distinct = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(
      tokenTypes
        .filter((name) => !['background', 'foreground', 'none'].includes(name))
        .map((name, i) => [name, '#' + (0x100000 + i * 0x101).toString(16)])
    ),
  },
} as unknown as Theme;

/** The distinct theme's color for a token type name. */
function distinctColor(name: string): string {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  return distinct.style.syntax?.[name] as string;
}

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('proto', '$hlProto');
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

/** The color of the first span whose trimmed text is exactly `word`. */
function exact(html: string, word: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

void t.test('proto: declarations, fields, options, and services', () => {
  const html = checkInvariants(
    lexer.hl,
    'syntax = "proto3";\npackage demo.api.v1;\nimport public "x.proto";\noption java_package = "com.demo";\nmessage User {\n  reserved 2, 15 to 20;\n  string name = 1 [deprecated = true];\n  repeated .google.protobuf.Any items = 3;\n  map<string, int64> counts = 4;\n  oneof kind { Address addr = 5; required int32 legacy = 6; }\n  enum Role { ROLE_UNSPECIFIED = 0; }\n}\nservice Users { rpc Get(GetRequest) returns (stream User); }',
    { theme: distinct }
  );
  assert.equal(exact(html, 'syntax'), distinctColor('keyword'));
  assert.equal(exact(html, 'package'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'demo'), distinctColor('namespace'));
  assert.equal(exact(html, 'v1'), distinctColor('namespace'));
  assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
  assert.equal(exact(html, 'public'), distinctColor('keyword'));
  assert.equal(exact(html, 'java_package'), distinctColor('property'));
  assert.equal(exact(html, 'message'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'User'), distinctColor('type'));
  assert.equal(exact(html, 'reserved'), distinctColor('keyword'));
  assert.equal(exact(html, 'to'), distinctColor('keyword'));
  assert.equal(exact(html, 'string'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'name'), distinctColor('property'));
  assert.equal(exact(html, 'deprecated'), distinctColor('property'));
  assert.equal(exact(html, 'true'), distinctColor('boolean'));
  assert.equal(exact(html, 'repeated'), distinctColor('keyword'));
  assert.equal(exact(html, 'google'), distinctColor('namespace'));
  assert.equal(exact(html, 'Any'), distinctColor('type'));
  assert.equal(exact(html, 'map'), distinctColor('keyword'));
  assert.equal(exact(html, 'required'), distinctColor('keyword'));
  assert.equal(exact(html, 'ROLE_UNSPECIFIED'), distinctColor('constant'));
  assert.equal(exact(html, 'service'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'rpc'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'Get'), distinctColor('function.definition'));
  assert.equal(exact(html, 'stream'), distinctColor('keyword'));
});

void t.test('proto: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '0x_',
    '\u00e9 \u65e5\u672c\u8a9e',
    '#',
    '@',
    '${',
    '#{',
    '<<',
    '%',
    'message',
    '/*',
    '= -',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('proto: split ranges bound every lookahead', () => {
  const src = 'x// tail\nmessage A { /* c\nd */ int32 x = 1; }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('proto', '$hlProto', split).hl, src);
  }
});

void t.test(
  'proto: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x66,
      0x6f,
      0x6f,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x20,
      0xff
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('proto: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?\u00e9';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('proto: multi-line constructs resume line-fed', () => {
  for (const code of [
    'message A { /* open\nstill */ int32 x = 1; }\n',
    'message A {\n  string s = 1;\n}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('proto', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'proto: syntax, edition, package, import modifiers, and file options',
  () => {
    const html = distinctHl(
      'syntax = "proto3";\nedition = "2023";\npackage shop.v1;\nimport "google/protobuf/timestamp.proto";\nimport public "x.proto";\nimport weak "y.proto";\noption java_package = "com.example.shop";\noption (custom.opt) = true;\noption optimize_for = SPEED;'
    );
    for (const word of ['syntax', 'edition', 'option', 'public', 'weak']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    assert.equal(
      wordColor(html, 'package'),
      distinctColor('keyword.declaration')
    );
    assert.equal(wordColor(html, 'import'), distinctColor('keyword.import'));
    for (const ns of ['shop', 'v1', 'custom', 'opt']) {
      assert.equal(exactColor(html, ns), distinctColor('namespace'), ns);
    }
    for (const s of [
      '"proto3"',
      '"2023"',
      '"google/protobuf/timestamp.proto"',
      '"x.proto"',
      '"y.proto"',
      '"com.example.shop"',
    ]) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const prop of ['java_package', 'optimize_for']) {
      assert.equal(exactColor(html, prop), distinctColor('property'), prop);
    }
    assert.equal(exactColor(html, 'SPEED'), distinctColor('constant'));
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    assert.equal(wordColor(html, '='), distinctColor('operator'));
  }
);

void t.test(
  'proto: messages, field labels, options, maps, oneofs, enums, nesting, groups, and services',
  () => {
    const html = distinctHl(
      'message Item {\n  option deprecated = true;\n  reserved 7, 8 to 10, 15 to max;\n  reserved "foo", "bar";\n  optional string name = 1 [json_name = "n", (custom) = 1];\n  required int32 id = 2;\n  repeated string tags = 3 [packed = true];\n  map<string, int32> counts = 4;\n  oneof kind { Physical physical = 5; Digital digital = 6; }\n  enum Status { option allow_alias = true; STATUS_UNSPECIFIED = 0; ACTIVE = 1; ALIVE = 1; }\n  message Nested { bool ok = 1; bytes raw = 2; double d = 3; float f = 4; int64 i64 = 5; uint32 u = 6; uint64 u64 = 7; sint32 s = 8; sint64 s64 = 9; fixed32 f32 = 10; fixed64 f64 = 11; sfixed32 sf = 12; sfixed64 sf64 = 13; }\n  google.protobuf.Timestamp created = 9;\n  .shop.v1.Other other = 10;\n  extensions 100 to 199;\n  group Result = 11 { optional string url = 12; }\n  Nested nested = 14;\n}\nextend Item { optional int32 extra = 100; }\nservice Shop {\n  rpc GetItem(GetItemRequest) returns (Item);\n  rpc Watch(stream Item) returns (stream Item);\n}'
    );
    for (const word of ['message', 'enum', 'extend', 'service', 'rpc']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const word of [
      'option',
      'reserved',
      'to',
      'max',
      'optional',
      'required',
      'repeated',
      'map',
      'oneof',
      'extensions',
      'group',
      'returns',
      'stream',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const type of [
      'Item',
      'Physical',
      'Digital',
      'Status',
      'Nested',
      'Timestamp',
      'Other',
      'GetItemRequest',
      'Shop',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const type of [
      'string',
      'int32',
      'bool',
      'bytes',
      'double',
      'float',
      'int64',
      'uint32',
      'uint64',
      'sint32',
      'sint64',
      'fixed32',
      'fixed64',
      'sfixed32',
      'sfixed64',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const prop of [
      'deprecated',
      'name',
      'json_name',
      'id',
      'tags',
      'packed',
      'counts',
      'physical',
      'digital',
      'allow_alias',
      'ok',
      'raw',
      'created',
      'other',
      'url',
      'nested',
      'extra',
      'Result',
    ]) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    for (const c of ['STATUS_UNSPECIFIED', 'ACTIVE', 'ALIVE']) {
      assert.equal(wordColor(html, c), distinctColor('constant'), c);
    }
    for (const fn of ['GetItem', 'Watch']) {
      assert.equal(
        wordColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const ns of ['google', 'protobuf', 'shop', 'v1']) {
      assert.equal(wordColor(html, ns), distinctColor('namespace'), ns);
    }
    assert.equal(wordColor(html, 'kind'), distinctColor('variable'));
    for (const s of ['"foo"', '"bar"', '"n"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const n of ['7', '8', '10', '15', '100', '199']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
  }
);

void t.test(
  'proto: numeric forms, string escapes, booleans, and comments',
  () => {
    const html = distinctHl(
      'x = 0x1F + 0777 + 1_000 + 1e3 + 2.5 + -3 + 0b1; b = true; f = false;'
    );
    for (const n of ['0x1F', '0777', '1_000', '1e3', '2.5', '-3', '0b1']) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
    assert.deepEqual(
      tokenKinds(
        'proto',
        "s = \"esc\\t\\n\" + 'single \\'q\\''; // line\n/* block\n */ message A {} // tail"
      ),
      [
        ['s', 'property'],
        ['=', 'operator'],
        ['"esc', 'string'],
        ['\\t\\n', 'string.escape'],
        ['"', 'string'],
        ['+', null],
        ["'single", 'string'],
        ["\\'", 'string.escape'],
        ['q', 'string'],
        ["\\'", 'string.escape'],
        ["'", 'string'],
        [';', 'punctuation.delimiter'],
        ['// line', 'comment'],
        ['/* block', 'comment'],
        ['*/', 'comment'],
        ['message', 'keyword.declaration'],
        ['A', 'type'],
        ['{}', 'punctuation.bracket'],
        ['// tail', 'comment'],
      ]
    );
  }
);

void t.test(
  'proto: nested definitions and block comments stream line-fed',
  () => {
    assertLineFedParity(
      'proto',
      'syntax = "proto3";\n/* block\n */\nmessage Item {\n  oneof kind {\n    Physical physical = 5;\n  }\n  map<string, int32> counts = 4 [\n    deprecated = true\n  ];\n}\nservice Shop {\n  rpc Watch(stream Item) returns (stream Item);\n}\n'
    );
  }
);
