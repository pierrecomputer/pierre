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
  lexer = loadLang('terraform', '$hlTerraform');
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
  'terraform: blocks, attributes, references, functions, and control words',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'terraform {\n  required_providers { aws = { source = "hashicorp/aws" } }\n}\nresource "aws_instance" "web" {\n  count = var.enabled ? 1 : 0\n  ami   = data.aws_ami.ubuntu.id\n  tags  = merge(local.tags, { Name = "web-${count.index}" })\n  ports = [for p in var.ports : p if p > 1024]\n  type  = list(string)\n  nil   = null\n  ok    = true\n}',
      { theme: distinct }
    );
    assert.equal(
      exact(html, 'terraform'),
      distinctColor('keyword.declaration')
    );
    assert.equal(
      exact(html, 'required_providers'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exact(html, 'aws'), distinctColor('property'));
    assert.equal(exact(html, 'source'), distinctColor('property'));
    assert.equal(exact(html, 'resource'), distinctColor('keyword.declaration'));
    assert.equal(within(html, '"aws_instance"'), distinctColor('string'));
    assert.equal(exact(html, 'count'), distinctColor('property'));
    assert.equal(exact(html, 'var'), distinctColor('variable.special'));
    assert.equal(exact(html, 'enabled'), distinctColor('property'));
    assert.equal(exact(html, 'data'), distinctColor('variable.special'));
    assert.equal(exact(html, 'merge'), distinctColor('function'));
    assert.equal(exact(html, 'local'), distinctColor('variable.special'));
    assert.equal(exact(html, '${'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'index'), distinctColor('property'));
    assert.equal(exact(html, 'for'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'in'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'list'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'string'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'null'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'true'), distinctColor('boolean'));
  }
);

void t.test(
  'terraform: comments, heredocs, template directives, and escapes',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '# one\n// two\n/* three */\nuser_data = <<-EOT\n  echo "${var.msg}"\n  EOT\ndesc = "%{ if x }y%{ endif } $${lit} \\n"',
      { theme: distinct }
    );
    assert.equal(within(html, '# one'), distinctColor('comment'));
    assert.equal(within(html, '// two'), distinctColor('comment'));
    assert.equal(within(html, '/* three */'), distinctColor('comment'));
    assert.equal(within(html, '<<-EOT'), distinctColor('string'));
    assert.equal(within(html, 'echo'), distinctColor('string'));
    assert.equal(exact(html, '%{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'endif'), distinctColor('keyword.control'));
    assert.equal(within(html, '$${lit}'), distinctColor('string'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
  }
);

void t.test('terraform: malformed constructs stay total and lossless', () => {
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
    '<<EOT',
    '<<-',
    '"${',
    '%{',
    '<<',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('terraform: split ranges bound every lookahead', () => {
  const src = 'x = <<-EOT\n  a ${b}\n  EOT\ny = "a ${z} b" # c';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('terraform', '$hlTerraform', split).hl, src);
  }
});

void t.test(
  'terraform: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('terraform: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('terraform: multi-line constructs resume line-fed', () => {
  for (const code of [
    'x = <<-EOT\n  hello ${var.y}\n  EOT\ny = "a ${z} b"\n',
    'x = <<EOT\nline\nEOT\ny = 1\n',
    'a = 1 /* open\nstill */\nb = 2\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('terraform', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
