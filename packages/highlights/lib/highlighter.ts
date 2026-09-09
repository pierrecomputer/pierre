import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  Highlighter,
  Lang,
  Theme,
  ThemedToken,
  TokensResult,
} from './index';
import { compileTheme } from './theme';
import type { ResolvedTheme } from './tokens';
import { lineRecordsToTokens, resolveOptionThemes, themeMeta } from './tokens';

const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;
const themePtr = 64; // $mem.themeTable in src/memory.wat
const themeBytes = 384; // 73 five-byte records, padded for SIMD comparisons
const themeBuildCache = new WeakMap<Theme, Uint8Array>();
// Unicode identifier classes for the ECMAScript lexers; see #idClass.
const idClassRegex = [/^\p{ID_Start}$/u, /^[\u200C\u200D\p{ID_Continue}]$/u];
let idClassCache: Uint8Array | undefined;

/**
 * Map of language names to their Wasm language ID.
 *
 * Ordered by the ID first, then the language name.
 */
export const LANGS: Record<string, number> = {
  plain: 0,
  plaintext: 0,
  text: 0,
  txt: 0,
  'angular-html': 1,
  asm: 2,
  assembly: 2,
  s: 2,
  astro: 3,
  bash: 4,
  sh: 4,
  shell: 4,
  zsh: 4,
  c: 5,
  h: 5,
  c3: 6,
  clj: 7,
  cljc: 7,
  cljs: 7,
  clojure: 7,
  edn: 7,
  cmake: 8,
  'c++': 9,
  cc: 9,
  cpp: 9,
  cxx: 9,
  hh: 9,
  hpp: 9,
  hxx: 9,
  'c#': 10,
  cs: 10,
  csharp: 10,
  css: 11,
  dart: 12,
  diff: 13,
  patch: 13,
  containerfile: 14,
  docker: 14,
  dockerfile: 14,
  elixir: 15,
  ex: 15,
  exs: 15,
  erl: 16,
  erlang: 16,
  hrl: 16,
  'f#': 17,
  fs: 17,
  fsharp: 17,
  fsi: 17,
  fsx: 17,
  gleam: 18,
  comp: 19,
  frag: 19,
  geom: 19,
  glsl: 19,
  vert: 19,
  go: 20,
  golang: 20,
  gql: 21,
  graphql: 21,
  gradle: 22,
  groovy: 22,
  gsh: 22,
  gvy: 22,
  gy: 22,
  haskell: 23,
  hs: 23,
  hlsl: 24,
  htm: 25,
  html: 25,
  java: 26,
  cjs: 27,
  javascript: 27,
  js: 27,
  mjs: 27,
  json: 28,
  jsonc: 28,
  jsx: 29,
  jl: 30,
  julia: 30,
  kotlin: 31,
  kt: 31,
  kts: 31,
  less: 32,
  cl: 33,
  el: 33,
  elisp: 33,
  'emacs-lisp': 33,
  lisp: 33,
  lsp: 33,
  scheme: 33,
  scm: 33,
  lua: 34,
  make: 35,
  makefile: 35,
  mk: 35,
  markdown: 36,
  md: 36,
  matlab: 37,
  octave: 37,
  mdx: 38,
  nix: 39,
  m: 40,
  mm: 40,
  objc: 40,
  objcpp: 40,
  'objective-c': 40,
  'objective-cpp': 40,
  objectivec: 40,
  ml: 41,
  mli: 41,
  ocaml: 41,
  delphi: 42,
  dpk: 42,
  dpr: 42,
  lpr: 42,
  'object-pascal': 42,
  objectpascal: 42,
  pas: 42,
  pascal: 42,
  pp: 42,
  perl: 43,
  pl: 43,
  pm: 43,
  php: 44,
  powershell: 45,
  ps: 45,
  ps1: 45,
  psd1: 45,
  psm1: 45,
  pwsh: 45,
  proto: 46,
  protobuf: 46,
  py: 47,
  python: 47,
  r: 48,
  rscript: 48,
  rb: 49,
  ruby: 49,
  rs: 50,
  rust: 50,
  sass: 51,
  sbt: 52,
  sc: 52,
  scala: 52,
  scss: 53,
  sql: 54,
  svelte: 55,
  swift: 56,
  hcl: 57,
  terraform: 57,
  tf: 57,
  tfvars: 57,
  toml: 58,
  'angular-ts': 59,
  cts: 59,
  mts: 59,
  ts: 59,
  typescript: 59,
  tsrx: 60,
  tsx: 61,
  vue: 62,
  wasm: 63,
  wat: 63,
  wgsl: 64,
  svg: 65,
  xml: 65,
  xsd: 65,
  yaml: 66,
  yml: 66,
  zig: 67,
};

/** Resolve the Wasm language ID for a name or alias, or throw. */
export function langIdOf(lang: string): number {
  const langId = LANGS[String(lang).toLowerCase()];
  if (typeof langId !== 'number') throw new RangeError(`unknown lang: ${lang}`);
  return langId;
}

/**
 * Check whether a name or alias has a built-in lexer, including `plain`/`text`.
 */
export function isSupportedLanguage(lang: string): lang is Lang {
  return typeof LANGS[String(lang).toLowerCase()] === 'number';
}

export class HighlightsHighlighter implements Highlighter {
  #highlight: () => void;
  #highlightStream: (reset: number | boolean) => void;
  #themeWritten: Uint8Array | undefined;
  wasmModule: WebAssembly.Module;
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  buffer: Uint8Array;
  dv: DataView;
  pageN: number;

  constructor(wasmModule: WebAssembly.Module) {
    this.wasmModule = wasmModule;
    const env = {
      is_id_start: (ptr: number, len: number) => this.#idClass(ptr, len, 0),
      is_id_continue: (ptr: number, len: number) => this.#idClass(ptr, len, 2),
    };
    const instance = new WebAssembly.Instance(wasmModule, { env });
    this.instance = instance;
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.#highlight = instance.exports.highlight as () => void;
    this.#highlightStream = instance.exports.highlightStream as (
      reset: number | boolean
    ) => void;
    this.pageN = this.memory.buffer.byteLength / pageSize;
    this.buffer = new Uint8Array(this.memory.buffer);
    this.dv = new DataView(this.memory.buffer);
  }

  /**
   * Encode `str` at byte offset `at` relative to the text buffer, growing
   * memory as needed.
   * Returns the number of bytes written.
   */
  #encodeAt(str: string, at: number): number {
    // Try an ASCII-sized destination first; grow if UTF-8 needs more room.
    this.#growMemoryIfNeeded(at + str.length + 96);
    let { read, written } = enc.encodeInto(
      str,
      this.buffer.subarray(pageSize + at, pageSize + at + str.length)
    );
    if (read < str.length) {
      // Allow three bytes per remaining UTF-16 code unit.
      const rest = str.slice(read);
      this.#growMemoryIfNeeded(at + written + rest.length * 3 + 96);
      written += enc.encodeInto(
        rest,
        this.buffer.subarray(
          pageSize + at + written,
          pageSize + at + written + rest.length * 3
        )
      ).written;
    }
    return written;
  }

  /**
   * Write input to the text buffer and return its byte length.
   */
  writeInput(input: string | Uint8Array | ArrayBuffer): number {
    if (typeof input === 'string') {
      return this.#encodeAt(input, 0);
    }
    if (input instanceof ArrayBuffer) {
      input = new Uint8Array(input);
    }
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
    }
    this.#growMemoryIfNeeded(input.length + 96);
    this.buffer.set(input, pageSize);
    return input.length;
  }

  /**
   * Run the lexer over the first `inputLength` bytes: 0 inline colors, 1 CSS
   * variables, 2 byte-end records, or 3 UTF-16 line records.
   * Returns a `Uint8Array` view of Wasm memory, valid until the next call.
   */
  #run(langId: number, mode: number, inputLength: number): Uint8Array {
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, mode);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[pageSize + inputLength] = 0; // NUL sentinel: lexers treat byte 0 at EOF as end
    try {
      this.#highlight();
    } finally {
      this.bindMemory();
    }
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return this.buffer.subarray(outStart, outStart + outLength);
  }

  /**
   * Highlight the input code as HTML.
   * Returns a view of the HTML bytes in wasm memory (valid until the next call).
   */
  codeToHtml(
    input: string | Uint8Array | ArrayBuffer,
    { lang, theme }: CodeToHtmlOptions
  ): Uint8Array {
    const langId = langIdOf(lang);
    const resolvedTheme =
      theme != null && 'themes' in theme ? theme.themes[0] : theme;
    if (
      resolvedTheme == null ||
      typeof resolvedTheme !== 'object' ||
      typeof resolvedTheme.name !== 'string' ||
      resolvedTheme.name === ''
    ) {
      throw new TypeError('invalid theme');
    }
    const useCssVariables = resolvedTheme.cssVariables === true;
    let themeTable: Uint8Array | undefined;
    if (!useCssVariables) {
      themeTable = themeBuildCache.get(resolvedTheme);
      if (themeTable === undefined) {
        themeTable = compileTheme(resolvedTheme);
        themeBuildCache.set(resolvedTheme, themeTable);
      }
    }
    const inputLength = this.writeInput(input);
    if (themeTable !== undefined && this.#themeWritten !== themeTable) {
      this.buffer.set(themeTable, themePtr);
      this.buffer.fill(0, themePtr + themeTable.length, themePtr + themeBytes);
      this.#themeWritten = themeTable;
    }
    return this.#run(langId, useCssVariables ? 1 : 0, inputLength);
  }

  /**
   * Tokenize the first `inputLength` buffered bytes into `(end, tokenId)` pairs
   * that tile the input. The `Uint32Array` view expires on the next call.
   * No theme table is written; JavaScript resolves the colors.
   */
  tokenizeRecords(langId: number, inputLength: number): Uint32Array {
    const out = this.#run(langId, 2, inputLength);
    return new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  }

  /** Tokenize one stream chunk to line records while preserving lexer state. */
  streamTokenizeLineRecords(
    langId: number,
    inputLength: number,
    reset: boolean
  ): Uint32Array {
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, 3);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[pageSize + inputLength] = 0;
    try {
      this.#highlightStream(reset);
    } finally {
      this.bindMemory();
    }
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return new Uint32Array(this.buffer.buffer, outStart, outLength >> 2);
  }

  /** Return UTF-16 token records with `0xffffffff` newline markers. */
  tokenizeLineRecords(langId: number, inputLength: number): Uint32Array {
    const out = this.#run(langId, 3, inputLength);
    return new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  }

  /**
   * Tokenize code into Shiki-compatible themed tokens, one array per line.
   */
  codeToTokens(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToTokensOptions
  ): TokensResult {
    const code = toCode(input);
    const themes = resolveOptionThemes(options);
    const cssVariablePrefix = options.cssVariablePrefix ?? '--hls-';
    const recs = this.tokenizeLineRecords(
      langIdOf(options.lang),
      this.writeInput(code)
    );
    const tokens = lineRecordsToTokens(
      code,
      recs,
      recs.length >> 1,
      themes,
      cssVariablePrefix,
      options.tokenizeMaxLineLength
    );
    return { tokens, ...themeMeta(themes, cssVariablePrefix) };
  }

  /** Grow the wasm linear memory if needed. */
  #growMemoryIfNeeded(len: number): void {
    const neededPages = 1 + Math.ceil(len / pageSize);
    if (neededPages > this.pageN) {
      this.memory.grow(neededPages - this.pageN);
      this.bindMemory();
    }
  }

  /**
   * Answer the ECMAScript lexers' `is_id_start` / `is_id_continue` imports
   * for the non-ASCII code point encoded at `ptr` (`len` bytes long).
   * `shift` selects the class: 0 for ID_Start, 2 for ID_Continue. The lexer
   * asks once per code point, so the Unicode regex only runs on a cache miss;
   * the cache stores 2 bits per class per BMP code point (0 unknown, 1 no,
   * 2 yes) and astral code points fall back to the regex.
   */
  #idClass(ptr: number, len: number, shift: number): number {
    this.bindMemory();
    const b = this.buffer;
    let cp: number;
    if (len === 2) cp = ((b[ptr] & 0x1f) << 6) | (b[ptr + 1] & 0x3f);
    else if (len === 3)
      cp =
        ((b[ptr] & 0x0f) << 12) |
        ((b[ptr + 1] & 0x3f) << 6) |
        (b[ptr + 2] & 0x3f);
    else
      cp =
        ((b[ptr] & 0x07) << 18) |
        ((b[ptr + 1] & 0x3f) << 12) |
        ((b[ptr + 2] & 0x3f) << 6) |
        (b[ptr + 3] & 0x3f);
    // invalid UTF-8 (a lead byte above 0xf4) decodes past the last code
    // point; it is never an identifier
    if (cp > 0x10ffff) return 0;
    if (cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return idClassRegex[shift >> 1].test(String.fromCodePoint(cp)) ? 1 : 0;
    }
    idClassCache ??= new Uint8Array(0x10000);
    const known = (idClassCache[cp] >> shift) & 3;
    if (known !== 0) return known - 1;
    const yes = idClassRegex[shift >> 1].test(String.fromCharCode(cp));
    idClassCache[cp] |= (yes ? 2 : 1) << shift;
    return yes ? 1 : 0;
  }

  /** Rebind views after growing wasm memory. */
  bindMemory(): void {
    if (this.buffer.buffer === this.memory.buffer) return;
    this.pageN = this.memory.buffer.byteLength / pageSize;
    this.buffer = new Uint8Array(this.memory.buffer);
    this.dv = new DataView(this.memory.buffer);
  }
}

/** Decode non-string input so tokens can carry string content and offsets. */
function toCode(input: string | Uint8Array | ArrayBuffer): string {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return dec.decode(new Uint8Array(input));
  if (input instanceof Uint8Array) return dec.decode(input);
  throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
}

/** The shared highlighter instance created by `init`. */
let shared: HighlightsHighlighter | undefined;

/** The compiled Wasm module required by the shared highlighter. */
let wasmModule: WebAssembly.Module | undefined;

// Reuse one completed stream instance. Bun's Wasm instantiation is expensive,
// while one slot keeps concurrent streams isolated and bounds retained memory.
let pooledStreamHighlighter: HighlightsHighlighter | undefined;

/** The shared highlighter, or throw before `init`. */
function assertShared(): HighlightsHighlighter {
  if (shared == null) throw new Error('highlights is not initialized');
  return shared;
}

/** The compiled Wasm module required by isolated tokenizers. */
export function assertWasmModule(): WebAssembly.Module {
  if (wasmModule == null) throw new Error('highlights is not initialized');
  return wasmModule;
}

/**
 * Initialize the shared highlighter from a compiled WebAssembly module.
 */
export function init(wasm: WebAssembly.Module): Highlighter {
  wasmModule = wasm;
  pooledStreamHighlighter = undefined;
  return (shared = new HighlightsHighlighter(wasm));
}

/**
 * Create a highlighter with its own WebAssembly instance.
 * The shared highlighter is unchanged.
 */
export function createHighlighter(wasmModule: WebAssembly.Module): Highlighter {
  return new HighlightsHighlighter(wasmModule);
}

/**
 * Highlight code as a self-contained `<pre class="highlights">` fragment with
 * inline colors.
 */
export function codeToHtml(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToHtmlOptions
): Uint8Array {
  return assertShared().codeToHtml(input, options);
}

/**
 * Tokenize code into Shiki-compatible tokens, one array per line.
 * WebAssembly lexes and splits lines; JavaScript maps style records to tokens.
 */
export function codeToTokens(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToTokensOptions
): TokensResult {
  return assertShared().codeToTokens(input, options);
}

/**
 * Tokenize streamed code for SSR in an isolated Wasm instance. Every language
 * scans each completed chunk once and preserves lexer state in Wasm.
 */
export class StreamTokenizer {
  #hl: HighlightsHighlighter | undefined;
  #langId: number;
  #themes: ResolvedTheme[];
  #cssVariablePrefix: string;
  #maxLineLength: number | undefined;
  #pendingSurrogate = '';
  #tail = '';
  #streamChar = 0;
  #streamStarted = false;

  constructor(options: CodeToTokensOptions) {
    const compiledWasm = assertWasmModule();
    this.#hl =
      pooledStreamHighlighter?.wasmModule === compiledWasm
        ? pooledStreamHighlighter
        : new HighlightsHighlighter(compiledWasm);
    pooledStreamHighlighter = undefined;
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--hls-';
    this.#maxLineLength = options.tokenizeMaxLineLength;
  }

  /**
   * Append a chunk and return one token array per completed line, with offsets
   * relative to the full streamed input. The incomplete final line stays
   * buffered until a newline or `end()`.
   */
  pushCode(chunk: string): ThemedToken[][] {
    if (this.#hl == null) throw new Error('stream has ended');
    chunk = this.#pendingSurrogate + chunk;
    this.#pendingSurrogate = '';
    const lastCode = chunk.charCodeAt(chunk.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      this.#pendingSurrogate = chunk.slice(-1);
      chunk = chunk.slice(0, -1);
    }
    this.#tail += chunk;
    const end = this.#tail.lastIndexOf('\n') + 1;
    if (end === 0) return [];
    const code = this.#tail.slice(0, end);
    this.#tail = this.#tail.slice(end);
    return this.#tokenizeChunk(code).slice(0, -1);
  }

  /**
   * Finish the stream and return the remaining lines, including the final line
   * after a trailing terminator, matching codeToTokens line splitting.
   */
  end(): ThemedToken[][] {
    if (this.#hl == null) throw new Error('stream has ended');
    try {
      this.#tail += this.#pendingSurrogate;
      this.#pendingSurrogate = '';
      if (this.#tail === '') return [[]];
      const code = this.#tail;
      this.#tail = '';
      return this.#tokenizeChunk(code);
    } finally {
      this.dispose();
    }
  }

  /** Release the Wasm instance and discard buffered input; later calls throw. */
  dispose(): void {
    const hl = this.#hl;
    if (hl == null) return;
    // Do not retain unusually large stream buffers in the single pool slot.
    if (
      pooledStreamHighlighter == null &&
      hl.wasmModule === wasmModule &&
      hl.pageN <= 16
    ) {
      pooledStreamHighlighter = hl;
    }
    this.#hl = undefined;
    this.#pendingSurrogate = '';
    this.#tail = '';
  }

  /** Tokenize one chunk and apply stream-absolute offsets. */
  #tokenizeChunk(code: string): ThemedToken[][] {
    const hl = this.#hl;
    if (hl == null) throw new Error('stream has ended');
    const byteLen = hl.writeInput(code);
    const recs = hl.streamTokenizeLineRecords(
      this.#langId,
      byteLen,
      !this.#streamStarted
    );
    this.#streamStarted = true;
    const lines = lineRecordsToTokens(
      code,
      recs,
      recs.length >> 1,
      this.#themes,
      this.#cssVariablePrefix,
      this.#maxLineLength,
      this.#streamChar
    );
    this.#streamChar += code.length;
    return lines;
  }
}
