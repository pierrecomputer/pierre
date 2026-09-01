import type {
  CodeToHastOptions,
  CodeToHtmlOptions,
  CodeToTokensOptions,
  HastRoot,
  Highlighter,
  Lang,
  Theme,
  ThemedToken,
  TokensResult,
  TransformerContextCommon,
} from './index';
import { compileTheme } from './theme';
import type { ResolvedTheme } from './tokens';
import {
  buildHast,
  lineRecordsToRuns,
  lineRecordsToTokens,
  resolveOptionThemes,
  themeMeta,
} from './tokens';

const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;
const themePtr = 6848;
const themeBytes = 1024;
const themeBuildCache = new WeakMap<Theme, Uint8Array>();

const LANGS: Record<string, number> = {
  plain: 0,
  plaintext: 0,
  text: 0,
  txt: 0,
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
  vue: 24,
  wasm: 25,
  wat: 25,
  svg: 26,
  xml: 26,
  xsd: 26,
  yaml: 27,
  yml: 27,
  zig: 28,
  cjs: 29,
  javascript: 29,
  js: 29,
  mjs: 29,
  jsx: 30,
  cts: 31,
  mts: 31,
  ts: 31,
  typescript: 31,
  tsx: 32,
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

export class WasmHighlighter implements Highlighter {
  wasmModule: WebAssembly.Module;
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  highlight: () => void;
  highlightStream: (reset: number | boolean) => void;
  buffer: Uint8Array;
  dv: DataView;
  pageN: number;
  themeWritten: Uint8Array | undefined;

  constructor(wasmModule: WebAssembly.Module) {
    this.wasmModule = wasmModule;
    const env = {
      is_id_start: (ptr: number, bits: number) =>
        /^\p{ID_Start}$/u.test(this.readChars(ptr, bits)),
      is_id_continue: (ptr: number, bits: number) =>
        /^[\u200C\u200D\p{ID_Continue}]$/u.test(this.readChars(ptr, bits)),
    };
    const instance = new WebAssembly.Instance(wasmModule, { env });
    this.instance = instance;
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.highlight = instance.exports.highlight as () => void;
    this.highlightStream = instance.exports.highlightStream as (
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
  encodeAt(str: string, at: number): number {
    // Try an ASCII-sized destination first; grow if UTF-8 needs more room.
    this.growMemoryIfNeeded(at + str.length + 96);
    let { read, written } = enc.encodeInto(
      str,
      this.buffer.subarray(pageSize + at, pageSize + at + str.length)
    );
    if (read < str.length) {
      // Allow three bytes per remaining UTF-16 code unit.
      const rest = str.slice(read);
      this.growMemoryIfNeeded(at + written + rest.length * 3 + 96);
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
      return this.encodeAt(input, 0);
    }
    if (input instanceof ArrayBuffer) {
      input = new Uint8Array(input);
    }
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
    }
    this.growMemoryIfNeeded(input.length + 96);
    this.buffer.set(input, pageSize);
    return input.length;
  }

  /**
   * Run the lexer over the first `inputLength` bytes: 0 inline colors, 1 CSS
   * variables, 2 byte-end records, or 3 UTF-16 line records.
   * Returns a `Uint8Array` view of Wasm memory, valid until the next call.
   */
  run(langId: number, mode: number, inputLength: number): Uint8Array {
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, mode);
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
    if (themeTable !== undefined && this.themeWritten !== themeTable) {
      this.buffer.set(themeTable, themePtr);
      this.buffer.fill(0, themePtr + themeTable.length, themePtr + themeBytes);
      this.themeWritten = themeTable;
    }
    return this.run(langId, useCssVariables ? 1 : 0, inputLength);
  }

  /**
   * Tokenize the first `inputLength` buffered bytes into `(end, tokenId)` pairs
   * that tile the input. The `Uint32Array` view expires on the next call.
   * No theme table is written; JavaScript resolves the colors.
   */
  tokenizeRecords(langId: number, inputLength: number): Uint32Array {
    const out = this.run(langId, 2, inputLength);
    return new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  }

  /** Tokenize one stream chunk to line records while preserving lexer state. */
  tokenizeStreamLineRecords(
    langId: number,
    inputLength: number,
    reset: boolean
  ): Uint32Array {
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, 3);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[pageSize + inputLength] = 0;
    try {
      this.highlightStream(reset);
    } finally {
      this.bindMemory();
    }
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return new Uint32Array(this.buffer.buffer, outStart, outLength >> 2);
  }

  /** Return UTF-16 token records with `0xffffffff` newline markers. */
  tokenizeLineRecords(langId: number, inputLength: number): Uint32Array {
    const out = this.run(langId, 3, inputLength);
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
    const cssVariablePrefix = options.cssVariablePrefix ?? '--cha-';
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

  /**
   * Highlight code as Shiki-compatible HAST (`root > pre > code`) with one
   * `span.line` per line. Supports Shiki-style transformers and decorations.
   */
  codeToHast(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHastOptions
  ): HastRoot {
    let code = toCode(input);
    // Shiki transformer methods available through `this`, plus one mutable
    // `meta` object shared by every hook.
    const common = {
      codeToHast: (c: string, o: CodeToHastOptions): HastRoot =>
        this.codeToHast(c, o),
      codeToTokens: (c: string, o: CodeToTokensOptions): TokensResult =>
        this.codeToTokens(c, o),
      meta: { ...options.meta },
    };
    const context: TransformerContextCommon = {
      ...common,
      source: code,
      options,
    };
    for (const t of options.transformers ?? []) {
      if (t.preprocess != null) {
        code = t.preprocess.call(context, code, options) ?? code;
      }
    }
    const themes = resolveOptionThemes(options);
    const recs = this.tokenizeLineRecords(
      langIdOf(options.lang),
      this.writeInput(code)
    );
    const { lineRuns, lineStarts } = lineRecordsToRuns(
      recs,
      recs.length >> 1,
      options.tokenizeMaxLineLength
    );
    return buildHast(code, lineRuns, lineStarts, themes, options, common);
  }

  /** Grow the wasm linear memory if needed. */
  growMemoryIfNeeded(len: number): void {
    const neededPages = 1 + Math.ceil(len / pageSize);
    if (neededPages > this.pageN) {
      this.memory.grow(neededPages - this.pageN);
      this.bindMemory();
    }
  }

  /** Decode a UTF-8 byte range from wasm memory. */
  readChars(ptr: number, length: number): string {
    this.bindMemory();
    return dec.decode(this.buffer.subarray(ptr, ptr + length));
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
let shared: WasmHighlighter | undefined;

/** The compiled Wasm module required by the shared highlighter. */
let wasmModule: WebAssembly.Module | undefined;

// Reuse one completed stream instance. Bun's Wasm instantiation is expensive,
// while one slot keeps concurrent streams isolated and bounds retained memory.
let pooledStreamHighlighter: WasmHighlighter | undefined;

/** The shared highlighter, or throw before `init`. */
function assertShared(): WasmHighlighter {
  if (shared == null) throw new Error('chamele is not initialized');
  return shared;
}

/** The compiled Wasm module required by isolated tokenizers. */
export function assertWasmModule(): WebAssembly.Module {
  if (wasmModule == null) throw new Error('chamele is not initialized');
  return wasmModule;
}

/**
 * Initialize the shared highlighter from a compiled WebAssembly module.
 */
export function init(wasm: WebAssembly.Module): Highlighter {
  wasmModule = wasm;
  pooledStreamHighlighter = undefined;
  return (shared = new WasmHighlighter(wasm));
}

/**
 * Create a highlighter with its own WebAssembly instance.
 * The shared highlighter is unchanged.
 */
export function createHighlighter(wasmModule: WebAssembly.Module): Highlighter {
  return new WasmHighlighter(wasmModule);
}

/**
 * Highlight code as a self-contained `<pre class="chamele">` fragment with
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
 * Highlight code as a Shiki-compatible HAST tree (`root > pre > code`) with
 * one `span.line` per line. WebAssembly lexes and splits lines; JavaScript
 * builds the nodes and runs Shiki-style transformers and decorations.
 */
export function codeToHast(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToHastOptions
): HastRoot {
  return assertShared().codeToHast(input, options);
}

/**
 * Tokenize streamed code for SSR in an isolated Wasm instance. Every language
 * scans each completed chunk once and preserves lexer state in Wasm.
 */
export class TokenizeStream {
  #hl: WasmHighlighter | undefined;
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
        : new WasmHighlighter(compiledWasm);
    pooledStreamHighlighter = undefined;
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--cha-';
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
    const recs = hl.tokenizeStreamLineRecords(
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
