import { compileTheme } from './theme.mjs';
import {
  buildHast,
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
   * variables, or 2 token records.
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

  /**
   * Tokenize code into Shiki-compatible themed tokens, one array per line.
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {import("./index.d.ts").CodeToTokensOptions} options
   * @returns {import("./index.d.ts").TokensResult}
   */
  codeToTokens(input, options) {
    const code = toCode(input);
    const themes = resolveOptionThemes(options);
    const cssVariablePrefix = options.cssVariablePrefix ?? '--shiki-';
    const recs = this.tokenizeRecords(
      langIdOf(options.lang),
      this.writeInput(code)
    );
    const lineRuns = splitRecordLines(
      code,
      recs,
      recs.length >> 1,
      undefined,
      options.tokenizeMaxLineLength
    );
    const tokens = lineRuns.map((runs) =>
      runs.map((run) => runToToken(code, run, themes, cssVariablePrefix))
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
    const recs = this.tokenizeRecords(
      langIdOf(options.lang),
      this.writeInput(code)
    );
    const lineRuns = splitRecordLines(
      code,
      recs,
      recs.length >> 1,
      undefined,
      options.tokenizeMaxLineLength
    );
    return buildHast(code, lineRuns, themes, options, common);
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

/** Decode non-string input so tokens can carry string content and offsets. */
function toCode(input) {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) return dec.decode(new Uint8Array(input));
  if (input instanceof Uint8Array) return dec.decode(input);
  throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
}

/** UTF-8 byte length of `code.slice(from)`. */
function utf8Length(code, from) {
  let bytes = 0;
  for (let i = from; i < code.length; ) {
    const cp = code.codePointAt(i);
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes;
}

/**
 * The shared highlighter instance and its compiled module.
 * @type {Highlighter}
 */
let shared;
let sharedModule;

/** The compiled Wasm module required by isolated tokenizers. */
function moduleOrThrow() {
  if (sharedModule == null) throw new Error('chamele is not initialized');
  return sharedModule;
}

/**
 * Initialize the wasm module.
 * @param {WebAssembly.Module} wasmModule
 * @returns {Highlighter}
 */
export function init(wasmModule) {
  sharedModule = wasmModule;
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
 * Tokenize streamed code for SSR in an isolated Wasm instance. Its text buffer
 * accumulates chunks; `pushCode` returns completed lines and keeps the trailing
 * line until a terminator or `end`. Each pass starts at the buffer start, so
 * completed lines include all preceding context.
 */
export class TokenizeStream {
  #hl;
  #langId;
  #themes;
  #cssVariablePrefix;
  #maxLineLength;
  #code = '';
  #byteLen = 0;
  // Hold a trailing high surrogate so a split pair encodes as one code point
  // and later byte offsets stay aligned.
  #pendingSurrogate = '';
  // String and byte offsets of the first unreturned line.
  #resume = { byte: 0, char: 0 };

  /** @param {import("./index.d.ts").CodeToTokensOptions} options */
  constructor(options) {
    this.#hl = new Highlighter(moduleOrThrow());
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--shiki-';
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
    if (chunk !== '') {
      this.#byteLen += this.#hl.encodeAt(chunk, this.#byteLen);
      this.#code += chunk;
    }
    // A chunk without a terminator cannot complete a line, so skip full-buffer
    // tokenization.
    if (!chunk.includes('\n')) return [];
    const lines = this.#tokenize();
    // Keep the unterminated final line.
    const complete = lines.slice(0, -1);
    if (complete.length > 0) {
      const tailChar = this.#code.lastIndexOf('\n') + 1;
      this.#resume = {
        char: tailChar,
        byte: this.#byteLen - utf8Length(this.#code, tailChar),
      };
    }
    return complete;
  }

  /**
   * Finish the stream and return the remaining lines, including the final line
   * after a trailing terminator, matching codeToTokens line splitting.
   * @returns {import("./index.d.ts").ThemedToken[][]}
   */
  end() {
    if (this.#pendingSurrogate !== '') {
      // Encode a final high surrogate as a replacement character, matching
      // codeToTokens.
      this.#byteLen += this.#hl.encodeAt(this.#pendingSurrogate, this.#byteLen);
      this.#code += this.#pendingSurrogate;
      this.#pendingSurrogate = '';
    }
    const lines = this.#tokenize();
    this.#resume = { byte: this.#byteLen, char: this.#code.length };
    return lines;
  }

  /** Tokenize the full buffer and split from the resume point. */
  #tokenize() {
    const recs = this.#hl.tokenizeRecords(this.#langId, this.#byteLen);
    const lineRuns = splitRecordLines(
      this.#code,
      recs,
      recs.length >> 1,
      this.#resume,
      this.#maxLineLength
    );
    return lineRuns.map((runs) =>
      runs.map((run) =>
        runToToken(this.#code, run, this.#themes, this.#cssVariablePrefix)
      )
    );
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
    this.#hl = new Highlighter(moduleOrThrow());
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--shiki-';
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
