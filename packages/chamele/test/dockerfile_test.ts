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
  lexer = loadLang('dockerfile', '$hlDockerfile');
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
  'dockerfile: instructions, stages, shell commands, options, and variables',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'FROM ubuntu:22.04 AS base\n# comment\nRUN apt-get update && \\\n    apt-get install -y curl\nENV KEY=value\nCOPY --from=base /a "/b" ${DIR:-x} $HOME\nEXPOSE 8080\nCMD ["node", \'app.js\']\nWORKDIR /app',
      { theme: distinct }
    );
    assert.equal(exact(html, 'FROM'), distinctColor('keyword'));
    assert.equal(exact(html, 'AS'), distinctColor('keyword'));
    assert.equal(exact(html, 'ubuntu:22.04'), undefined);
    assert.equal(within(html, '# comment'), distinctColor('comment'));
    assert.equal(exact(html, 'RUN'), distinctColor('keyword'));
    assert.equal(exact(html, 'apt-get'), distinctColor('function'));
    assert.equal(exact(html, 'update'), undefined);
    assert.equal(exact(html, '&&'), distinctColor('operator'));
    assert.equal(exact(html, '\\'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'ENV'), distinctColor('keyword'));
    assert.equal(exact(html, '='), distinctColor('operator'));
    assert.equal(exact(html, '--from'), distinctColor('variable.parameter'));
    assert.equal(exact(html, '"/b"'), distinctColor('string'));
    assert.equal(within(html, '${DIR:-x}'), distinctColor('variable'));
    assert.equal(within(html, '$HOME'), distinctColor('variable'));
    assert.equal(exact(html, '8080'), distinctColor('number'));
    assert.equal(exact(html, '['), distinctColor('punctuation.bracket'));
    assert.equal(exact(html, ','), distinctColor('punctuation.delimiter'));
    assert.equal(exact(html, "'app.js'"), distinctColor('string'));
    assert.equal(exact(html, 'WORKDIR'), distinctColor('keyword'));
  }
);

void t.test('dockerfile: lowercase instructions and heredocs', () => {
  const html = checkInvariants(
    lexer.hl,
    'from alpine\nrun <<EOF\necho $HOME\nEOF\nCOPY <<-"EOT" /dest\n\tline\n\tEOT\nUSER app',
    { theme: distinct }
  );
  assert.equal(exact(html, 'from'), distinctColor('keyword'));
  assert.equal(exact(html, 'run'), distinctColor('keyword'));
  assert.equal(exact(html, '<<'), distinctColor('operator'));
  assert.equal(exact(html, 'EOF'), distinctColor('string.special'));
  assert.equal(within(html, 'echo $HOME\nEOF\n'), distinctColor('string'));
  assert.equal(exact(html, '<<-'), distinctColor('operator'));
  assert.equal(exact(html, '"EOT"'), distinctColor('string.special'));
  assert.equal(within(html, '\tline\n\tEOT\n'), distinctColor('string'));
  assert.equal(exact(html, 'USER'), distinctColor('keyword'));
});

void t.test('dockerfile: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '\\',
    'RUN \\',
    'RUN \\\n',
    '"unterminated',
    "'",
    '$',
    '$ x',
    '${',
    '${DIR',
    '--',
    '--$',
    'RUN <<',
    'RUN <<"',
    'RUN <<EOF',
    'RUN <<EOF\n',
    'RUN <<EOF\nbody',
    'é 日本語',
    'FROM $',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('dockerfile: split ranges bound every lookahead', () => {
  const src = 'RUN a \\\n  b "c" $d\nRUN <<EOF\nx\nEOF\nCMD ["y"]';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('dockerfile', '$hlDockerfile', split).hl, src);
  }
});

void t.test(
  'dockerfile: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x52,
      0x55,
      0x4e,
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

void t.test('dockerfile: deterministic fuzz preserves lexer invariants', () => {
  let state = 0xd0c4e2;
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

void t.test('dockerfile: multi-line constructs resume line-fed', () => {
  for (const code of [
    'RUN a \\\n  b\nRUN <<EOF\nx $y\nEOF\nCMD y\n',
    'RUN <<-"EOT"\n\tx\n\tEOT\nENV a=b\n',
    'FROM x AS y\n# c\nRUN one && \\\n  two | three\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('dockerfile', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
