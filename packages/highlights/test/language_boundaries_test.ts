import { test } from 'bun:test';
import assert from 'node:assert/strict';

import type { Lang, ThemedToken } from '../lib/index';
import {
  codeToHtml,
  codeToTokens,
  LiveTokenizer,
  StreamTokenizer,
} from '../lib/index';
import { samples, zonSample } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  loadSplitLang,
  makeRand,
  spansOf,
  textOf,
} from './_util';

const fixtures = [
  {
    lang: 'ada',
    code: samples.ada.code,
    delimiter: '"',
    fragments: ['--', '"', '""', "'", "'x'", "X'First", '16#FF#', '<<', ':='],
    open: 'S : String := "λ😀',
  },
  {
    lang: 'apache',
    code: 'RewriteRule ^(.*)$ /λ😀/$1 \\\n  [L,R=301]\nHeader set X "a \\\nb"\n<If "%{HTTP_HOST} == \'x\'">\n</If>\n',
    delimiter: '\\',
    fragments: ['\\', '"', "'", '[', ']', '%{', '${', '#', '<', '>', '</'],
    open: 'Header set X "λ😀 \\',
  },
  {
    lang: 'apex',
    code: samples.apex.code,
    delimiter: ']',
    fragments: [
      '[',
      ']',
      '[SELECT',
      ':x',
      '/**',
      '*/',
      '//',
      "'",
      "\\'",
      '@isTest',
    ],
    open: 'rows = [SELECT Id /* λ😀',
  },
  {
    lang: 'asciidoc',
    code: '= Doc λ😀\n----\n*not bold* λ😀\n----\n////\nnote\n////\nA *b* <<c>>\n',
    delimiter: '----',
    fragments: [
      '----',
      '////',
      '....',
      '*',
      '_',
      '`',
      '#',
      '<<',
      '[',
      '{',
      ':',
    ],
    open: '----\nλ😀 *x*',
  },
  {
    lang: 'awk',
    code: '# λ😀\nBEGIN { s = "a \\\nb" }\n/re/ { n = $1 / 2 }\n',
    delimiter: '"',
    fragments: ['"', '/', '/[/]/', '\\', '$', '$NF', '#', '@include'],
    open: 's = "λ😀 \\',
  },
  {
    lang: 'bicep',
    code: "var s = '''\nλ😀 ${x}\n'''\nvar t = 'a${b}\\'λ😀'\n/* c\n*/\n",
    delimiter: "'''",
    fragments: ["'''", "'", '${', '}', '/*', '*/', '\\\\', '@'],
    open: "var s = '''λ😀",
  },
  {
    lang: 'cobol',
    code: samples.cobol.code,
    delimiter: '.',
    fragments: [
      '*>',
      '>>',
      '"',
      '""',
      'PIC X',
      'X"FF"',
      'END-IF',
      '      *',
      '      -',
    ],
    open: '000100     MOVE "λ😀',
  },
  {
    lang: 'coffee',
    code: samples.coffee.code,
    delimiter: '###',
    fragments: [
      '###',
      '#',
      '"',
      "'",
      '"""',
      "'''",
      '#{',
      '}',
      '///',
      '/',
      '`',
      '```',
      '\\',
      '->',
      '(a, b) ->',
      '@x',
    ],
    open: 'x = "λ😀 #{ y',
  },
  {
    lang: 'dotenv',
    code: 'export A="λ😀 ${HOME}\n# not a comment\n$USER"\nB=1 # note\nC=\'x\n\'\n',
    delimiter: '"',
    fragments: ['"', "'", '`', '\\', '${', '$X', '#', ' #', '=', 'export '],
    open: 'KEY="λ😀 ${A',
  },
  {
    lang: 'erb',
    code: samples.erb.code,
    delimiter: '%>',
    fragments: [
      '<%',
      '<%=',
      '<%#',
      '<%%',
      '%>',
      '-%>',
      '"',
      '<!--',
      '-->',
      '<script>',
      '</script>',
      '<a href="',
      '>',
      '#{',
      '<<~EOS\n',
      'end',
    ],
    open: '<div class="<%= items.map { |x| "λ😀',
  },
  {
    lang: 'gherkin',
    code: 'Feature: λ😀\n  Given a doc\n    """\n    Then λ😀 <x>\n    """\n  Then | a | "b" |\n',
    delimiter: '"""',
    fragments: [
      '"""',
      '```',
      '|',
      '\\|',
      '<',
      '>',
      '@',
      '#',
      'Given ',
      'Feature:',
    ],
    open: 'Given x\n  """\n  λ😀',
  },
  {
    lang: 'gnuplot',
    code: '$d << EOD\n1 λ😀\nplot x\nEOD\nplot $d u 1:2 \\\n  w l t "λ😀"\n',
    delimiter: 'EOD',
    fragments: ['<<', 'EOD', '\\', '"', "'", '#', '$', 'set ', 'plot '],
    open: '$d << EOD\nλ😀',
  },
  {
    lang: 'haml',
    code: samples.haml.code,
    delimiter: '}}',
    fragments: [
      '%p',
      '.a',
      '#b',
      '{',
      '}',
      '(',
      ')',
      '#{',
      '= ',
      '- ',
      '-#',
      '/ ',
      ':css\n',
      ':ruby\n',
      ':javascript\n',
      '  ',
      '"',
      '\\',
    ],
    open: ':css\n  a { /* λ😀',
  },
  {
    lang: 'handlebars',
    code: '{{!-- λ😀\n{{x}} --}}\n<ul>{{#each items as |item|}}\n<li class="{{item.cls}}">{{{item.html}}}</li>{{/each}}</ul>\n',
    delimiter: '--}}',
    fragments: [
      '{{',
      '}}',
      '{{{',
      '{{!',
      '{{!--',
      '--}}',
      '{{~',
      '~}}',
      '{{#if',
      '{{/if}}',
      '../',
    ],
    open: '<div class="{{#if λ😀',
  },
  {
    lang: 'haxe',
    code: samples.haxe.code,
    delimiter: '"',
    fragments: [
      '"',
      "'",
      "'$",
      '${',
      '$$',
      '\\u0041',
      '~/',
      '#if (',
      '#elseif',
      '@:',
      '/**',
    ],
    open: "var s = 'λ😀 ${x",
  },
  {
    lang: 'http',
    code: 'POST /api HTTP/1.1\nContent-Type: application/json\n\n{\n  "a": [1, {"b": "λ😀"}],\n  "c": 2\n}\n\n###\nGET /feed\n\n<feed>\n<!-- x\n-->\n<e a="1"\n  b="2">t</e>\n</feed>\n',
    delimiter: '###',
    fragments: [
      '###',
      '\n\n',
      '{',
      '}',
      '[',
      ',',
      '"',
      '<',
      '>',
      '<!--',
      '-->',
      '{{x}}',
      'Content-Type: text/xml',
    ],
    open: 'POST /x\n\n{"a": [λ😀',
  },
  {
    lang: 'jinja',
    code: '{# λ😀\n<b>{{ x }}</b> #}\n<a href="{{ url(\'x\') }}"\n  title="{% if a %}b{% endif %}">{{ y|e }}</a>\n{% raw %}{{ z }}\n{% endraw %}\n',
    delimiter: '#}',
    fragments: [
      '{{',
      '}}',
      '{%-',
      '-%}',
      '{#',
      '#}',
      '{% raw %}',
      '<a b="',
      '<!--',
      '<script>',
    ],
    open: '<p title="{{ λ😀',
  },
  {
    lang: 'liquid',
    code: '{% comment %}\nλ😀 {{ x }}\n{% endcomment %}\n{% liquid\n  assign a = 1\n  # note\n%}\n<p>{{ a | plus: 2 }}</p>\n',
    delimiter: 'endcomment',
    fragments: [
      '{{',
      '}}',
      '{%-',
      '-%}',
      '{% # c %}',
      '{% raw %}',
      'a-}}',
      'x?',
    ],
    open: '{% liquid\n  assign λ😀',
  },
  {
    lang: 'nginx',
    code: 'server {\n  set $a "λ😀 $host\n  # still text";\n  location ~* \\.(png)$ { return 200; }\n}\n',
    delimiter: '"',
    fragments: ['"', "'", '\\', '$', '${', '#', ';', '{', '}', '~*', '(', ')'],
    open: 'set $a "λ😀 ${uri',
  },
  {
    lang: 'plsql',
    code: samples.plsql.code,
    delimiter: "]'",
    fragments: [
      "q'[",
      "]'",
      "nq'<",
      '/*',
      '*/',
      '--',
      "''",
      ':=',
      '%type',
      '&&v',
      '<<l>>',
    ],
    open: "x := q'[λ😀 /*",
  },
  {
    lang: 'prisma',
    code: '/* λ😀\n   model */\nmodel A {\n  id Int @id // λ😀\n  s String @default("\\n")\n}\n',
    delimiter: '*/',
    fragments: ['/*', '*/', '//', '///', '"', '\\', '@@', '{', '}'],
    open: '/* λ😀',
  },
  {
    lang: 'prolog',
    code: samples.prolog.code,
    delimiter: '*/',
    fragments: ['/*', '*/', "0'", "0'\\", "0'''", "'", '"', '%', ':-', '. '],
    open: '/* λ😀',
  },
  {
    lang: 'pug',
    code: samples.pug.code,
    delimiter: ')',
    fragments: [
      'p',
      '.a',
      '#b',
      '(',
      ')',
      '#{',
      '#[',
      '|',
      '//',
      '//-',
      '- ',
      '= ',
      'script.\n',
      'style.\n',
      ':coffee\n',
      '  ',
      '`',
      '"',
    ],
    open: 'script.\n  const s = `λ😀',
  },
  {
    lang: 'qml',
    code: samples.qml.code,
    delimiter: '*/',
    fragments: [
      'a: {',
      'a: [',
      'a: b;',
      'a: "x;',
      "a: '\\",
      'a: `',
      'a: /*',
      'function f(',
      'signal s(',
      'enum E {',
      'property list<',
      'import ',
    ],
    open: 'Item {\n  onClicked: {\n    var s = `λ😀 ${x',
  },
  {
    lang: 'rst',
    code: '.. note:: a `b`_\nIntro::\n\n    λ😀 *x*\n\n.. comment\n   λ😀\n====\nTitle\n====\n',
    delimiter: '::',
    fragments: ['::', '..', '.. ', '*', '``', '`', '|', '_', '====', '\n    '],
    open: 'Para::\n\n    λ😀 *x*',
  },
  {
    lang: 'tcl',
    code: 'set s "λ😀 $x\n[incr n]\nend"\nproc p {a} {\n  # note\n  return $a\n}\n',
    delimiter: '"',
    fragments: ['"', '[', ']', '{', '}', '$', '${', '\\', '#', ';'],
    open: 'set s "λ😀 [puts',
  },
  {
    lang: 'twig',
    code: '{% verbatim %}λ😀\n{{ x }}{% endverbatim %}\n<p class="{{ a ?? \'b\' }}">{{ {k: [1, 2]}|json_encode }}</p>\n{# a\nb #}\n',
    delimiter: '#}',
    fragments: [
      '{{',
      '{{ {a: {b: 1}} }}',
      '~}}',
      '{%~',
      '{% verbatim %}',
      '..',
      '??',
    ],
    open: '{% set a = {k: λ😀',
  },
  {
    lang: 'verilog',
    code: '/* λ😀\n * header\n */\nmodule m; wire [7:0] w = 8\'hFF;\nassign s = "a \\\nb";\nendmodule\n',
    delimiter: '*/',
    fragments: [
      '/*',
      '*/',
      '//',
      '`define',
      "8'hFF",
      "'0",
      '"',
      '\\',
      '$display',
      '#10',
    ],
    open: '/* λ😀',
  },
  {
    lang: 'vhdl',
    code: '/* λ😀\n   header */\nentity E is end;\ns <= x"FF" & \'1\' when clk\'event else "a""b";\n',
    delimiter: '*/',
    fragments: ['/*', '*/', '--', '"', '""', "'", "x'event", 'x"', '16#FF#'],
    open: '/* λ😀',
  },
  {
    lang: 'viml',
    code: 'let x =\n      \\ "λ😀" .\n      "\\ comment\n      \\ "b"\nnnoremap <leader>w :w<CR>\n',
    delimiter: '=',
    fragments: ['"', "'", "''", '\\', '<CR>', '&ts', '@a', 'g:x', '|', '#'],
    open: 'let x = "λ😀',
  },
  {
    lang: 'blade',
    code: "{{-- note λ😀\n  more --}}\n<div class=\"{{ $a }}\" {{ $attributes->merge([\n  'id' => 'x',\n]) }}>\n@php\n  $s = 'x\\'y'; /* c\n  d */\n@endphp\n@if ($n > 1)\n  {!! $html !!} <x-a :b=\"$c\" />\n@endif\n</div>\n",
    delimiter: '--}}',
    fragments: [
      '{{--',
      '--}}',
      '{{',
      '}}',
      '{!!',
      '!!}',
      '@php',
      '@endphp',
      '@if(',
      ')',
      '@verbatim',
      '@endverbatim',
      '<x-a :b="',
      '"',
      "'",
      '/*',
      '*/',
      '@{{',
      'me@x.com',
    ],
    open: '<div class="{{ $s /* λ😀',
  },
  {
    lang: 'razor',
    code: '@* note λ😀\n   more *@\n@{\n    var s = @"a\n""b";\n    /* c\n       d */\n}\n@if (x)\n{\n    <p class="@cls">@item.Name</p>\n}\nelse\n{\n    @:text @x\n}\n',
    delimiter: '*@',
    fragments: [
      '@*',
      '*@',
      '@{',
      '{',
      '}',
      '@if (x)',
      'else',
      '@(',
      ')',
      '<p>',
      '</p>',
      '@:',
      '/*',
      '*/',
      '@"',
      '"',
      '"""',
      '@@',
      'a@b.c',
      '@section S {',
      '<br>',
    ],
    open: '@{ var s = @"λ😀',
  },
  {
    lang: 'lean',
    code: samples.lean.code,
    delimiter: '-/',
    fragments: [
      '/-',
      '-/',
      '/--',
      '/-!',
      '--',
      'r##"',
      '"##',
      '«',
      '»',
      'α→β',
      '@[simp]',
    ],
    open: '/- nested /- λ😀 -/',
  },
  {
    lang: 'gdscript',
    code: samples.gdscript.code,
    delimiter: '"""',
    fragments: [
      '"""',
      "'''",
      'r"',
      '\\U01F600',
      '@export',
      '$Node/Child',
      '%Node',
      '#',
    ],
    open: 'var text = """λ😀',
  },
  {
    lang: 'gdshader',
    code: samples.gdshader.code,
    delimiter: '*/',
    fragments: ['/*', '*/', '//', '#include', '"', '\\', 'COLOR', 'hint_range'],
    open: '/* λ😀',
  },
  {
    lang: 'gdresource',
    code: samples.gdresource.code,
    delimiter: '"',
    fragments: [
      '[node',
      ']',
      '[',
      ';',
      '"',
      '&"',
      '\\',
      'ExtResource(',
      'metadata/key',
    ],
    open: '[gd_resource type="Shader"]\ncode = "λ😀',
  },
  {
    lang: 'zig',
    code: zonSample,
    delimiter: '"',
    fragments: ['//', '"', '@"', '\\\\', '\\u{', '.{', '}', 'inf', 'nan'],
    open: '.{ .text = "λ😀',
  },
  {
    lang: 'batch',
    code: '@echo off\ncall :render %~dp0\necho "λ😀 %PATH% !x!" ^\n REM argument\n:render\nREM done\n',
    delimiter: '^',
    fragments: ['%', '%%~', '%~$PATH:', '!open', '^', '"', 'REM ', '::', '&'],
    open: 'echo "λ😀 %PATH%',
  },
  {
    lang: 'elm',
    code: 'import Json.Decode as D\ntext = """λ😀 \\u{1F600}\n-- still text\n"""\n{- a {- b -} c -}\nnext = True\n',
    delimiter: '"""',
    fragments: ['{-', '{-|', '-}', '"""', '"', '\\u{', '\\u{1F600}', '--', '$'],
    open: 'text = """λ😀 {-',
  },
  {
    lang: 'cuda',
    code: 'const char *s = R"tag(λ😀\n// text)tag";\n__global__ void f() {}\nf<<<1, 32>>>(p);\n',
    delimiter: ')tag"',
    fragments: [
      '/*',
      '*/',
      'R"tag(',
      ')tag"',
      '"',
      '\\',
      '<<<',
      '>>>',
      '__shared__',
    ],
    open: 'const char *s = R"tag(λ😀 /*',
  },
  {
    lang: 'fortran',
    code: 'character(*) :: s = "λ😀 &\n! comment\n  &tail"\nvalue = .5D-2\nif (.true.) print *, s\n',
    delimiter: '&',
    fragments: ['"', "'", "''", '&', '! comment', '.TRUE.', '1.d0', "Z'", '%'],
    open: 'text = "λ😀 &',
  },
  {
    lang: 'groq',
    code: '// λ😀\n*[_type == "post" && title match "λ😀*"] | order(_createdAt desc) {\n  "note": "multi\nline \\u{1F600}",\n  "author": author->name,\n  ...\n}\n',
    delimiter: '"',
    fragments: [
      '"',
      "'",
      '\\',
      '\\u{',
      '\\u0041',
      '//',
      '::',
      '->',
      '...',
      '..',
      '$x',
      '@',
      '^',
      '*',
      ' in ',
    ],
    open: '*[title == "λ😀',
  },
  {
    lang: 'solidity',
    code: '/** λ😀\n * documentation\n */\ncontract C {\nfunction f() external { require(true); }\n}\n',
    delimiter: '*/',
    fragments: [
      '/*',
      '*/',
      '/**',
      '///',
      '"',
      '\\',
      'unicode"',
      'hex"',
      'assembly {',
    ],
    open: '/** λ😀',
  },
  {
    lang: 'csv',
    code: 'id,note,tail\n1,"λ😀 a, ""b""\nstill note",x\n2,y,z\n',
    delimiter: '"',
    fragments: ['"', '""', '"a""b"', 'a"b', ',', ',,', '<>&'],
    open: 'id,note\n1,"λ😀',
  },
] satisfies {
  lang: Lang;
  code: string;
  delimiter: string;
  fragments: string[];
  open: string;
}[];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Compare text and relative token offsets after each edit, including changes
// that propagate a string or comment state into later lines.
function assertLiveMatches(
  live: LiveTokenizer,
  code: string,
  lang: Lang,
  label: string
) {
  const lines = code.split('\n');
  const expected = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
  assert.equal(live.lineCount, lines.length, label);
  let offset = 0;
  for (const [line, text] of lines.entries()) {
    assert.equal(live.getLineText(line), text, `${label}: line ${line} text`);
    assert.deepEqual(
      live.getLineTokens(line).tokens,
      expected[line].map((token) => ({
        ...token,
        offset: token.offset - offset,
      })),
      `${label}: line ${line} tokens`
    );
    offset += text.length + 1;
  }
}

for (const { lang, code, delimiter, fragments, open } of fixtures) {
  test(`${lang}: every UTF-16 stream cut preserves tokens and offsets`, () => {
    initFullModule();
    for (const input of [code, code.replaceAll('\n', '\r\n')]) {
      const options = { lang, theme: distinctTheme };
      const expected = codeToTokens(input, options).tokens;
      for (let cut = 0; cut <= input.length; cut++) {
        const stream = new StreamTokenizer(options);
        const actual = [
          ...stream.pushCode(input.slice(0, cut)),
          ...stream.pushCode(''),
          ...stream.pushCode(input.slice(cut)),
          ...stream.end(),
        ];
        assert.deepEqual(
          actual,
          expected,
          `${lang}: cut ${cut} of ${JSON.stringify(input)}`
        );
      }
      const stream = new StreamTokenizer(options);
      const actual: ThemedToken[][] = [];
      for (let index = 0; index < input.length; index++) {
        actual.push(...stream.pushCode(input[index]));
      }
      actual.push(...stream.end());
      assert.deepEqual(actual, expected, `${lang}: single UTF-16 units`);
    }
  });

  test(`${lang}: every byte scan boundary preserves Unicode and HTML specials`, () => {
    const split = loadSplitLang(lang);
    for (const input of [code, `${open}<>&\0`, ...fragments]) {
      const length = encoder.encode(input).length;
      for (let cut = 0; cut <= length; cut++) {
        const html = split(input, cut);
        assert.equal(
          textOf(html),
          input,
          `${lang}: byte ${cut} of ${JSON.stringify(input)}`
        );
        spansOf(html);
      }
    }
  });

  test(`${lang}: truncated constructs preserve text and leave no pooled state`, () => {
    initFullModule();
    const options = { lang, theme: distinctTheme };
    const pristine = codeToTokens(code, options).tokens;
    const bytes = encoder.encode(`${open}<>&\0😀`);
    for (let end = 0; end <= bytes.length; end++) {
      const input = bytes.subarray(0, end);
      const normalized = decoder.decode(input);
      const html = decoder.decode(codeToHtml(input, options));
      assert.equal(textOf(html), normalized, `${lang}: EOF byte ${end}`);
      spansOf(html);
      const tokens = codeToTokens(input, options).tokens;
      assert.equal(
        tokens
          .map((line) => line.map((token) => token.content).join(''))
          .join('\n'),
        normalized
      );
      const stream = new StreamTokenizer(options);
      stream.pushCode(normalized);
      stream.end();
      assert.deepEqual(
        codeToTokens(code, options).tokens,
        pristine,
        `${lang}: state after byte ${end}`
      );
    }
  });

  test(`${lang}: delimiter removal and restoration retokenize later lines`, () => {
    initFullModule();
    const live = new LiveTokenizer({ lang, theme: distinctTheme, code });
    let mirror = code;
    const start = code.lastIndexOf(delimiter);
    assert.ok(start >= 0);
    const before = code.slice(0, start).split('\n');
    const position = {
      line: before.length - 1,
      character: before.at(-1)!.length,
    };
    try {
      assertLiveMatches(live, mirror, lang, 'initial');
      for (const text of ['', delimiter]) {
        const length = text === '' ? delimiter.length : 0;
        live.applyEdits([
          {
            range: {
              start: position,
              end: { ...position, character: position.character + length },
            },
            newText: text,
          },
        ]);
        mirror = mirror.slice(0, start) + text + mirror.slice(start + length);
        assertLiveMatches(
          live,
          mirror,
          lang,
          text === '' ? 'remove delimiter' : 'restore delimiter'
        );
      }
      live.reset(open);
      assertLiveMatches(live, open, lang, 'reset to unterminated construct');
      live.reset(code);
      assertLiveMatches(live, code, lang, 'reset to original');
    } finally {
      live.dispose();
    }
  });

  test(`${lang}: seeded syntax edits match fresh tokenization after every edit`, () => {
    initFullModule();
    const live = new LiveTokenizer({ lang, theme: distinctTheme, code });
    const random = makeRand(0x715f + lang.length);
    let mirror = code;
    try {
      for (let round = 0; round < 40; round++) {
        // Pick code-point boundaries so the mirror never contains lone surrogates.
        const offsets = [0];
        for (const char of mirror) offsets.push(offsets.at(-1)! + char.length);
        const index = random() % offsets.length;
        const start = offsets[index];
        const end =
          offsets[Math.min(offsets.length - 1, index + (random() % 4))];
        const from = mirror.slice(0, start).split('\n');
        const to = mirror.slice(0, end).split('\n');
        const choices = ['', '\n', 'λ😀', ...fragments];
        const text = choices[random() % choices.length];
        live.applyEdits([
          {
            range: {
              start: { line: from.length - 1, character: from.at(-1)!.length },
              end: { line: to.length - 1, character: to.at(-1)!.length },
            },
            newText: text,
          },
        ]);
        mirror = mirror.slice(0, start) + text + mirror.slice(end);
        assertLiveMatches(
          live,
          mirror,
          lang,
          `edit ${round}: ${JSON.stringify(mirror)}`
        );
      }
    } finally {
      live.dispose();
    }
  });

  test(`${lang}: unterminated fenced constructs do not leak into later Markdown`, () => {
    const suffix = '\n# Heading\n\n```ts\nconst ready = true;\n```\n';
    for (const markup of ['markdown', 'mdx'] as const) {
      const prefix = `\`\`\`${lang}\n${open}\n\`\`\`\n`;
      const actual = assertLineFedParity(markup, prefix + suffix).slice(
        prefix.split('\n').length - 1
      );
      const expected = assertLineFedParity(markup, suffix);
      assert.deepEqual(
        actual.map((line) =>
          line.map((token) => ({
            ...token,
            offset: token.offset - prefix.length,
          }))
        ),
        expected,
        `${markup}: state after ${lang} fence`
      );
    }
  });
}
