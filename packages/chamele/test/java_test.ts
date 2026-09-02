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
  lexer = loadLang('java', '$hlJava');
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

void t.test('java: declarations, control flow, types, and members', () => {
  const html = checkInvariants(
    lexer.hl,
    'package demo.app;\nimport java.util.List;\n@Override\npublic class Box<T> implements Show {\n  private static final int MAX = 1;\n  public static void main(String[] args) { List<int[]> xs = new ArrayList<>(); if (xs.size() > MAX) return; }\n  Runnable r = Box::main;\n}',
    { theme: distinct }
  );
  assert.equal(exact(html, 'package'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'demo'), distinctColor('namespace'));
  assert.equal(exact(html, 'app'), distinctColor('namespace'));
  assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
  assert.equal(exact(html, '@Override'), distinctColor('attribute'));
  assert.equal(exact(html, 'Box'), distinctColor('type'));
  assert.equal(exact(html, 'MAX'), distinctColor('constant'));
  assert.equal(exact(html, 'void'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'main'), distinctColor('function.definition'));
  assert.equal(exact(html, 'args'), distinctColor('variable'));
  assert.equal(exact(html, 'size'), distinctColor('function.method'));
  assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'new'), distinctColor('keyword.operator'));
  assert.equal(exact(html, 'String'), distinctColor('type'));
});

void t.test('java: text blocks, strings, chars, numbers, and comments', () => {
  const html = checkInvariants(
    lexer.hl,
    'String s = """\n  hi \\""" there\n  """; char c = \'\\n\'; long n = 1_000L + 0xFF; // note\n/** doc */ /* plain */',
    { theme: distinct }
  );
  assert.equal(within(html, 'hi '), distinctColor('string'));
  assert.equal(within(html, '\\"'), distinctColor('string.escape'));
  assert.equal(exact(html, '1_000L'), distinctColor('number'));
  assert.equal(exact(html, '0xFF'), distinctColor('number'));
  assert.equal(within(html, '// note'), distinctColor('comment'));
  assert.equal(within(html, '/** doc */'), distinctColor('comment.doc'));
  assert.equal(within(html, '/* plain */'), distinctColor('comment'));
});

void t.test('java: malformed constructs stay total and lossless', () => {
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
    '"""',
    '"""open\nstill',
    'class',
    '@',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('java: split ranges bound every lookahead', () => {
  const src = 'x// tail\nString s = """a\nb"""; obj.m(0xff);';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('java', '$hlJava', split).hl, src);
  }
});

void t.test(
  'java: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('java: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('java: multi-line constructs resume line-fed', () => {
  for (const code of [
    'String s = """\n  one\n  two""";\nint x;\n',
    'int a = 1; /* open\nstill */\nint b;\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('java', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
