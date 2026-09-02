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
  lexer = loadLang('csharp', '$hlCsharp');
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

void t.test('csharp: declarations, control flow, types, and members', () => {
  const html = checkInvariants(
    lexer.hl,
    'using System.Text;\nnamespace Demo.App;\n[Obsolete]\npublic sealed record Box<T>(T Value) where T : notnull\n{\n  private const int MAX = 1;\n  public static async Task<int> RunAsync(string? name) { if (name is null) return MAX; Console.WriteLine(name); return await Task.FromResult(1); }\n}',
    { theme: distinct }
  );
  assert.equal(exact(html, 'using'), distinctColor('keyword.import'));
  assert.equal(exact(html, 'System'), distinctColor('namespace'));
  assert.equal(exact(html, 'namespace'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'Demo'), distinctColor('namespace'));
  assert.equal(exact(html, 'Obsolete'), distinctColor('attribute'));
  assert.equal(exact(html, 'Box'), distinctColor('type'));
  assert.equal(exact(html, 'where'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'MAX'), distinctColor('constant'));
  assert.equal(exact(html, 'RunAsync'), distinctColor('function.definition'));
  assert.equal(exact(html, 'string'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'is'), distinctColor('keyword.operator'));
  assert.equal(exact(html, 'WriteLine'), distinctColor('function.method'));
  assert.equal(exact(html, 'Console'), distinctColor('type'));
});

void t.test(
  'csharp: interpolated, verbatim, and raw strings, chars, numbers, and preprocessor lines',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '#region x\nvar a = $"hi {name} {{lit}}"; var b = @"C:\\p ""q""\nsecond"; var c = """\n raw "t"\n """; var d = \'x\'; var n = 1_000UL + 0b11;\n/// doc\n// plain',
      { theme: distinct }
    );
    assert.equal(within(html, '#region'), distinctColor('preproc'));
    assert.equal(within(html, 'hi '), distinctColor('string'));
    assert.equal(exact(html, '{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'name'), distinctColor('variable'));
    assert.equal(within(html, '{{lit}}'), distinctColor('string'));
    assert.equal(within(html, 'C:\\p'), distinctColor('string'));
    assert.equal(within(html, 'raw "t"'), distinctColor('string'));
    assert.equal(exact(html, '1_000UL'), distinctColor('number'));
    assert.equal(within(html, '/// doc'), distinctColor('comment.doc'));
    assert.equal(within(html, '// plain'), distinctColor('comment'));
  }
);

void t.test('csharp: malformed constructs stay total and lossless', () => {
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
    '$"',
    '@"',
    '"""',
    '$"{',
    '[Attr',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('csharp: split ranges bound every lookahead', () => {
  const src = 'x// tail\nvar s = $"a {b} c"; obj.M(0xff);';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('csharp', '$hlCsharp', split).hl, src);
  }
});

void t.test(
  'csharp: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('csharp: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('csharp: multi-line constructs resume line-fed', () => {
  for (const code of [
    'var s = @"one\ntwo";\nvar t = 1;\n',
    'var r = """\n  raw\n  """;\nint x;\n',
    'var s = $"a {\n  x\n} b";\n',
    'int a; /* open\nstill */\nint b;\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('csharp', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
