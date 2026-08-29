import assert from 'node:assert';

import { createHighlighter } from '../lib/index.mjs';
import { compileTheme } from '../lib/theme.mjs';
import tokenTypes from '../lib/token-types.mjs';
import { listTokenTypes, transformWat, wat2wasm } from '../scripts/build.mjs';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const dec = new TextDecoder();
const tableCache = new Map();

/**
 * Return the emitter's lowercase `#rrggbb[aa]` for a token capture. Defaults to
 * Pierre Dark, uses the theme table's longest-prefix fallback, and returns
 * `null` when unthemed. Tests use it instead of hard-coded colors.
 * @param {string} name `$Token` name, such as `"string.escape"`
 * @param {object} [theme]
 * @returns {string | null}
 */
export function themeColor(name, theme = pierreDark) {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  let table = tableCache.get(theme.name);
  if (table === undefined) {
    tableCache.set(theme.name, (table = compileTheme(theme)));
  }
  const [r, g, b, a] = table.subarray(i * 5, i * 5 + 4);
  if ((r | g | b | a) === 0) return null;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b) + (a !== 0xff ? hex(a) : '');
}

/**
 * Compile one language lexer with the shared emitter into an in-memory test
 * highlighter. No package build is required.
 * @param {string} name file under `src/langs`, such as `"json"`
 * @param {string} funcName lexer export, such as `"$hlJson"`
 * @param {number} [splitBytes] byte offset between two live scan ranges
 * @returns {{hl: (input: string | Uint8Array | ArrayBuffer, options?: object) => string,
 *   tokenTypes: string[], enumMap: Map<string, Record<string, number>>}}
 */
export function loadLang(name, funcName, splitBytes) {
  const watUrl = new URL(`./test_${name}.wat`, import.meta.url);
  const clamp =
    splitBytes === undefined
      ? ''
      : `(global.set $end (i32.add (global.get $ptr) (i32.const ${splitBytes})))`;
  const resume =
    splitBytes === undefined
      ? ''
      : `(global.set $end (global.get $eof))\n    (call ${funcName})`;
  const src = `(module
  (memory (export "memory") 3)
  (import "../src/langs/${name}.wat")
  (func (export "highlight")
    (call $hlBegin)
    ${clamp}
    (call ${funcName})
    ${resume}
    (call $hlEnd))
)`;
  const { code, enumMap } = transformWat(watUrl, src);
  const wasmBytes = wat2wasm(watUrl.href, code);
  const tokenTypes = listTokenTypes(enumMap);
  // Use an isolated highlighter so this harness does not replace the shared one
  // used by token tests.
  const highlighter = createHighlighter(new WebAssembly.Module(wasmBytes));
  return {
    tokenTypes,
    enumMap,
    hl: (input, options) =>
      dec.decode(
        highlighter.codeToHtml(input, {
          lang: name,
          theme: pierreDark,
          ...options,
        })
      ),
  };
}

const WRAPPER_RE =
  /^<pre class="chamele"( style="[^"<>]*")?><code>([\s\S]*)<\/code><\/pre>$/;

/**
 * Read the HTML inside the `<pre><code>` wrapper.
 * @param {string} html
 * @returns {string}
 */
export function bodyOf(html) {
  const m = html.match(WRAPPER_RE);
  assert.ok(m !== null, `bad wrapper: ${html}`);
  return m[2];
}

/**
 * Strip span tags and decode entities to recover the exact input.
 * @param {string} html
 * @returns {string}
 */
export function textOf(html) {
  return bodyOf(html)
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Return spans in source order and assert balanced tags. Text is entity-decoded;
 * `font` is the `;font-*` suffix, or `""` when plain.
 * @param {string} html
 * @returns {{color: string | null, font: string | null, text: string}[]}
 */
export function spansOf(html) {
  const body = bodyOf(html);
  const out = [];
  let depth = 0;
  let color = null;
  let font = null;
  let start = 0;
  const re = /<span style="color:([^";<>]*)((?:;[^"<>]*)?)">|<\/span>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[0] === '</span>') {
      assert.equal(depth, 1, `unbalanced </span> in ${html}`);
      depth = 0;
      out.push({
        color,
        font,
        text: body
          .slice(start, m.index)
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&'),
      });
    } else {
      assert.equal(depth, 0, `nested <span> in ${html}`);
      depth = 1;
      color = m[1];
      font = m[2];
      start = m.index + m[0].length;
    }
  }
  assert.equal(depth, 0, `unclosed <span> in ${html}`);
  return out;
}

/**
 * Return the color of the first span containing `text`.
 * @param {string} html
 * @param {string} text
 * @returns {string | null | undefined}
 */
export function colorOf(html, text) {
  const span = spansOf(html).find((s) => s.text.includes(text));
  return span?.color;
}

/** Assert lossless output and balanced spans. */
export function checkInvariants(hl, input, options) {
  const html = hl(input, options);
  assert.equal(
    textOf(html),
    input,
    `lossless invariant broken for ${JSON.stringify(input)}`
  );
  spansOf(html); // asserts balance
  return html;
}
