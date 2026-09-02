import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { checkInvariants, loadLang, spansOf, themeColor } from './util';

// Regression tests for the shared lexer helpers in src/common.wat. Each case
// exercises a helper through one representative language; the per-language
// suites cover the language-specific paths.

t.before(() => {
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/** Token content and color per line, for whole-buffer vs line-fed diffs. */
function flat(lines: ThemedToken[][]): string {
  return lines
    .map((line) =>
      line.map((tok) => `${JSON.stringify(tok.content)}:${tok.color}`).join(' ')
    )
    .join('\n');
}

/** Assert that feeding one line per chunk matches a whole-buffer run. */
function assertLineFedParity(lang: Lang, code: string): void {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  assert.equal(flat(streamed), flat(whole), `${lang} line-fed parity`);
}

const STRING = themeColor('string');
const CONSTANT = themeColor('constant');

void t.test(
  'lexStringBody: a backslash before CRLF continues the string like one before LF',
  () => {
    for (const [lang, fn] of [
      ['c', '$hlC'],
      ['go', '$hlGo'],
      ['rust', '$hlRust'],
    ] as const) {
      const lexer = loadLang(lang, fn);
      const crlf = 'x = "abc\\\r\ndef";\r\n';
      const html = checkInvariants(lexer.hl, crlf);
      const closing = spansOf(html).find((s) => s.text.startsWith('def"'));
      assert.ok(closing !== undefined, `${lang}: def" is one string span`);
      assert.equal(closing.color, STRING, `${lang}: def" keeps string color`);
    }
  }
);

void t.test(
  'lexStringBody: an escaped CRLF at a chunk end resumes the string',
  () => {
    assertLineFedParity('c', 'char *s = "abc\\\r\ndef";\r\nint z;\r\n');
    assertLineFedParity('go', 'x := "abc\\\ndef"\ny := 1\n');
  }
);

void t.test('streamSetNested: nested comments checkpoint at even depth', () => {
  assertLineFedParity('rust', '/* /* a\nb\n*/ */\nc\n');
  assertLineFedParity('rust', '/* /* /* a\nb\n*/ */ */\nc\n');
  assertLineFedParity('swift', '/* /* a\nb\n*/ */\nlet c = 1\n');
});

void t.test(
  'lexSkipSpaceAt: a call lookahead never crosses a line break',
  () => {
    assertLineFedParity('c', 'int x = foo\n(1);\n');
    assertLineFedParity('go', 'x := foo\n(1)\n');
  }
);

void t.test(
  'lexIsConstCase: a single uppercase letter is not a constant',
  () => {
    const c = loadLang('c', '$hlC');
    const html = checkInvariants(c.hl, 'T x = MAX;');
    const spans = spansOf(html);
    const single = spans.find((s) => s.text.trim() === 'T');
    const screaming = spans.find((s) => s.text.trim() === 'MAX');
    assert.ok(screaming !== undefined && screaming.color === CONSTANT);
    assert.ok(single === undefined || single.color !== CONSTANT);
  }
);

void t.test(
  'streamResumeFixed: delimiter search survives decoy first bytes',
  () => {
    assertLineFedParity(
      'cpp',
      'auto s = R"tag(a)x\n)tagx )ta\n)tag";\nint y;\n'
    );
    assertLineFedParity('lua', 'x = [==[a]\n]=]b\n]==]\ny = 1\n');
  }
);
