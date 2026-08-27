import assert from 'node:assert';
import t from 'node:test';

import { init } from '../lib/index.mjs';
import { transformWat, wat2wasm } from '../scripts/build.mjs';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { spansOf, textOf } from './util.mjs';

const aliases = [
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
];
const canonical = [
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
];
const decoder = new TextDecoder();
let highlighter;

t.before(() => {
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  highlighter = init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

t.test('languages: every public alias reaches a WAT lexer', () => {
  for (const lang of aliases) {
    const html = decoder.decode(
      highlighter.codeToHtml('x', { lang, theme: pierreDark })
    );
    assert.equal(textOf(html), 'x', lang);
    spansOf(html);
  }
});

t.test('languages: deterministic cross-lexer invariant fuzz', () => {
  const alphabet = [
    ...'abcXYZ09 _-$#@/\\\'"`()[]{}<>=+*&|:;,.!?\n\r\t\0é_日本語',
  ];
  let seed = 0x9e3779b9;
  for (const lang of canonical) {
    for (let sample = 0; sample < 64; sample++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      let input = '';
      for (let n = seed & 63; n--; ) {
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

t.test('languages: every lexer preserves UTF-8 across every byte split', () => {
  const contexts = [
    'aé日本🙂z',
    '"aé日本🙂z"',
    '// aé日本🙂z\nx',
    '<p aé="日本🙂">é</p>',
  ];
  const encoder = new TextEncoder();
  for (const lang of canonical) {
    const entry = `$hl${lang[0].toUpperCase()}${lang.slice(1)}`;
    const url = new URL(`./utf8_split_${lang}.wat`, import.meta.url);
    const source = `(module
  (memory (export "memory") 3)
  (import "../src/langs/${lang}.wat")
  (func (export "highlight")
    (call $hlBegin)
    (global.set $end (i32.add (global.get $ptr) (i32.load (i32.const 32))))
    (call ${entry})
    (global.set $end (global.get $eof))
    (call ${entry})
    (call $hlEnd)))`;
    const { code } = transformWat(url, source);
    const lexer = init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
    for (const input of contexts) {
      const length = encoder.encode(input).length;
      for (let split = 0; split <= length; split++) {
        lexer.dv.setUint32(32, split, true);
        const html = decoder.decode(
          lexer.codeToHtml(input, { lang, theme: pierreDark })
        );
        assert.equal(textOf(html), input, `${lang}: byte ${split}/${length}`);
        spansOf(html);
      }
    }
  }
});
