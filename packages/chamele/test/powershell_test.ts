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
  lexer = loadLang('powershell', '$hlPowershell');
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
  'powershell: comments, parameters, functions, cmdlets, and operators',
  () => {
    const html = checkInvariants(
      lexer.hl,
      "#Requires -Version 7\n<#\n.SYNOPSIS\n  Demo\n#>\nparam(\n  [Parameter(Mandatory)]\n  [string]$Name,\n  [int]$Count = 3\n)\n\nFunction Get-Greeting {\n  [CmdletBinding()]\n  process { $Name }\n}\n\n$items = Get-ChildItem -Path . -Filter '*.ps1' | Where-Object { $_.Length -gt 1kb }\nforeach ($item in $items) {\n  Write-Host (\"{0}\" -f $item.Name) -ForegroundColor Green\n}\nIf ($Count -eq 3 -and -not $items) { throw \"none\" } else { return $null }\n[Math]::Max(1, 2); [System.IO.Path]::Combine('a', 'b'); $true; $args; @args; @{ a = 1 }",
      { theme: distinct }
    );
    assert.equal(within(html, '#Requires'), distinctColor('comment'));
    assert.equal(within(html, '.SYNOPSIS'), distinctColor('comment'));
    assert.equal(exact(html, 'param'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Parameter'), distinctColor('attribute'));
    assert.equal(exact(html, 'Mandatory'), undefined);
    assert.equal(exact(html, 'string'), distinctColor('type'));
    assert.equal(exact(html, '$Name'), distinctColor('variable'));
    assert.equal(exact(html, '3'), distinctColor('number'));
    assert.equal(exact(html, 'Function'), distinctColor('keyword.declaration'));
    assert.equal(
      exact(html, 'Get-Greeting'),
      distinctColor('function.definition')
    );
    assert.equal(exact(html, 'CmdletBinding'), distinctColor('attribute'));
    assert.equal(exact(html, 'process'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'Get-ChildItem'), distinctColor('function'));
    assert.equal(exact(html, '-Path'), distinctColor('variable.parameter'));
    assert.equal(exact(html, "'*.ps1'"), distinctColor('string'));
    assert.equal(exact(html, '|'), distinctColor('operator'));
    assert.equal(exact(html, '$_'), distinctColor('variable.special'));
    assert.equal(exact(html, 'Length'), distinctColor('property'));
    assert.equal(exact(html, '-gt'), distinctColor('keyword.operator'));
    assert.equal(exact(html, '1kb'), distinctColor('number'));
    assert.equal(exact(html, 'foreach'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'in'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'Write-Host'), distinctColor('function'));
    assert.equal(exact(html, '-f'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'Green'), undefined);
    assert.equal(exact(html, 'If'), distinctColor('keyword.control'));
    assert.equal(exact(html, '-eq'), distinctColor('keyword.operator'));
    assert.equal(within(html, '-and'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'throw'), distinctColor('keyword.control'));
    assert.equal(exact(html, '$null'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'Math'), distinctColor('type'));
    assert.equal(exact(html, '::'), distinctColor('operator'));
    assert.equal(exact(html, 'Max'), distinctColor('function.method'));
    assert.equal(exact(html, 'System.IO.Path'), distinctColor('type'));
    assert.equal(exact(html, '$true'), distinctColor('boolean'));
    assert.equal(exact(html, '$args'), distinctColor('variable.special'));
    assert.equal(exact(html, '@args'), distinctColor('variable'));
    assert.equal(exact(html, '@'), distinctColor('punctuation.special'));
  }
);

void t.test('powershell: strings, here-strings, and subexpressions', () => {
  const html = checkInvariants(
    lexer.hl,
    '"Hello, $Who! ${env:USERNAME} $($Count + 1) `n $$ ""quoted"""\n\'it\'\'s $literal\'\n$here = @"\nmulti $Name "@ inside\n"@\n$lit = @\'\nraw $x\n\'@',
    { theme: distinct }
  );
  assert.equal(within(html, 'Hello, '), distinctColor('string'));
  assert.equal(exact(html, '$Who'), distinctColor('variable'));
  assert.equal(exact(html, '${env:USERNAME}'), distinctColor('variable'));
  assert.equal(exact(html, '$('), distinctColor('punctuation.special'));
  assert.equal(exact(html, '$Count'), distinctColor('variable'));
  assert.equal(exact(html, '+'), distinctColor('operator'));
  assert.equal(exact(html, ')'), distinctColor('punctuation.special'));
  assert.equal(exact(html, '`n'), distinctColor('string.escape'));
  assert.equal(exact(html, '$$'), distinctColor('variable.special'));
  assert.equal(exact(html, '""'), distinctColor('string.escape'));
  assert.equal(exact(html, "''"), distinctColor('string.escape'));
  assert.equal(within(html, '$literal'), distinctColor('string'));
  assert.equal(within(html, 'multi '), distinctColor('string'));
  assert.equal(exact(html, '$Name'), distinctColor('variable'));
  assert.equal(within(html, ' "@ inside\n'), distinctColor('string'));
  assert.equal(within(html, 'raw $x'), distinctColor('string'));
});

void t.test('powershell: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '<#',
    '<# open',
    '"unterminated',
    '"a `',
    "'",
    '@"',
    '@"\nx',
    '$',
    '$(',
    '${',
    '$$',
    '@',
    '@$',
    '[',
    '[$',
    '[a',
    '-',
    '--',
    '-$',
    '`',
    '::',
    '..',
    'é 日本語',
    '"$(',
    '"${',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('powershell: split ranges bound every lookahead', () => {
  const src =
    '$x = "a $(f 1) ${b} `n" # c\n[int]$y = @"\nz\n"@\nGet-Item -Path $x';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('powershell', '$hlPowershell', split).hl, src);
  }
});

void t.test(
  'powershell: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('powershell: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x9057e1;
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

void t.test('powershell: multi-line constructs resume line-fed', () => {
  for (const code of [
    '<# open\nstill #>\n$x = @"\nmulti $y $(1 +\n2)\n"@\n"a $(\n$b\n) c"\n',
    '$s = \'one\ntwo\'\n$t = "x`\ny"\n',
    'Get-Item `\n  -Path a\nfunction f {\n  param($x)\n}\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('powershell', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
