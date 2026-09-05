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
} from './util';

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
  lexer = loadLang('graphql', '$hlGraphql');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/chamele.wat', import.meta.url);
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

/** The color of the first span containing `text`. */
function within(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.includes(text))?.color;
}

void t.test(
  'graphql: operations, selections, variables, directives, and fragments',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '# Get a user\nquery GetUser($id: ID!, $withPosts: Boolean = false) {\n  user(id: $id) {\n    name\n    ...UserFields @include(if: $withPosts)\n    posts(first: 10) { edges { node { title } } }\n    ... on Admin { level }\n  }\n}\n\nfragment UserFields on User { email }\nmutation { createUser(input: { name: "x", tags: [1, -2.5], ok: null }) { id } }',
      { theme: distinct }
    );
    assert.equal(within(html, '# Get a user'), distinctColor('comment'));
    assert.equal(exact(html, 'query'), distinctColor('keyword'));
    assert.equal(exact(html, 'GetUser'), distinctColor('function.definition'));
    assert.equal(exact(html, '$id'), distinctColor('variable'));
    assert.equal(exact(html, 'ID'), distinctColor('type.builtin'));
    assert.equal(exact(html, '!'), distinctColor('operator'));
    assert.equal(exact(html, 'false'), distinctColor('boolean'));
    assert.equal(exact(html, 'user'), distinctColor('function'));
    assert.equal(exact(html, 'id'), distinctColor('variable.parameter'));
    assert.equal(exact(html, 'name'), distinctColor('property'));
    assert.equal(exact(html, '...'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'UserFields'), distinctColor('function'));
    assert.equal(exact(html, '@include'), distinctColor('attribute'));
    assert.equal(exact(html, 'if'), distinctColor('variable.parameter'));
    assert.equal(exact(html, '10'), distinctColor('number'));
    assert.equal(exact(html, 'edges'), distinctColor('property'));
    assert.equal(exact(html, 'on'), distinctColor('keyword'));
    assert.equal(exact(html, 'Admin'), distinctColor('type'));
    assert.equal(exact(html, 'fragment'), distinctColor('keyword'));
    assert.equal(exact(html, 'mutation'), distinctColor('keyword'));
    assert.equal(exact(html, 'createUser'), distinctColor('function'));
    assert.equal(exact(html, 'input'), distinctColor('variable.parameter'));
    assert.equal(exact(html, '"x"'), distinctColor('string'));
    assert.equal(exact(html, '-2.5'), distinctColor('number'));
    assert.equal(exact(html, 'null'), distinctColor('constant.builtin'));
  }
);

void t.test(
  'graphql: schema definitions, descriptions, and enum values',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '"""\nA user\n"""\ntype User implements Node & Entity {\n  id: ID!\n  posts(first: Int = 10): [Post!]!\n  type: String\n}\nenum Role { ADMIN USER }\ninput NewUser { name: String! role: Role = USER }\ndirective @auth(role: Role = USER) repeatable on FIELD_DEFINITION | OBJECT\nscalar DateTime\nextend schema { query: Query }',
      { theme: distinct }
    );
    assert.equal(within(html, 'A user'), distinctColor('string'));
    assert.equal(exact(html, 'type'), distinctColor('keyword'));
    assert.equal(exact(html, 'User'), distinctColor('type'));
    assert.equal(exact(html, 'implements'), distinctColor('keyword'));
    assert.equal(exact(html, '&'), distinctColor('operator'));
    assert.equal(exact(html, 'posts'), distinctColor('function'));
    assert.equal(exact(html, 'first'), distinctColor('variable.parameter'));
    assert.equal(exact(html, 'Int'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'Post'), distinctColor('type'));
    // a field named `type` is not a keyword
    assert.equal(
      spansOf(html).filter((s) => s.text.trim() === 'type')[1]?.color,
      distinctColor('property')
    );
    assert.equal(exact(html, 'enum'), distinctColor('keyword'));
    assert.equal(within(html, 'ADMIN'), distinctColor('constant'));
    assert.equal(exact(html, 'input'), distinctColor('keyword'));
    assert.equal(exact(html, 'directive'), distinctColor('keyword'));
    assert.equal(exact(html, '@auth'), distinctColor('attribute'));
    assert.equal(within(html, 'repeatable'), distinctColor('keyword'));
    assert.equal(exact(html, 'FIELD_DEFINITION'), distinctColor('constant'));
    assert.equal(exact(html, '|'), distinctColor('operator'));
    assert.equal(exact(html, 'scalar'), distinctColor('keyword'));
    assert.equal(exact(html, 'DateTime'), distinctColor('type'));
    assert.equal(exact(html, 'extend schema'), distinctColor('keyword'));
    assert.equal(exact(html, 'query'), distinctColor('property'));
  }
);

void t.test('graphql: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '"unterminated',
    '"a\\',
    '"""',
    '"""x',
    '"""x\\"""',
    '$',
    '@',
    '.',
    '..',
    '...',
    '-',
    '-x',
    'é 日本語',
    'query',
    'type',
    ')',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('graphql: split ranges bound every lookahead', () => {
  const src =
    'query Q($a: Int) { f(a: $a) @d ...F } # c\n"""d"""\ntype T { x: [Int!]! }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('graphql', '$hlGraphql', split).hl, src);
  }
});

void t.test(
  'graphql: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('graphql: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x69a5b1;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('graphql: multi-line constructs resume line-fed', () => {
  for (const code of [
    '"""\ndoc\n"""\ntype A { x: Int }\n',
    'query Q(\n  $a: Int\n) { f(a: $a) }\n',
    'type T {\n  """\n  field doc\n  """\n  x: Int\n}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('graphql', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'graphql: type system definitions, descriptions, arguments, and extensions',
  () => {
    const html = distinctHl(
      'schema { query: Query mutation: Mutation subscription: Subscription }\n"""\nA user.\n"""\ntype User implements Node & Entity @key(fields: "id") {\n  "single line description"\n  id: ID!\n  name: String @deprecated(reason: "x")\n  posts(first: Int = 10, after: String, filter: PostFilter = { tag: "a" }): [Post!]!\n  score: Float\n  active: Boolean\n}\ninterface Node { id: ID! }\nunion SearchResult = User | Post\nenum Role { ADMIN EDITOR @deprecated }\ninput NewPost { title: String!, tags: [String!] = [] }\nscalar Date @specifiedBy(url: "https://x")\ndirective @auth(requires: Role = ADMIN) repeatable on FIELD_DEFINITION | OBJECT\nextend type User { extra: Int }\nextend schema @link(url: "x") { query: Q }'
    );
    for (const word of [
      'schema',
      'type',
      'implements',
      'interface',
      'union',
      'enum',
      'input',
      'scalar',
      'directive',
      'repeatable',
      'on',
      'extend',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const type of [
      'Query',
      'Mutation',
      'Subscription',
      'User',
      'Node',
      'Entity',
      'PostFilter',
      'Post',
      'SearchResult',
      'Role',
      'NewPost',
      'Date',
      'Q',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const type of ['ID', 'String', 'Int', 'Float', 'Boolean']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const attr of [
      '@key',
      '@deprecated',
      '@specifiedBy',
      '@auth',
      '@link',
    ]) {
      assert.equal(wordColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const param of [
      'fields',
      'reason',
      'first',
      'after',
      'filter',
      'tag',
      'url',
      'requires',
    ]) {
      assert.equal(
        wordColor(html, param),
        distinctColor('variable.parameter'),
        param
      );
    }
    for (const prop of [
      'query',
      'mutation',
      'subscription',
      'id',
      'name',
      'score',
      'active',
      'title',
      'tags',
      'extra',
    ]) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    assert.equal(wordColor(html, 'posts'), distinctColor('function'));
    for (const c of ['ADMIN', 'EDITOR', 'FIELD_DEFINITION', 'OBJECT']) {
      assert.equal(wordColor(html, c), distinctColor('constant'), c);
    }
    for (const s of [
      '"""',
      'A',
      'user.',
      '"id"',
      '"x"',
      '"a"',
      '"https://x"',
    ]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    assert.equal(
      exactColor(html, '"single line description"'),
      distinctColor('string')
    );
    for (const op of ['&', '!', '=', '|']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(wordColor(html, '10'), distinctColor('number'));
  }
);

void t.test(
  'graphql: spreads, inline fragments, directives on selections, and aliases',
  () => {
    assert.deepEqual(
      tokenKinds(
        'graphql',
        '{ user(id: $id) { ...UserFields ... on Admin { level } ... @include(if: $withPosts) { id } alias: name } }'
      ),
      [
        ['{', 'punctuation.bracket'],
        ['user', 'function'],
        ['(', 'punctuation.bracket'],
        ['id', 'variable.parameter'],
        [':', 'punctuation.delimiter'],
        ['$id', 'variable'],
        [') {', 'punctuation.bracket'],
        ['...', 'punctuation.special'],
        ['UserFields', 'function'],
        ['...', 'punctuation.special'],
        ['on', 'keyword'],
        ['Admin', 'type'],
        ['{', 'punctuation.bracket'],
        ['level', 'property'],
        ['}', 'punctuation.bracket'],
        ['...', 'punctuation.special'],
        ['@include', 'attribute'],
        ['(', 'punctuation.bracket'],
        ['if', 'variable.parameter'],
        [':', 'punctuation.delimiter'],
        ['$withPosts', 'variable'],
        [') {', 'punctuation.bracket'],
        ['id', 'property'],
        ['}', 'punctuation.bracket'],
        ['alias', 'property'],
        [':', 'punctuation.delimiter'],
        ['name', 'property'],
        ['} }', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test(
  'graphql: operations, variables with defaults, fragments, literals, and string escapes',
  () => {
    const html = distinctHl(
      'query GetUser($id: ID!, $withPosts: Boolean = false, $n: Int = 5) @cached(ttl: 60) {\n  user(ids: [1, 2], flags: { a: true, b: null }, ratio: 1.5, neg: -1, exp: 1e3, orderBy: { field: CREATED, dir: DESC }) { title __typename }\n}\nfragment UserFields on User { id name }\nmutation { createPost(input: { title: "Hi \\"q\\" \\u00e9", tags: ["a"] }) { id } }\nsubscription OnPost { postAdded { id } }\n{ shorthand }'
    );
    for (const word of [
      'query',
      'fragment',
      'on',
      'mutation',
      'subscription',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const fn of ['GetUser', 'UserFields', 'OnPost']) {
      assert.equal(
        wordColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const v of ['$id', '$withPosts', '$n']) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
    for (const fn of ['user', 'createPost']) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const param of [
      'ttl',
      'ids',
      'flags',
      'a',
      'b',
      'ratio',
      'neg',
      'exp',
      'orderBy',
      'field',
      'dir',
      'input',
    ]) {
      assert.equal(
        wordColor(html, param),
        distinctColor('variable.parameter'),
        param
      );
    }
    for (const prop of [
      'title',
      '__typename',
      'id',
      'name',
      'postAdded',
      'shorthand',
    ]) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    for (const n of ['5', '60', '1', '2', '1.5', '-1', '1e3']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    for (const b of ['false', 'true']) {
      assert.equal(wordColor(html, b), distinctColor('boolean'), b);
    }
    assert.equal(wordColor(html, 'null'), distinctColor('constant.builtin'));
    for (const c of ['CREATED', 'DESC']) {
      assert.equal(wordColor(html, c), distinctColor('constant'), c);
    }
    assert.equal(wordColor(html, '@cached'), distinctColor('attribute'));
    assert.equal(exactColor(html, '"Hi'), distinctColor('string'));
    assert.equal(exactColor(html, '\\"'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '\\u'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '"a"'), distinctColor('string'));
  }
);

void t.test('graphql: comments and block descriptions', () => {
  assert.deepEqual(
    tokenKinds(
      'graphql',
      '# comment\ntype T { # trailing\n  a: Int\n}\n"""\nblock\ndescription\n"""\nscalar S # tail'
    ),
    [
      ['# comment', 'comment'],
      ['type', 'keyword'],
      ['T', 'type'],
      ['{', 'punctuation.bracket'],
      ['# trailing', 'comment'],
      ['a', 'property'],
      [':', 'punctuation.delimiter'],
      ['Int', 'type.builtin'],
      ['}', 'punctuation.bracket'],
      ['"""', 'string'],
      ['block', 'string'],
      ['description', 'string'],
      ['"""', 'string'],
      ['scalar', 'keyword'],
      ['S', 'type'],
      ['# tail', 'comment'],
    ]
  );
});

void t.test(
  'graphql: block strings, argument lists, and selections stream line-fed',
  () => {
    assertLineFedParity(
      'graphql',
      '"""\nA user.\n"""\ntype User {\n  posts(\n    first: Int = 10,\n    filter: PostFilter = { tag: "a" }\n  ): [Post!]!\n}\nquery GetUser(\n  $id: ID!\n) {\n  user(id: $id) {\n    ... on Admin {\n      level\n    }\n  }\n}\n'
    );
  }
);
