import assert from 'node:assert';
import t from 'node:test';

import { LANGS } from '../lib/highlighter';
import type { Highlighter, Lang } from '../lib/index';
import { init } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { spansOf, textOf } from './util';

const decoder = new TextDecoder();
const watUrl = new URL('../src/highlights.wat', import.meta.url);
const compiled = transformWat(watUrl);
const languageNames = new Set(
  Object.keys(compiled.enumMap.get('$Language') as Record<string, number>)
);
// every alias the runtime accepts, and one canonical name per lexer, both
// read from the tables themselves so a new language cannot be left out
const aliases = Object.keys(LANGS) as Lang[];
const canonical = Object.entries(LANGS)
  .filter(([name, id]) => id !== 0 && LANGS[name] === id && isCanonical(name))
  .map(([name]) => name as Lang);

/** The canonical name of a lexer is the one its `$Language` member uses. */
function isCanonical(name: string): boolean {
  return languageNames.has(name);
}

let highlighter: Highlighter;

t.before(() => {
  highlighter = init(
    new WebAssembly.Module(wat2wasm(watUrl.pathname, compiled.code))
  );
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
