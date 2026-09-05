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
  distinctTheme,
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
  lexer = loadLang('java', '$hlJava');
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test('java: packages and imports, including static imports', () => {
  assert.deepEqual(
    tokenKinds(
      'java',
      'package com.example;\nimport java.util.List;\nimport static java.lang.Math.max;'
    ),
    [
      ['package', 'keyword.declaration'],
      ['com', 'namespace'],
      ['.', 'punctuation.delimiter'],
      ['example', 'namespace'],
      [';', 'punctuation.delimiter'],
      ['import', 'keyword.import'],
      ['java', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['util', 'property'],
      ['.', 'punctuation.delimiter'],
      ['List', 'type'],
      [';', 'punctuation.delimiter'],
      ['import', 'keyword.import'],
      ['static', 'keyword.declaration'],
      ['java', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['lang', 'property'],
      ['.', 'punctuation.delimiter'],
      ['Math', 'type'],
      ['.', 'punctuation.delimiter'],
      ['max', 'property'],
      [';', 'punctuation.delimiter'],
    ]
  );
});

void t.test(
  'java: class heads, modifiers, members, interfaces, enums, and records',
  () => {
    const html = distinctHl(
      'public abstract class A<T extends B> implements C, D { private static final int MAX = 0xFF; protected volatile transient long n = 1_000L; @Override public synchronized void run() throws E { } }\ninterface I { void f(); } enum Color { RED, GREEN } record P(int x, int y) {}'
    );
    for (const word of [
      'public',
      'abstract',
      'class',
      'extends',
      'implements',
      'private',
      'static',
      'final',
      'protected',
      'volatile',
      'transient',
      'synchronized',
      'throws',
      'interface',
      'enum',
      'record',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of ['A', 'B', 'C', 'D', 'E', 'I', 'Color', 'P']) {
      assert.equal(exactColor(html, type), distinctColor('type'), type);
    }
    for (const c of ['MAX', 'RED', 'GREEN']) {
      assert.equal(exactColor(html, c), distinctColor('constant'), c);
    }
    assert.equal(exactColor(html, '@Override'), distinctColor('attribute'));
    for (const fn of ['run', 'f']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const type of ['int', 'long', 'void']) {
      assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
    }
    assert.equal(exactColor(html, '0xFF'), distinctColor('number'));
    assert.equal(exactColor(html, '1_000L'), distinctColor('number'));
  }
);

void t.test('java: numeric, char, string, and text-block literals', () => {
  const html = distinctHl(
    'int x = 0x1F + 0b101 + 017 + 1_000 + 1e3f + 2.5d + \'a\' + \'\\n\'; String s = "esc\\t" + """\ntext\n"""; boolean b = true; Object o = null;'
  );
  for (const n of ['0x1F', '0b101', '017', '1_000', '1e3f', '2.5d']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, "'a'"), distinctColor('string'));
  assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '"esc'), distinctColor('string'));
  assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '"""\ntext\n"""'), distinctColor('string'));
  assert.equal(exactColor(html, 'String'), distinctColor('type'));
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
});

void t.test(
  'java: control flow, exceptions, switch arrows, and object creation',
  () => {
    const html = distinctHl(
      'for (int i = 0; i < n; i++) { if (a && b || !c) break; else continue; } while (x) {} do {} while (false); switch (k) { case 1 -> f(); default -> {} } try { throw new E(); } catch (E | F e) {} finally {} return; assert x; var v = new int[3]; this.x; super.f(); yield; x instanceof Y;'
    );
    for (const word of [
      'for',
      'if',
      'break',
      'else',
      'continue',
      'while',
      'do',
      'switch',
      'case',
      'default',
      'try',
      'throw',
      'catch',
      'finally',
      'return',
      'assert',
      'yield',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of ['new', 'instanceof']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.operator'),
        word
      );
    }
    assert.equal(exactColor(html, 'var'), distinctColor('keyword.declaration'));
    for (const word of ['this', 'super']) {
      assert.equal(
        exactColor(html, word),
        distinctColor('variable.special'),
        word
      );
    }
    for (const op of ['->', '|', '++', '&&', '||', '!']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('java: comment forms, including javadoc', () => {
  assert.deepEqual(
    tokenKinds(
      'java',
      '// line\n/* block */\n/** javadoc\n * @param x\n */\nclass X {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/* block */', 'comment'],
      ['/** javadoc', 'comment.doc'],
      ['* @param x', 'comment.doc'],
      ['*/', 'comment.doc'],
      ['class', 'keyword.declaration'],
      ['X', 'type'],
      ['{}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'java: streams, method references, lambdas, arrays, and members',
  () => {
    assert.deepEqual(
      tokenKinds(
        'java',
        'names = items.stream().map(Object::toString).filter(s -> s != null); int[] arr = {1, 2}; arr.length; obj.field.sub;'
      ),
      [
        ['names', 'variable'],
        ['=', 'operator'],
        ['items', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['stream', 'function.method'],
        ['()', 'punctuation.bracket'],
        ['.', 'punctuation.delimiter'],
        ['map', 'function.method'],
        ['(', 'punctuation.bracket'],
        ['Object', 'type'],
        ['::', 'punctuation.delimiter'],
        ['toString', 'property'],
        [')', 'punctuation.bracket'],
        ['.', 'punctuation.delimiter'],
        ['filter', 'function.method'],
        ['(', 'punctuation.bracket'],
        ['s', 'variable'],
        ['->', 'operator'],
        ['s', 'variable'],
        ['!=', 'operator'],
        ['null', 'constant.builtin'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['int', 'type.builtin'],
        ['[]', 'punctuation.bracket'],
        ['arr', 'variable'],
        ['=', 'operator'],
        ['{', 'punctuation.bracket'],
        ['1', 'number'],
        [',', 'punctuation.delimiter'],
        ['2', 'number'],
        ['}', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['arr', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['length', 'property'],
        [';', 'punctuation.delimiter'],
        ['obj', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['field', 'property'],
        ['.', 'punctuation.delimiter'],
        ['sub', 'property'],
        [';', 'punctuation.delimiter'],
      ]
    );
  }
);

void t.test(
  'java: text blocks and javadoc spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'java',
      'String s = """\n  a\n  b""";\n/**\n * doc\n */\nclass X {}\n'
    );
  }
);
