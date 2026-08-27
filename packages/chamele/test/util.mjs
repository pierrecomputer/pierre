import assert from 'node:assert';

import { init } from '../lib/index.mjs';
import { compileTheme } from '../lib/theme.mjs';
import tokenTypes from '../lib/token-types.mjs';
import { listTokenTypes, transformWat, wat2wasm } from '../scripts/build.mjs';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const dec = new TextDecoder();
const tableCache = new Map();

/**
 * the exact `#rrggbb[aa]` (lowercase) the emitter prints for a capture name
 * under a theme (default: the bundled pierre-dark), resolved through the same
 * longest-prefix fallback the wasm table is built with; null when unthemed.
 * Test suites assert colors through this instead of duplicating theme hex.
 * @param {string} name $Token member name (e.g. "string.escape")
 * @param {object} [theme]
 * @returns {string | null}
 */
export function themeColor(name, theme = pierreDark) {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  let table = tableCache.get(theme.name);
  if (!table) tableCache.set(theme.name, (table = compileTheme(theme)));
  const [r, g, b, a] = table.subarray(i * 5, i * 5 + 4);
  if (!(r | g | b | a)) return null;
  const hex = (n) => n.toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b) + (a !== 0xff ? hex(a) : '');
}

/**
 * compile an in-memory harness that drives a single language lexer through
 * the shared emit.wat driver, without requiring a prior `pnpm build`
 * @param {string} name lang file name under src/langs (e.g. "json")
 * @param {string} funcName lexer entry (e.g. "$hlJson")
 * @param {number} [splitBytes] scan this byte prefix and the remaining live bytes as separate ranges
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
  const highlighter = init(new WebAssembly.Module(wasmBytes));
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

/** the inner HTML between the `<pre...><code>` wrapper */
export function bodyOf(html) {
  const m = html.match(WRAPPER_RE);
  assert.ok(m, `bad wrapper: ${html}`);
  return m[2];
}

/** strip tags and entities: must reproduce the exact input (lossless invariant) */
export function textOf(html) {
  return bodyOf(html)
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * every span start/end in order, checking balance; returns [{color, font, text}]
 * with (unescaped) text content per span; `font` is the `;font-...` tail of
 * the style attribute ("" when plain)
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
  while ((m = re.exec(body))) {
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

/** the color of the first span whose text contains `text` */
export function colorOf(html, text) {
  const span = spansOf(html).find((s) => s.text.includes(text));
  return span?.color;
}

/** assert the lossless invariant and span balance for one input */
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
