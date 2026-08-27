import { compileTheme } from './theme.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;
const themePtr = 6848;
const themeBytes = 1024;
const themeBuildCache = new Map();

const LANGS = {
  asm: 1,
  assembly: 1,
  s: 1,
  astro: 2,
  bash: 3,
  sh: 3,
  shell: 3,
  zsh: 3,
  c: 4,
  h: 4,
  'c++': 5,
  cc: 5,
  cpp: 5,
  cxx: 5,
  hh: 5,
  hpp: 5,
  hxx: 5,
  css: 6,
  diff: 7,
  patch: 7,
  comp: 8,
  frag: 8,
  geom: 8,
  glsl: 8,
  vert: 8,
  go: 9,
  golang: 9,
  haskell: 10,
  hs: 10,
  htm: 11,
  html: 11,
  json: 12,
  jsonc: 12,
  kotlin: 13,
  kt: 13,
  kts: 13,
  lua: 14,
  markdown: 15,
  md: 15,
  mdx: 16,
  php: 17,
  py: 18,
  python: 18,
  rs: 19,
  rust: 19,
  sql: 20,
  svelte: 21,
  swift: 22,
  toml: 23,
  cjs: 24,
  cts: 24,
  javascript: 24,
  js: 24,
  jsx: 24,
  mjs: 24,
  mts: 24,
  ts: 24,
  tsx: 24,
  typescript: 24,
  vue: 25,
  wasm: 26,
  wat: 26,
  svg: 27,
  xml: 27,
  xsd: 27,
  yaml: 28,
  yml: 28,
  zig: 29,
};

class Highlighter {
  /** @param {WebAssembly.Module} wasmModule */
  constructor(wasmModule) {
    const env = {
      is_id_start: (ptr, bits) =>
        /^\p{ID_Start}$/u.test(this.readChars(ptr, bits)),
      is_id_continue: (ptr, bits) =>
        /^[\u200C\u200D\p{ID_Continue}]$/u.test(this.readChars(ptr, bits)),
    };
    const instance = new WebAssembly.Instance(wasmModule, { env });
    this.memory = instance.exports.memory;
    this.highlight = instance.exports.highlight;
    this.bindMemory();
  }

  /**
   * Highlight the input code as HTML.
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {{lang: string, theme: import("./index.d.ts").Theme | import("./index.d.ts").ThemeFamily}} options
   * @returns {Uint8Array} View of the HTML bytes in wasm memory (valid until the next call).
   */
  codeToHtml(input, { lang, theme }) {
    if (
      typeof input !== 'string' &&
      !(input instanceof Uint8Array) &&
      !(input instanceof ArrayBuffer)
    ) {
      throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
    }
    const langId = LANGS[String(lang).toLowerCase()];
    if (typeof langId !== 'number')
      throw new RangeError(`unknown lang: ${lang}`);
    const resolvedTheme = theme && 'themes' in theme ? theme.themes[0] : theme;
    if (
      !resolvedTheme ||
      typeof resolvedTheme !== 'object' ||
      !resolvedTheme.name
    ) {
      throw new TypeError('invalid theme');
    }
    const useCssVariables = resolvedTheme.cssVariables === true;
    let themeTable;
    if (!useCssVariables) {
      themeTable = themeBuildCache.get(resolvedTheme.name);
      if (!themeTable) {
        themeTable = compileTheme(resolvedTheme);
        themeBuildCache.set(resolvedTheme.name, themeTable);
      }
    }
    let inputLength;
    if (typeof input === 'string') {
      // Fast path: dest of input.length (ASCII). Grow for UTF-8 if encodeInto stalls.
      this.growMemoryIfNeeded(input.length + 96);
      let { read, written } = enc.encodeInto(
        input,
        this.buffer.subarray(pageSize, pageSize + input.length)
      );
      if (read < input.length) {
        // UTF-8 expanded; dest is 3 bytes per remaining UTF-16 code unit (BMP worst case).
        const rest = input.slice(read);
        this.growMemoryIfNeeded(written + rest.length * 3 + 96);
        written += enc.encodeInto(
          rest,
          this.buffer.subarray(
            pageSize + written,
            pageSize + written + rest.length * 3
          )
        ).written;
      }
      inputLength = written;
    } else {
      if (input instanceof ArrayBuffer) {
        input = new Uint8Array(input);
      }
      this.growMemoryIfNeeded(input.length + 96);
      this.buffer.set(input, pageSize);
      inputLength = input.length;
    }
    if (!useCssVariables && this.themeWritten !== themeTable) {
      this.buffer.set(themeTable, themePtr);
      this.buffer.fill(0, themePtr + themeTable.length, themePtr + themeBytes);
      this.themeWritten = themeTable;
    }
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, useCssVariables);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[pageSize + inputLength] = 0; // NUL sentinel: lexers treat byte 0 at EOF as end
    try {
      this.highlight();
    } finally {
      this.bindMemory();
    }
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return this.buffer.subarray(outStart, outStart + outLength);
  }

  /** Grow the wasm linear memory if needed. */
  growMemoryIfNeeded(len) {
    const neededPages = 1 + Math.ceil(len / pageSize);
    if (neededPages > this.pageN) {
      this.memory.grow(neededPages - this.pageN);
      this.bindMemory();
    }
  }

  /** Read one UTF-8 character from wasm memory. */
  readChars(ptr, length) {
    this.bindMemory();
    return dec.decode(this.buffer.subarray(ptr, ptr + length));
  }

  /** Rebind views after growing wasm memory. */
  bindMemory() {
    if (this.buffer?.buffer === this.memory.buffer) return;
    this.pageN = this.memory.buffer.byteLength / pageSize;
    this.buffer = new Uint8Array(this.memory.buffer);
    this.dv = new DataView(this.memory.buffer);
  }
}

/**
 * The shared highlighter instance.
 * @type {Highlighter}
 */
let shared;

/**
 * Initialize the wasm module.
 * @param {WebAssembly.Module} wasmModule
 * @returns {Highlighter}
 */
export function init(wasmModule) {
  return (shared = new Highlighter(wasmModule));
}

/**
 * Highlight the input code as HTML.
 * @type {Highlighter["codeToHtml"]}
 */
export function codeToHtml(input, options) {
  return shared.codeToHtml(input, options);
}
