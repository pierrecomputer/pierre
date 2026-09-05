import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
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
