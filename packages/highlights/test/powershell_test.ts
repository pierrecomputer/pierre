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
  lexer = loadLang('powershell', '$hlPowershell');
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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'powershell: requires, using, help comments, attributes, param blocks, functions, classes, and enums',
  () => {
    const html = distinctHl(
      "#Requires -Modules Pester\nusing namespace System.Collections.Generic\n<#\n.SYNOPSIS\n  Build.\n#>\n[CmdletBinding(SupportsShouldProcess)]\nparam(\n    [Parameter(Mandatory, Position = 0)] [ValidateNotNullOrEmpty()] [string] $Target,\n    [int] $Retries = 3,\n    [switch] $Force,\n    [System.IO.FileInfo] $File\n)\nSet-StrictMode -Version Latest\n$ErrorActionPreference = 'Stop'\nfunction Invoke-Build { [CmdletBinding()] param([string] $Name) begin { } process { } end { } }\nfilter Get-Even { if ($_ % 2 -eq 0) { $_ } }\nclass Animal { [string] $Name; static [int] $Count = 0; hidden [int] $Age; [string] Speak() { return \"...\" } static [Animal] Create() { return [Animal]::new('x') } }\nenum Color { }\nworkflow W { }\nconfiguration C { }"
    );
    for (const word of ['#Requires', '<#', '.SYNOPSIS', 'Build.', '#>']) {
      assert.equal(wordColor(html, word), distinctColor('comment'), word);
    }
    assert.equal(wordColor(html, 'using'), distinctColor('keyword.import'));
    for (const attr of [
      'CmdletBinding',
      'Parameter',
      'ValidateNotNullOrEmpty',
    ]) {
      assert.equal(wordColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const word of [
      'param',
      'function',
      'filter',
      'class',
      'static',
      'hidden',
      'enum',
      'workflow',
      'configuration',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of [
      'string',
      'int',
      'switch',
      'System.IO.FileInfo',
      'Animal',
      'Color',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const v of [
      '$Target',
      '$Retries',
      '$Force',
      '$File',
      '$ErrorActionPreference',
      '$Name',
      '$Count',
      '$Age',
    ]) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
    for (const fn of ['Invoke-Build', 'Get-Even', 'W', 'C']) {
      assert.equal(
        wordColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const fn of ['Set-StrictMode', 'Speak', 'Create']) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    assert.equal(wordColor(html, 'new'), distinctColor('function.method'));
    for (const word of ['begin', 'process', 'end', 'if', 'return']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(wordColor(html, '$_'), distinctColor('variable.special'));
    assert.equal(wordColor(html, '-eq'), distinctColor('keyword.operator'));
    assert.equal(
      wordColor(html, '-Version'),
      distinctColor('variable.parameter')
    );
    for (const s of ["'Stop'", '"..."', "'x'"]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    for (const op of ['=', '%', '::']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    for (const n of ['0', '3', '2']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
  }
);

void t.test(
  'powershell: numbers with unit suffixes, string forms, subexpressions, hashtables, casts, and members',
  () => {
    const html = distinctHl(
      "$x = 0x1F + 1_000 + 1e3 + 2.5 + 1kb + 2mb + 3gb + 4tb + 5pb + 6L + 7d + -8; $s = 'single $x' + \"double $x $($x + 1) ${x} $env:HOME $script:v `n `t `$ `\"\"; $h = @\"\nheredoc $x\n\"@; $l = @'\nliteral $x\n'@; $a = @(1, 2); $m = @{ 'q' = 2 }; $b = $true -and $false -or -not $null; $t = [int]$x; $u = [System.Text.StringBuilder]::new(); $arr = 1..10; $sub = $(Get-Date); $sw = $PSVersionTable; $obj.Prop.Sub; $obj.Method(1); $obj?.x; -join $r; -split 'a b'"
    );
    for (const n of [
      '0x1F',
      '1_000',
      '1e3',
      '2.5',
      '1kb',
      '2mb',
      '3gb',
      '4tb',
      '5pb',
      '6L',
      '7d',
      '8',
      '10',
    ]) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    for (const s of [
      "'single",
      "$x'",
      '"double',
      '@"',
      'heredoc',
      '"@',
      "@'",
      'literal',
      "'@",
      "'q'",
      "'a",
      "b'",
    ]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    for (const v of [
      '$x',
      '${x}',
      '$env:HOME',
      '$script:v',
      '$s',
      '$h',
      '$obj',
    ]) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
    for (const esc of ['`n', '`t', '`$', '`"']) {
      assert.equal(wordColor(html, esc), distinctColor('string.escape'), esc);
    }
    for (const p of ['$(', '@']) {
      assert.equal(wordColor(html, p), distinctColor('punctuation.special'), p);
    }
    for (const b of ['$true', '$false']) {
      assert.equal(wordColor(html, b), distinctColor('boolean'), b);
    }
    for (const op of ['-and', '-or', '-not', '-join', '-split']) {
      assert.equal(wordColor(html, op), distinctColor('keyword.operator'), op);
    }
    assert.equal(wordColor(html, '$null'), distinctColor('constant.builtin'));
    for (const type of ['int', 'System.Text.StringBuilder']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const op of ['::', '..', '?', '+', '-']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(wordColor(html, 'new'), distinctColor('function.method'));
    assert.equal(wordColor(html, 'Method'), distinctColor('function.method'));
    assert.equal(wordColor(html, 'Get-Date'), distinctColor('function'));
    assert.equal(
      wordColor(html, '$PSVersionTable'),
      distinctColor('variable.special')
    );
    for (const prop of ['Prop', 'Sub', 'x']) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
  }
);

void t.test(
  'powershell: control flow, comparison operators, pipelines, parameters, and automatic variables',
  () => {
    const html = distinctHl(
      "foreach ($item in $items) { if ($Clean -and -not (Test-Path $item)) { continue } elseif ($x) { break } else { } } for ($i = 0; $i -lt 3; $i++) { } while ($x) { } do { } until ($y); switch -Regex ($s) { 'a' { } default { } } try { throw 'e' } catch [System.IO.IOException] { $_.Exception } finally { } trap { } return 1; exit 0; Write-Host \"x\" -ForegroundColor Green -NoNewline; Get-ChildItem -Path \"src\" | Where-Object { $_.Length -gt 0x10 } | ForEach-Object { $_.Name } | Sort-Object -Descending | Select-Object -First 1; $x -eq 1 -ne 2 -gt 3 -ge 4 -lt 5 -le 6 -like 'a*' -notlike 'b' -match 'c' -notmatch 'd' -contains 'e' -in @(1) -is [int] -as [string] -band 1 -bor 2 -bxor 3 -shl 1 -shr 1 -replace 'a', 'b' -f 'x'; $x += 1; $x -= 1; $x *= 2; $x /= 2; $x %= 2; $x++; $x--; $x ?? $y; $x ??= 1; & $cmd; Invoke-Command -ScriptBlock { param($a) $a } -ArgumentList 1; [PSCustomObject]@{ b = 2 }; Get-Item | Out-Null; 2>&1; $?; $PSItem; $args; $input; $PID; $HOME"
    );
    for (const word of [
      'foreach',
      'if',
      'continue',
      'elseif',
      'break',
      'else',
      'for',
      'while',
      'do',
      'until',
      'switch',
      'default',
      'try',
      'throw',
      'catch',
      'finally',
      'trap',
      'return',
      'exit',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const op of [
      'in',
      '-and',
      '-not',
      '-lt',
      '-gt',
      '-eq',
      '-ne',
      '-ge',
      '-le',
      '-like',
      '-notlike',
      '-match',
      '-notmatch',
      '-contains',
      '-in',
      '-is',
      '-as',
      '-band',
      '-bor',
      '-bxor',
      '-shl',
      '-shr',
      '-replace',
      '-f',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('keyword.operator'), op);
    }
    for (const fn of [
      'Test-Path',
      'Write-Host',
      'Get-ChildItem',
      'Where-Object',
      'ForEach-Object',
      'Sort-Object',
      'Select-Object',
      'Invoke-Command',
      'Get-Item',
      'Out-Null',
    ]) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const param of [
      '-Regex',
      '-ForegroundColor',
      '-NoNewline',
      '-Path',
      '-Descending',
      '-First',
      '-ScriptBlock',
      '-ArgumentList',
    ]) {
      assert.equal(
        wordColor(html, param),
        distinctColor('variable.parameter'),
        param
      );
    }
    for (const type of [
      'System.IO.IOException',
      'int',
      'string',
      'PSCustomObject',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const v of [
      '$_',
      '$?',
      '$PSItem',
      '$args',
      '$input',
      '$PID',
      '$HOME',
    ]) {
      assert.equal(wordColor(html, v), distinctColor('variable.special'), v);
    }
    for (const prop of ['Exception', 'Length', 'Name']) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    for (const op of [
      '++',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '--',
      '??',
      '??=',
      '&',
      '|',
      '>&',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(
      wordColor(html, 'param'),
      distinctColor('keyword.declaration')
    );
    assert.equal(wordColor(html, '@'), distinctColor('punctuation.special'));
    assert.equal(wordColor(html, '0x10'), distinctColor('number'));
    for (const s of ["'a*'", "'e'", '"src"']) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
  }
);

void t.test('powershell: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'powershell',
      "# comment\n<# block\n   comment #>\nWrite-Host 'x' # tail\n<# nested <# not nested #>"
    ),
    [
      ['# comment', 'comment'],
      ['<# block', 'comment'],
      ['comment #>', 'comment'],
      ['Write-Host', 'function'],
      ["'x'", 'string'],
      ['# tail', 'comment'],
      ['<# nested <# not nested #>', 'comment'],
    ]
  );
});

void t.test(
  'powershell: here-strings, block comments, and param blocks stream line-fed',
  () => {
    assertLineFedParity(
      'powershell',
      '<#\n.SYNOPSIS\n  Build.\n#>\nparam(\n    [Parameter(Mandatory)] [string] $Target,\n    [int] $Retries = 3\n)\n$h = @"\nheredoc $x\n  $($x + 1)\n"@\n$l = @\'\nliteral $x\n\'@\nfunction Invoke-Build {\n  begin { }\n  process { $_ }\n}\n'
    );
  }
);
