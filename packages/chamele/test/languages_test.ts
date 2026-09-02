import assert from 'node:assert';
import t from 'node:test';

import type { Highlighter, Lang } from '../lib/index';
import { createHighlighter, init } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { spansOf, textOf } from './util';

const aliases: Lang[] = [
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'javascript',
  'typescript',
  'html',
  'htm',
  'css',
  'json',
  'jsonc',
  'bash',
  'sh',
  'shell',
  'zsh',
  'c',
  'h',
  'cpp',
  'c++',
  'cc',
  'cxx',
  'hh',
  'hpp',
  'hxx',
  'go',
  'golang',
  'py',
  'python',
  'rs',
  'rust',
  'yaml',
  'yml',
  'php',
  'sql',
  'swift',
  'haskell',
  'hs',
  'kotlin',
  'kt',
  'kts',
  'astro',
  'vue',
  'svelte',
  'xml',
  'svg',
  'xsd',
  'markdown',
  'md',
  'mdx',
  'asm',
  'assembly',
  's',
  'wat',
  'wasm',
  'diff',
  'patch',
  'glsl',
  'vert',
  'frag',
  'geom',
  'comp',
  'lua',
  'c3',
  'csharp',
  'cs',
  'c#',
  'dart',
  'elixir',
  'ex',
  'exs',
  'hlsl',
  'java',
  'less',
  'lisp',
  'cl',
  'el',
  'elisp',
  'emacs-lisp',
  'lsp',
  'scheme',
  'scm',
  'objc',
  'objective-c',
  'objectivec',
  'm',
  'mm',
  'objcpp',
  'objective-cpp',
  'ocaml',
  'ml',
  'mli',
  'perl',
  'pl',
  'pm',
  'proto',
  'protobuf',
  'ruby',
  'rb',
  'sass',
  'scss',
  'terraform',
  'tf',
  'tfvars',
  'hcl',
  'wgsl',
];
const canonical: Lang[] = [
  'js',
  'jsx',
  'ts',
  'tsx',
  'html',
  'css',
  'json',
  'bash',
  'c',
  'cpp',
  'go',
  'python',
  'rust',
  'yaml',
  'php',
  'sql',
  'swift',
  'haskell',
  'kotlin',
  'astro',
  'vue',
  'svelte',
  'xml',
  'markdown',
  'mdx',
  'asm',
  'wat',
  'diff',
  'glsl',
  'lua',
  'c3',
  'csharp',
  'dart',
  'elixir',
  'hlsl',
  'java',
  'less',
  'lisp',
  'objc',
  'ocaml',
  'perl',
  'proto',
  'ruby',
  'sass',
  'scss',
  'terraform',
  'wgsl',
];
const decoder = new TextDecoder();
let highlighter: Highlighter;

t.before(() => {
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  highlighter = init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

void t.test('languages: every public alias reaches a WAT lexer', () => {
  for (const lang of aliases) {
    const html = decoder.decode(
      highlighter.codeToHtml('x', { lang, theme: pierreDark })
    );
    assert.equal(textOf(html), 'x', lang);
    spansOf(html);
  }
});

void t.test(
  'languages: JS, JSX, TS, and TSX enable independent syntax layers',
  () => {
    const html = (lang: Lang, code: string) =>
      decoder.decode(highlighter.codeToHtml(code, { lang, theme: pierreDark }));
    const jsxCode = 'const view = <Box value={x} />;';
    const typeCode = 'type Result = string | number;';

    assert.equal(html('js', jsxCode), html('ts', jsxCode));
    assert.equal(html('jsx', jsxCode), html('tsx', jsxCode));
    assert.notEqual(html('js', jsxCode), html('jsx', jsxCode));

    assert.equal(html('js', typeCode), html('jsx', typeCode));
    assert.equal(html('ts', typeCode), html('tsx', typeCode));
    assert.notEqual(html('js', typeCode), html('ts', typeCode));
  }
);

void t.test('languages: deterministic cross-lexer invariant fuzz', () => {
  // BMP-only, so code-unit split('') equals code-point iteration
  const alphabet =
    'abcXYZ09 _-$#@/\\\'"`()[]{}<>=+*&|:;,.!?\n\r\t\0é_日本語'.split('');
  let seed = 0x9e3779b9;
  for (const lang of canonical) {
    for (let sample = 0; sample < 64; sample++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      let input = '';
      for (let n = seed & 63; n-- !== 0; ) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        input += alphabet[seed % alphabet.length];
      }
      const html = decoder.decode(
        highlighter.codeToHtml(input, { lang, theme: pierreDark })
      );
      assert.equal(textOf(html), input, `${lang}: ${JSON.stringify(input)}`);
      spansOf(html);
    }
  }
});

void t.test(
  'languages: every lexer preserves UTF-8 across every byte split',
  () => {
    const contexts = [
      'aé日本🙂z',
      '"aé日本🙂z"',
      '// aé日本🙂z\nx',
      '<p aé="日本🙂">é</p>',
    ];
    const encoder = new TextEncoder();
    for (const lang of canonical) {
      const entry = `$hl${lang[0].toUpperCase()}${lang.slice(1)}`;
      // the ecma lexers share tsx.wat and the css preprocessors css.wat
      const file = ['js', 'jsx', 'ts'].includes(lang)
        ? 'tsx'
        : ['less', 'sass', 'scss'].includes(lang)
          ? 'css'
          : lang;
      const url = new URL(`./utf8_split_${lang}.wat`, import.meta.url);
      const source = `(module
  (memory (export "memory") 3)
  (import "../src/langs/${file}.wat")
  (func (export "highlight")
    (call $hlBegin)
    (global.set $end (i32.add (global.get $ptr) (i32.load (i32.const 32))))
    (call ${entry})
    (global.set $end (global.get $eof))
    (call ${entry})
    (call $hlEnd)))`;
      const { code } = transformWat(url, source);
      const lexer = createHighlighter(
        new WebAssembly.Module(wat2wasm(url.pathname, code))
      );
      // The split offset is passed through a control word in wasm memory;
      // reach into the highlighter's internal DataView to write it.
      const lexerInternals = lexer as unknown as { dv: DataView };
      for (const input of contexts) {
        const length = encoder.encode(input).length;
        for (let split = 0; split <= length; split++) {
          lexerInternals.dv.setUint32(32, split, true);
          const html = decoder.decode(
            lexer.codeToHtml(input, { lang, theme: pierreDark })
          );
          assert.equal(textOf(html), input, `${lang}: byte ${split}/${length}`);
          spansOf(html);
        }
      }
    }
  }
);
