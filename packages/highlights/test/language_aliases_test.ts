import { expect, test } from 'bun:test';

import { codeToTokens, type Lang } from '../lib/core';
import languages from '../lib/languages';
import { samples, zonSample } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  kindOfColor,
  tokenKinds,
} from './_util';

const additions = [
  ['apache', ['apache', 'apacheconf', 'htaccess', 'qmldir', 'ssh-config']],
  ['asciidoc', ['asciidoc', 'adoc']],
  ['bicep', ['bicep']],
  ['blade', ['blade', 'edge']],
  ['dotenv', ['dotenv', 'env']],
  ['gherkin', ['gherkin', 'cucumber', 'feature']],
  ['gnuplot', ['gnuplot', 'gp']],
  ['http', ['http']],
  ['log', ['log']],
  ['nginx', ['nginx', 'bird', 'bird2']],
  ['po', ['po', 'pot', 'potx']],
  ['prisma', ['prisma']],
  ['razor', ['razor', 'cshtml']],
  ['rst', ['rst', 'restructuredtext']],
  ['ini', ['ini', 'desktop', 'properties', 'systemd']],
  ['ada', ['ada', 'adb', 'ads']],
  ['apex', ['apex']],
  ['asm', ['mips', 'mipsasm', 'riscv']],
  ['awk', ['awk']],
  ['cobol', ['cobol', 'cbl', 'cob']],
  ['coffee', ['coffee', 'coffeescript']],
  ['css', ['postcss', 'qss']],
  ['erb', ['erb']],
  ['groovy', ['nextflow', 'nextflow-groovy', 'nf']],
  ['haml', ['haml']],
  ['handlebars', ['handlebars', 'hbs', 'mustache']],
  ['haxe', ['haxe', 'hx']],
  ['html', ['html-derivative']],
  ['jinja', ['jinja', 'j2', 'jinja2']],
  ['liquid', ['liquid']],
  ['plsql', ['plsql']],
  ['prolog', ['prolog']],
  ['promql', ['promql']],
  ['pug', ['pug', 'jade']],
  ['qml', ['qml']],
  ['tcl', ['tcl']],
  [
    'typescript',
    [
      'ts',
      'lit',
      'ts-tags',
      'actionscript',
      'actionscript-3',
      'as3',
      'tsp',
      'typespec',
      'vue-vine',
    ],
  ],
  ['twig', ['twig']],
  ['verilog', ['verilog', 'sv', 'svh', 'system-verilog', 'systemverilog']],
  ['vhdl', ['vhdl', 'vhd']],
  ['viml', ['viml', 'vim', 'vimscript']],
  ['vue', ['vue-html']],
  ['xml', ['xsl', 'xslt']],
  ['lean', ['lean', 'lean4']],
  ['gdresource', ['gdresource', 'godot-resource', 'tres', 'tscn']],
  ['gdscript', ['gdscript', 'gd']],
  ['gdshader', ['gdshader', 'godot-shader', 'gdshaderinc']],
  ['bat', ['batch', 'bat', 'batchfile', 'cmd', 'dos']],
  ['elm', ['elm']],
  ['cuda', ['cuda', 'cu', 'cuh']],
  ['csv', ['csv']],
  ['tsv', ['tsv']],
  [
    'fortran-free-form',
    ['fortran', 'fortran-free-form', 'f90', 'f95', 'f03', 'f08', 'f18'],
  ],
  ['fortran-fixed-form', ['fortran-fixed-form', 'f', 'for', 'f77']],
  ['groq', ['groq']],
  ['solidity', ['solidity', 'sol']],
  ['zig', ['zig', 'zon']],
  ['abap', ['abap']],
  ['applescript', ['applescript']],
  ['bibtex', ['bibtex', 'bib']],
  ['codeowners', ['codeowners']],
  ['codeql', ['codeql', 'ql']],
  ['coq', ['coq', 'rocq']],
  ['cypher', ['cypher', 'cql']],
  ['d', ['d']],
  ['dax', ['dax']],
  ['fish', ['fish']],
  ['hack', ['hack', 'ara']],
  ['jsonnet', ['jsonnet', 'libsonnet']],
  ['just', ['just', 'justfile']],
  ['kdl', ['kdl']],
  ['common-lisp', ['racket', 'rkt', 'clarity', 'lisp']],
  ['llvm', ['llvm']],
  ['luau', ['luau']],
  ['mermaid', ['mermaid', 'mmd']],
  ['moonbit', ['moonbit', 'mbt', 'mbti']],
  ['openscad', ['openscad', 'scad']],
  ['powerquery', ['powerquery', 'pq']],
  ['puppet', ['puppet']],
  ['reg', ['reg']],
  ['rosmsg', ['rosmsg']],
  ['sas', ['sas']],
  ['shaderlab', ['shaderlab', 'shader']],
  ['sparql', ['sparql']],
  ['stata', ['stata']],
  ['stylus', ['stylus', 'styl']],
  ['turtle', ['turtle', 'ttl']],
  ['typst', ['typst', 'typ']],
  ['wolfram', ['wolfram', 'wl', 'mathematica']],
  ['shellscript', ['console', 'hxml', 'bash']],
  ['clojure', ['fennel', 'hy']],
  ['csharp', ['genie', 'vala']],
  ['haskell', ['purescript']],
  ['python', ['mojo', 'vy', 'vyper']],
  ['ruby', ['crystal', 'rbs', 'ruby-signature']],
  ['rust', ['ron']],
  ['terraform', ['gn']],
  ['ahk', ['ahk', 'ahk1', 'ahk2', 'autohotkey']],
  ['apl', ['apl']],
  ['ballerina', ['ballerina', 'bal']],
  ['beancount', ['beancount']],
  ['berry', ['berry', 'be']],
  ['bsl', ['bsl', '1c']],
  ['cadence', ['cadence', 'cdc']],
  ['cairo', ['cairo']],
  ['chapel', ['chapel', 'chpl']],
  ['cue', ['cue']],
  ['dream-maker', ['dream-maker', 'dm']],
  ['fluent', ['fluent', 'ftl']],
  ['glimmer-js', ['glimmer-js', 'gjs']],
  ['glimmer-ts', ['glimmer-ts', 'gts']],
  ['hjson', ['hjson']],
  ['hurl', ['hurl']],
  ['imba', ['imba']],
  ['kusto', ['kusto', 'kql']],
  ['marko', ['marko']],
  ['move', ['move']],
  ['nsis', ['nsis', 'nsi', 'nsh']],
  ['nushell', ['nushell', 'nu']],
  ['org', ['org']],
  ['pkl', ['pkl']],
  ['raku', ['raku', 'perl6']],
  ['regexp', ['regexp', 'regex']],
  ['sdbl', ['sdbl', '1c-query']],
  ['smalltalk', ['smalltalk', 'st']],
  ['smithy', ['smithy']],
  ['splunk', ['splunk', 'spl']],
  ['surrealql', ['surrealql', 'surql']],
  ['talonscript', ['talonscript', 'talon']],
  ['templ', ['templ']],
  ['v', ['v']],
  ['vb', ['vb', 'vba', 'vbnet', 'vbscript']],
  ['wikitext', ['wikitext', 'mediawiki', 'wiki']],
  ['wit', ['wit']],
  ['zenscript', ['zenscript', 'zs']],
] as const satisfies readonly (readonly [Lang, readonly Lang[]])[];

test('mdc resolves to the Markdown lexer', () => {
  expect(languages.mdc).toBe(languages.markdown);
});

test('plain text aliases retain ID zero and bypass language syntax', () => {
  for (const alias of ['plain', 'plaintext', 'text', 'txt'] as const) {
    expect(languages[alias]).toBe(0);
    expect(tokenKinds(alias, 'if "λ😀" /* text */ <tag>')).toEqual([
      ['if "λ😀" /* text */ <tag>', null],
    ]);
  }
});

for (const [lang, aliases] of additions) {
  test(`${lang}: aliases and Markdown fences use the same lexer`, () => {
    initFullModule();
    const code = lang === 'zig' ? zonSample : samples[lang].code;
    const expected = codeToTokens(code, { lang, theme: distinctTheme })
      .tokens.slice(0, -1)
      .map((line) =>
        line.map((token) => [token.content, kindOfColor(token.color)])
      );
    for (const alias of aliases) {
      expect(tokenKinds(alias, code)).toEqual(tokenKinds(lang, code));
      for (const markup of ['markdown', 'mdx'] as const) {
        const fence = `\`\`\`${alias}\n${code}\`\`\`\n`;
        const actual = assertLineFedParity(markup, fence)
          .slice(1, expected.length + 1)
          .map((line) =>
            line.map((token) => [token.content, kindOfColor(token.color)])
          );
        expect(actual).toEqual(expected);
      }
    }
  });
}

test('CUDA words do not change ordinary C++ highlighting', () => {
  expect(tokenKinds('cpp', '__global__ int value;')).toContainEqual([
    '__global__',
    'variable',
  ]);
});
