import assert from 'node:assert';

import type { Lang, Theme, ThemeFamily } from '../lib/index';
import { createHighlighter } from '../lib/index';
import { compileTheme } from '../lib/theme';
import tokenTypes from '../lib/token-types';
import { listTokenTypes, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const dec = new TextDecoder();
const tableCache = new Map<string, Uint8Array>();

/** Options tests may pass through `loadLang`'s `hl` to `codeToHtml`. */
export interface TestHlOptions {
  lang?: Lang;
  theme?: Theme | ThemeFamily;
}

/** One language lexer compiled into an in-memory test highlighter. */
export interface TestLang {
  /**
   * Highlight to an HTML string. `input` is `unknown` because several tests
   * deliberately feed invalid inputs and assert the thrown TypeError.
   */
  hl: (input: unknown, options?: TestHlOptions) => string;
  tokenTypes: string[];
  enumMap: Map<string, Record<string, number>>;
}

/**
 * Return the emitter's lowercase `#rrggbb[aa]` for a token capture. Defaults to
 * Pierre Dark, uses the theme table's longest-prefix fallback, and returns
 * `null` when unthemed. Tests use it instead of hard-coded colors.
 *
 * `name` is a `$Token` name, such as `"string.escape"`.
 */
export function themeColor(
  name: string,
  theme: Theme = pierreDark
): string | null {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  let table = tableCache.get(theme.name);
  if (table === undefined) {
    tableCache.set(theme.name, (table = compileTheme(theme)));
  }
  const [r, g, b, a] = table.subarray(i * 5, i * 5 + 4);
  if ((r | g | b | a) === 0) return null;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b) + (a !== 0xff ? hex(a) : '');
}

/**
 * Compile one language lexer with the shared emitter into an in-memory test
 * highlighter. No package build is required.
 *
 * `name` is the file under `src/langs`, such as `"json"`; `funcName` is the
 * lexer export, such as `"$hlJson"`. `splitBytes` optionally sets the byte
 * offset between two live scan ranges.
 */
export function loadLang(
  name: Lang,
  funcName: string,
  splitBytes?: number
): TestLang {
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
        highlighter.codeToHtml(input as string, {
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
 */
export function bodyOf(html: string): string {
  const m = html.match(WRAPPER_RE);
  assert.ok(m !== null, `bad wrapper: ${html}`);
  return m[2];
}

/**
 * Strip span tags and decode entities to recover the exact input.
 */
export function textOf(html: string): string {
  return bodyOf(html)
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** One `<span>` of highlighter output in source order. */
export interface TestSpan {
  color: string | null;
  /** The `;font-*` style suffix, or `""` when plain. */
  font: string | null;
  /** Entity-decoded span text. */
  text: string;
}

/**
 * Return spans in source order and assert balanced tags.
 */
export function spansOf(html: string): TestSpan[] {
  const body = bodyOf(html);
  const out: TestSpan[] = [];
  let depth = 0;
  let color: string | null = null;
  let font: string | null = null;
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
 */
export function colorOf(html: string, text: string): string | null | undefined {
  const span = spansOf(html).find((s) => s.text.includes(text));
  return span?.color;
}

/** Assert lossless output and balanced spans. */
export function checkInvariants(
  hl: TestLang['hl'],
  input: string,
  options?: TestHlOptions
): string {
  const html = hl(input, options);
  assert.equal(
    textOf(html),
    input,
    `lossless invariant broken for ${JSON.stringify(input)}`
  );
  spansOf(html); // asserts balance
  return html;
}
