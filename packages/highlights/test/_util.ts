import assert from 'node:assert';

import type { Lang, Theme, ThemedToken, ThemeFamily } from '../lib/index';
import {
  codeToTokens,
  createHighlighter,
  init,
  StreamTokenizer,
} from '../lib/index';
import { compileTheme } from '../lib/theme';
import tokenTypes from '../lib/token-types';
import { listTokenTypes, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const dec = new TextDecoder();
const tableCache = new WeakMap<Theme, Uint8Array>();

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
  let table = tableCache.get(theme);
  if (table === undefined) {
    tableCache.set(theme, (table = compileTheme(theme)));
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
  // the css preprocessors share css.wat
  const file = ['less', 'sass', 'scss'].includes(name) ? 'css' : name;
  const src = `(module
  (memory (export "memory") 3)
  (import "../src/langs/${file}.wat")
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

/** A lexer harness whose scan is cut at a byte offset chosen per call. */
export type TestSplitHl = (
  input: string | Uint8Array,
  splitBytes: number
) => string;

/**
 * Compile one lexer into a harness that runs it twice per highlight: first
 * over `[0, splitBytes)`, then over the rest. That is the two-range shape an
 * embedding host (html around a script body) or a chunk boundary produces, so
 * a lexer that reads past `$end` or leaves a construct half-open shows up as
 * lost bytes or unbalanced spans. One module serves every split offset: the
 * offset is passed through a control word at byte 32 of wasm memory, below
 * the theme table.
 *
 * `name` is the language name; the lexer file and export follow the usual
 * naming (`js`/`jsx`/`ts` live in `tsx.wat`, the css dialects in `css.wat`).
 */
export function loadSplitLang(name: Lang): TestSplitHl {
  const entry = `$hl${name[0].toUpperCase()}${name.slice(1)}`;
  const file = ['js', 'jsx', 'ts'].includes(name)
    ? 'tsx'
    : ['less', 'sass', 'scss'].includes(name)
      ? 'css'
      : name;
  const watUrl = new URL(`./split_${name}.wat`, import.meta.url);
  const src = `(module
  (memory (export "memory") 3)
  (import "../src/langs/${file}.wat")
  (func (export "highlight")
    (call $hlBegin)
    (global.set $end (i32.add (global.get $ptr) (i32.load (i32.const 32))))
    (call ${entry})
    (global.set $end (global.get $eof))
    (call ${entry})
    (call $hlEnd)))`;
  const { code } = transformWat(watUrl, src);
  const highlighter = createHighlighter(
    new WebAssembly.Module(wat2wasm(watUrl.href, code))
  );
  // the control word lives in the highlighter's memory; reach in for its view
  const internals = highlighter as unknown as { dv: DataView };
  return (input, splitBytes) => {
    internals.dv.setUint32(32, splitBytes, true);
    return dec.decode(
      highlighter.codeToHtml(input, { lang: name, theme: pierreDark })
    );
  };
}

const WRAPPER_RE =
  /^<pre class="highlights"( style="[^"<>]*")?><code>([\s\S]*)<\/code><\/pre>$/;

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

// ---- distinct-theme helpers ----
// Pierre Dark paints several token kinds alike (function and function.method,
// comment and comment.doc), and the emitter merges same-colored neighbors
// into one span, so a color check can pass on a misclassified token that
// happens to share its neighbor's color. Under `distinctTheme` every kind has
// its own color, a span boundary is a classification boundary, and
// `spanKinds` names each span's kind for token-by-token assertions.

const distinctNames = tokenTypes.filter(
  (name) => !['background', 'foreground', 'none'].includes(name)
);
const distinctColorOf = new Map(
  distinctNames.map((name, i) => [
    name,
    '#' + (0x100000 + i * 0x101).toString(16),
  ])
);
const distinctNameOf = new Map(
  [...distinctColorOf].map(([name, color]) => [color, name])
);

/** A theme giving every token type its own color; plain text stays white. */
export const distinctTheme = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(distinctColorOf),
  },
} as unknown as Theme;

/** The distinct theme's color for a token type name. */
export function distinctColor(name: string): string {
  const color = distinctColorOf.get(name);
  assert.ok(color !== undefined, `unknown or unthemed token type: ${name}`);
  return color;
}

/** The token type behind a distinct-theme color; plain text is `null`. */
export function kindOfColor(color: string | null | undefined): string | null {
  if (color == null || color === '#ffffff') return null;
  return distinctNameOf.get(color) ?? color;
}

/**
 * Trimmed text and token kind of every non-blank span of distinct-theme
 * HTML, in source order. Neighboring tokens of one kind merge into one entry.
 */
export function spanKinds(html: string): [string, string | null][] {
  return spansOf(html)
    .map((s): [string, string | null] => [s.text.trim(), kindOfColor(s.color)])
    .filter(([text]) => text !== '');
}

/**
 * Trimmed text and kind of every non-blank token of a whole-buffer run under
 * the distinct theme, in source order. Unlike `spanKinds`, plain text is
 * listed (as `null`) and a line break always separates entries, so a
 * multi-line sequence reads line by line instead of merging same-kind spans
 * across the break.
 */
export function tokenKinds(
  lang: Lang,
  code: string
): [string, string | null][] {
  initFullModule();
  return codeToTokens(code, { lang, theme: distinctTheme })
    .tokens.flat()
    .map((tok): [string, string | null] => [
      tok.content.trim(),
      kindOfColor(tok.color),
    ])
    .filter(([text]) => text !== '');
}

/** The color of the first span whose trimmed text is exactly `word`. */
export function exactColor(
  html: string,
  word: string
): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

/**
 * The color of the first span whose text, split on whitespace, contains
 * `word`. Neighboring tokens of one kind merge into a single span, so
 * `then break` is one span in HTML mode; this looks inside such merges.
 */
export function wordColor(
  html: string,
  word: string
): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim().split(/\s+/).includes(word))
    ?.color;
}

// ---- whole-module helpers ----

let fullModuleReady = false;

/**
 * Compile src/highlights.wat once and install it as the shared highlighter, so
 * `codeToTokens` and `StreamTokenizer` work. Lazy: single-lexer tests still
 * run while another language file is mid-edit.
 */
export function initFullModule(): void {
  if (fullModuleReady) return;
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
  fullModuleReady = true;
}

/** Token content and kind per line under the distinct theme, for diffs. */
export function flatTokens(lines: ThemedToken[][]): string {
  return lines
    .map((line) =>
      line
        .map(
          (tok) =>
            `${JSON.stringify(tok.content)}:${kindOfColor(tok.color) ?? 'none'}`
        )
        .join(' ')
    )
    .join('\n');
}

/**
 * Tokens for `code` fed to a StreamTokenizer one line per push - the chunk
 * shape the LiveTokenizer uses.
 */
export function lineFedTokens(lang: Lang, code: string): ThemedToken[][] {
  initFullModule();
  const stream = new StreamTokenizer({ lang, theme: distinctTheme });
  const out: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) out.push(...stream.pushCode(line));
  out.push(...stream.end());
  return out;
}

/**
 * Assert that line-fed streaming yields exactly the whole-buffer tokens of
 * `code`, and return them.
 */
export function assertLineFedParity(
  lang: Lang,
  code: string,
  label?: string
): ThemedToken[][] {
  initFullModule();
  const whole = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
  assert.deepEqual(
    lineFedTokens(lang, code),
    whole,
    `${lang}${label === undefined ? '' : `: ${label}`}: ${JSON.stringify(code)}`
  );
  return whole;
}

/** Deterministic random values for reproducible input and edit fuzzing. */
export function makeRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 4;
  };
}
