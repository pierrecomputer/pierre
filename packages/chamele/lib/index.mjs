import { compileTheme } from './theme.mjs';
import {
  buildHast,
  lineRecordsToRuns,
  lineRecordsToTokens,
  resolveOptionThemes,
  runToToken,
  splitRecordLines,
  standardTypes,
  themeMeta,
} from './tokens.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;
const themePtr = 6848;
const themeBytes = 1024;
// Cache by theme object identity, not name: same-named themes can have
// different palettes.
const themeBuildCache = new WeakMap();

const LANGS = {
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
function langIdOf(lang) {
  const langId = LANGS[String(lang).toLowerCase()];
  if (typeof langId !== 'number') throw new RangeError(`unknown lang: ${lang}`);
  return langId;
}

/**
 * Check whether a name or alias has a built-in lexer, including `plain`/`text`.
 * @param {string} lang
 * @returns {boolean}
 */
export function isSupportedLanguage(lang) {
  return typeof LANGS[String(lang).toLowerCase()] === 'number';
}

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
    this.highlightStream = instance.exports.highlightStream;
    this.bindMemory();
  }

  /**
   * Encode `str` at byte offset `at` relative to the text buffer, growing
   * memory as needed.
   * Returns the number of bytes written.
   */
  encodeAt(str, at) {
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
   * @param {string | Uint8Array | ArrayBuffer} input
   */
  writeInput(input) {
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
  run(langId, mode, inputLength) {
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
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {{lang: string, theme: import("./index.d.ts").Theme | import("./index.d.ts").ThemeFamily}} options
   * @returns {Uint8Array} View of the HTML bytes in wasm memory (valid until the next call).
   */
  codeToHtml(input, { lang, theme }) {
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
    let themeTable;
    if (!useCssVariables) {
      themeTable = themeBuildCache.get(resolvedTheme);
      if (themeTable === undefined) {
        themeTable = compileTheme(resolvedTheme);
        themeBuildCache.set(resolvedTheme, themeTable);
      }
    }
    const inputLength = this.writeInput(input);
    if (!useCssVariables && this.themeWritten !== themeTable) {
      this.buffer.set(themeTable, themePtr);
      this.buffer.fill(0, themePtr + themeTable.length, themePtr + themeBytes);
      this.themeWritten = themeTable;
    }
    // oxlint-disable-next-line typescript/no-unsafe-return
    return this.run(langId, useCssVariables ? 1 : 0, inputLength);
  }

  /**
   * Tokenize the first `inputLength` buffered bytes into `(end, tokenId)` pairs
   * that tile the input. The `Uint32Array` view expires on the next call.
   * No theme table is written; JavaScript resolves the colors.
   */
  tokenizeRecords(langId, inputLength) {
    const out = this.run(langId, 2, inputLength);
    return new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  }

  /** Tokenize one stream chunk to line records while preserving lexer state. */
  tokenizeStreamLineRecords(langId, inputLength, reset) {
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
  tokenizeLineRecords(langId, inputLength) {
    const out = this.run(langId, 3, inputLength);
    return new Uint32Array(out.buffer, out.byteOffset, out.length >> 2);
  }

  /**
   * Tokenize code into Shiki-compatible themed tokens, one array per line.
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {import("./index.d.ts").CodeToTokensOptions} options
   * @returns {import("./index.d.ts").TokensResult}
   */
  codeToTokens(input, options) {
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
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {import("./index.d.ts").CodeToHastOptions} options
   * @returns {import("./index.d.ts").HastRoot}
   */
  codeToHast(input, options) {
    let code = toCode(input);
    // Shiki transformer methods available through `this`, plus one mutable
    // `meta` object shared by every hook.
    const common = {
      codeToHast: (c, o) => this.codeToHast(c, o),
      codeToTokens: (c, o) => this.codeToTokens(c, o),
      meta: { ...options.meta },
    };
    const context = { ...common, source: code, options };
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
  growMemoryIfNeeded(len) {
    const neededPages = 1 + Math.ceil(len / pageSize);
    if (neededPages > this.pageN) {
      this.memory.grow(neededPages - this.pageN);
      this.bindMemory();
    }
  }

  /** Decode a UTF-8 byte range from wasm memory. */
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

/** Decode non-string input so tokens can carry string content and offsets. */
function toCode(input) {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return dec.decode(new Uint8Array(input));
  if (input instanceof Uint8Array) return dec.decode(input);
  throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
}

/**
 * The shared highlighter instance and its compiled module.
 * @type {Highlighter}
 */
let shared;

/** The compiled Wasm module required by the shared highlighter.
 * @type {WebAssembly.Module}
 */
let wasmModule;

/** The compiled Wasm module required by isolated tokenizers. */
function assertWasmModule() {
  if (wasmModule == null) throw new Error('chamele is not initialized');
  return wasmModule;
}

/**
 * Initialize the wasm module.
 * @param {WebAssembly.Module} wasm
 * @returns {Highlighter}
 */
export function init(wasm) {
  wasmModule = wasm;
  return (shared = new Highlighter(wasmModule));
}

/**
 * Create a highlighter with its own Wasm instance without changing the shared
 * highlighter.
 * @param {WebAssembly.Module} wasmModule
 * @returns {Highlighter}
 */
export function createHighlighter(wasmModule) {
  return new Highlighter(wasmModule);
}

/**
 * Highlight input as HTML.
 * @type {Highlighter["codeToHtml"]}
 */
export function codeToHtml(input, options) {
  return shared.codeToHtml(input, options);
}

/**
 * Tokenize code into Shiki-compatible themed tokens, one array per line.
 * @type {Highlighter["codeToTokens"]}
 */
export function codeToTokens(input, options) {
  return shared.codeToTokens(input, options);
}

/**
 * Highlight code as a Shiki-compatible HAST tree.
 * @type {Highlighter["codeToHast"]}
 */
export function codeToHast(input, options) {
  return shared.codeToHast(input, options);
}

/**
 * Tokenize streamed code for SSR in an isolated Wasm instance. Every language
 * scans each completed chunk once and preserves lexer state in Wasm.
 */
export class TokenizeStream {
  #hl;
  #langId;
  #themes;
  #cssVariablePrefix;
  #maxLineLength;
  #pendingSurrogate = '';
  #tail = '';
  #streamChar = 0;
  #streamStarted = false;

  /** @param {import("./index.d.ts").CodeToTokensOptions} options */
  constructor(options) {
    this.#hl = new Highlighter(assertWasmModule());
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--cha-';
    this.#maxLineLength = options.tokenizeMaxLineLength;
  }

  /**
   * Append a chunk and return one token array per completed line, with offsets
   * relative to the full streamed input.
   * @param {string} chunk
   * @returns {import("./index.d.ts").ThemedToken[][]}
   */
  pushCode(chunk) {
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
   * @returns {import("./index.d.ts").ThemedToken[][]}
   */
  end() {
    this.#tail += this.#pendingSurrogate;
    this.#pendingSurrogate = '';
    if (this.#tail === '') return [[]];
    const code = this.#tail;
    this.#tail = '';
    return this.#tokenizeChunk(code);
  }

  /** Tokenize one chunk and apply stream-absolute offsets. */
  #tokenizeChunk(code) {
    const byteLen = this.#hl.writeInput(code);
    const recs = this.#hl.tokenizeStreamLineRecords(
      this.#langId,
      byteLen,
      !this.#streamStarted
    );
    this.#streamStarted = true;
    const base = this.#streamChar;
    const lines = lineRecordsToTokens(
      code,
      recs,
      recs.length >> 1,
      this.#themes,
      this.#cssVariablePrefix,
      this.#maxLineLength
    ).map((tokens) =>
      tokens.map((token) => {
        token.offset += base;
        return token;
      })
    );
    this.#streamChar += code.length;
    return lines;
  }
}

/**
 * Each editor tokenizer has an isolated Wasm instance containing the current
 * document. `tokenizeLine` replaces or appends a line, retokenizes the document
 * in one Wasm pass, and returns themed tokens plus line-relative
 * string/comment/regex ranges for bracket matching. Unchanged lines reuse the
 * previous tokenization.
 */
export class LiveTokenizer {
  #hl;
  #langId;
  #themes;
  #cssVariablePrefix;
  #maxLineLength;
  #lines;
  /** @type {{code: string, lineRuns: [number, number, number][][], lineStarts: number[]} | null} */
  #cache = null;

  /** @param {import("./index.d.ts").CodeToTokensOptions & {code?: string}} options */
  constructor(options) {
    this.#hl = new Highlighter(assertWasmModule());
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--cha-';
    this.#maxLineLength = options.tokenizeMaxLineLength;
    this.#lines = options.code == null ? [''] : options.code.split('\n');
  }

  /** Replace the whole document. */
  reset(code) {
    this.#lines = code.split('\n');
    this.#cache = null;
  }

  /**
   * Splice whole lines (insertion/removal), like `Array.prototype.splice`.
   * @param {number} start
   * @param {number} deleteCount
   * @param {...string} insertLines
   */
  spliceLines(start, deleteCount, ...insertLines) {
    this.#lines.splice(start, deleteCount, ...insertLines);
    this.#cache = null;
  }

  get lineCount() {
    return this.#lines.length;
  }

  /**
   * Update one line's text and tokenize it.
   * @param {number} lineIndex existing line index, or `lineCount` to append
   * @param {string} lineText
   * @returns {{tokens: import("./index.d.ts").ThemedToken[], bracketIgnoredRanges: [number, number][]}}
   */
  tokenizeLine(lineIndex, lineText) {
    if (lineIndex > this.#lines.length || lineIndex < 0) {
      throw new RangeError(`line ${lineIndex} out of range`);
    }
    if (lineIndex === this.#lines.length) {
      this.#lines.push(lineText);
      this.#cache = null;
    } else if (this.#lines[lineIndex] !== lineText) {
      this.#lines[lineIndex] = lineText;
      this.#cache = null;
    }
    if (this.#cache == null) this.#retokenize();
    const { code, lineRuns, lineStarts } = this.#cache;
    const runs = lineRuns[lineIndex] ?? [];
    const lineStart = lineStarts[lineIndex] ?? 0;
    const tokens = runs.map((run) => {
      const token = runToToken(
        code,
        run,
        this.#themes,
        this.#cssVariablePrefix
      );
      token.offset -= lineStart;
      return token;
    });
    const bracketIgnoredRanges = [];
    for (const [start, end, hl] of runs) {
      if (standardTypes[hl] === 0) continue;
      const last = bracketIgnoredRanges[bracketIgnoredRanges.length - 1];
      if (last !== undefined && last[1] >= start - lineStart) {
        last[1] = end - lineStart;
      } else {
        bracketIgnoredRanges.push([start - lineStart, end - lineStart]);
      }
    }
    return { tokens, bracketIgnoredRanges };
  }

  /** Re-encode and tokenize the whole document, caching per-line runs. */
  #retokenize() {
    const code = this.#lines.join('\n');
    const byteLen = this.#hl.encodeAt(code, 0);
    const recs = this.#hl.tokenizeRecords(this.#langId, byteLen);
    const lineRuns = splitRecordLines(
      code,
      recs,
      recs.length >> 1,
      undefined,
      this.#maxLineLength
    );
    const lineStarts = [0];
    for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) {
      lineStarts.push(i + 1);
    }
    this.#cache = { code, lineRuns, lineStarts };
  }
}
