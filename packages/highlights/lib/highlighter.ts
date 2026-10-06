import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  Highlighter,
  Lang,
  ThemedToken,
  TokensResult,
} from './index';
import languages from './languages';
import {
  defaultCssVariablePrefix,
  escapeAttribute,
  prepareTheme,
  themeTableBytes,
} from './theme';
import type { ResolvedTheme } from './tokens';
import {
  lineRecordsToTokens,
  multiThemeBlob,
  multiThemeHtmlOpeners,
  resolveOptionThemes,
  themeMeta,
} from './tokens';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const pageSize = 65536;
const themePtr = 64; // $mem.themeTable in src/memory.wat
// Unicode identifier classes for the ECMAScript lexers; see #idClass.
const idClassRegex = [/^\p{ID_Start}$/u, /^[\u200C\u200D\p{ID_Continue}]$/u];
let idClassCache: Uint8Array | undefined;

/**
 * Language names and Wasm IDs, sorted by ID and then name.
 */
export const LANGS: Record<string, number> = languages;

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
  #htmlPrefix: string | undefined;
  #htmlPrefixBytes = new Uint8Array(0);
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

  /** Write input at a byte offset in the text buffer and return its byte length. */
  writeInput(input: string | Uint8Array | ArrayBuffer, offset = 0): number {
    if (typeof input === 'string') {
      // Use spare capacity for UTF-8, keeping 96 bytes for lexer lookahead.
      this.#growMemoryIfNeeded(offset + input.length + 96);
      let { read, written } = enc.encodeInto(
        input,
        this.buffer.subarray(pageSize + offset, this.buffer.length - 96)
      );
      if (read < input.length) {
        const rest = input.slice(read);
        this.#growMemoryIfNeeded(offset + written + rest.length * 3 + 96);
        written += enc.encodeInto(
          rest,
          this.buffer.subarray(
            pageSize + offset + written,
            this.buffer.length - 96
          )
        ).written;
      }
      return written;
    }
    if (input instanceof ArrayBuffer) {
      input = new Uint8Array(input);
    }
    if (!(input instanceof Uint8Array)) {
      throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
    }
    this.#growMemoryIfNeeded(offset + input.length + 96);
    this.buffer.set(input, pageSize + offset);
    return input.length;
  }

  /**
   * Lex the first `inputLength` bytes. Output modes:
   * 0 inline colors, 1 CSS variables, 2 packed themes, 3 UTF-16 line records,
   * 4 prepared HTML openers. `reset` selects streaming mode.
   */
  #run(
    langId: number,
    mode: number,
    inputLength: number,
    reset?: boolean
  ): void {
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, mode);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[pageSize + inputLength] = 0; // NUL sentinel: lexers treat byte 0 at EOF as end
    try {
      if (reset === undefined) this.#highlight();
      else this.#highlightStream(reset);
    } finally {
      this.bindMemory();
    }
  }

  /**
   * Return highlighted HTML bytes.
   * The bytes can reference Wasm memory that the next call overwrites.
   */
  codeToHtml(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHtmlOptions
  ): Uint8Array {
    const langId = langIdOf(options.lang);
    const cssVariablePrefix =
      options.cssVariablePrefix ?? defaultCssVariablePrefix;
    let table: Uint8Array | undefined;
    let blob: Uint8Array | undefined;
    let mode = 0;
    if (options.themes != null) {
      const themes = resolveOptionThemes(options);
      blob = multiThemeBlob(themes, cssVariablePrefix);
      mode = 2;
      if (blob === undefined) {
        blob = multiThemeHtmlOpeners(themes, cssVariablePrefix);
        mode = 4;
      }
    } else {
      const prepared = prepareTheme(options.theme, cssVariablePrefix);
      table = prepared.table;
      blob = prepared.htmlOpeners;
      if (blob !== undefined) mode = 4;
    }
    const inputLength = this.writeInput(input);
    if (blob !== undefined) {
      this.#growMemoryIfNeeded(inputLength + blob.length + 96);
      const blobPtr = (pageSize + inputLength + 47) & ~15;
      this.buffer.set(blob, blobPtr);
      this.dv.setUint32(14, blobPtr, true);
      this.dv.setUint32(18, blob.length, true);
    } else if (table === undefined) {
      if (this.#htmlPrefix !== cssVariablePrefix) {
        this.#htmlPrefixBytes = enc.encode(escapeAttribute(cssVariablePrefix));
        this.#htmlPrefix = cssVariablePrefix;
      }
      const bytes = this.#htmlPrefixBytes;
      this.#growMemoryIfNeeded(inputLength + bytes.length + 96);
      const prefixPtr = (pageSize + inputLength + 47) & ~15;
      this.buffer.set(bytes, prefixPtr);
      this.dv.setUint32(14, prefixPtr, true);
      this.dv.setUint32(18, bytes.length, true);
      mode = 1;
    } else {
      if (this.#themeWritten !== table) {
        this.buffer.set(table, themePtr);
        this.buffer.fill(
          0,
          themePtr + table.length,
          themePtr + themeTableBytes
        );
        this.#themeWritten = table;
      }
      mode = 0;
    }
    this.#run(langId, mode, inputLength);
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return this.buffer.subarray(outStart, outStart + outLength);
  }

  /** Return UTF-16 token records; `reset` starts or continues a stream. */
  tokenizeLineRecords(
    langId: number,
    inputLength: number,
    reset?: boolean
  ): Uint32Array {
    this.#run(langId, 3, inputLength, reset);
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    return new Uint32Array(this.buffer.buffer, outStart, outLength >> 2);
  }

  /**
   * Tokenize code into Shiki-compatible themed tokens, one array per line.
   */
  codeToTokens(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToTokensOptions
  ): TokensResult {
    const code = toCode(input);
    // Normalize malformed UTF-8 and avoid detaching borrowed input on memory growth.
    if (
      typeof input !== 'string' &&
      (code.includes('\ufffd') ||
        input === this.memory.buffer ||
        (input instanceof Uint8Array && input.buffer === this.memory.buffer))
    ) {
      input = code;
    }
    const themes = resolveOptionThemes(options);
    const cssVariablePrefix =
      options.cssVariablePrefix ?? defaultCssVariablePrefix;
    const recs = this.tokenizeLineRecords(
      langIdOf(options.lang),
      this.writeInput(input)
    );
    const tokens = lineRecordsToTokens(
      code,
      recs,
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
   * Check `is_id_start` or `is_id_continue` for the code point at `ptr`.
   * `len` is its UTF-8 byte length. `shift` is 0 for ID_Start or 2 for
   * ID_Continue. Each BMP code point uses two cache bits per class:
   * 0 unknown, 1 no, 2 yes. Use the Unicode regex for cache misses and
   * astral code points.
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

/** Decode bytes for token content; keep string input's original UTF-16. */
function toCode(input: string | Uint8Array | ArrayBuffer): string {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    return dec.decode(input);
  }
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
function assertShared(
  input: string | Uint8Array | ArrayBuffer
): HighlightsHighlighter {
  if (shared == null) throw new Error('highlights is not initialized');
  // Wasm memory cannot shrink. Replace instances above 8 MiB when small
  // inputs resume, but keep reusing capacity for consecutive large calls.
  if (
    shared.pageN > 128 &&
    (typeof input === 'string' ? input.length : input.byteLength) <= pageSize
  ) {
    shared = new HighlightsHighlighter(shared.wasmModule);
  }
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
 * Return a `<pre class="highlights">` fragment with inline colors.
 * With `themes`, each span uses the default theme inline and CSS custom
 * properties for the other themes, as in `codeToTokens`'s `htmlStyle`.
 */
export function codeToHtml(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToHtmlOptions
): Uint8Array {
  return assertShared(input).codeToHtml(input, options);
}

/**
 * Return Shiki-compatible tokens, grouped by line.
 * WebAssembly lexes the input and splits lines. JavaScript converts the
 * style records to tokens.
 */
export function codeToTokens(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToTokensOptions
): TokensResult {
  return assertShared(input).codeToTokens(input, options);
}

/**
 * Convert UTF-8 chunks to themed token arrays, one per completed line.
 * Use synchronous `pushCode` and `end` calls for strings or UTF-8 bytes.
 * An isolated Wasm instance scans each completed chunk once and keeps
 * lexer state between chunks.
 */
export class StreamTokenizer extends TransformStream<
  Uint8Array,
  ThemedToken[]
> {
  #hl: HighlightsHighlighter | undefined;
  #langId: number;
  #themes: ResolvedTheme[];
  #cssVariablePrefix: string;
  #maxLineLength: number | undefined;
  #pendingBytes: Uint8Array = new Uint8Array(0);
  #pendingByteLength = 0;
  #pendingSurrogate = '';
  #tail = '';
  #streamChar = 0;
  #streamStarted = false;

  constructor(options: CodeToTokensOptions) {
    const transformer = {
      transform: (
        chunk: Uint8Array,
        controller: TransformStreamDefaultController<ThemedToken[]>
      ) => {
        try {
          for (const line of this.pushCode(chunk)) controller.enqueue(line);
        } catch (error) {
          this.dispose();
          throw error;
        }
      },
      flush: (controller: TransformStreamDefaultController<ThemedToken[]>) => {
        for (const line of this.end()) controller.enqueue(line);
      },
      cancel: () => this.dispose(),
    };
    super(transformer);

    // validate the options before taking the pooled instance so a rejected
    // language or theme leaves the pool intact
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    const compiledWasm = assertWasmModule();
    this.#hl =
      pooledStreamHighlighter?.wasmModule === compiledWasm
        ? pooledStreamHighlighter
        : new HighlightsHighlighter(compiledWasm);
    pooledStreamHighlighter = undefined;
    this.#cssVariablePrefix =
      options.cssVariablePrefix ?? defaultCssVariablePrefix;
    this.#maxLineLength = options.tokenizeMaxLineLength;
  }

  /**
   * Append text or UTF-8 bytes. Return tokens for each completed line,
   * with offsets relative to the full input.
   * Incomplete UTF-8 stays buffered between byte chunks. A nonempty
   * string flushes those bytes first. The final line stays buffered
   * until a newline or `end()`.
   */
  pushCode(chunk: string | Uint8Array): ThemedToken[][] {
    if (this.#hl == null) throw new Error('stream has ended');
    if (chunk.length === 0) return [];
    if (typeof chunk !== 'string') {
      let end = chunk.lastIndexOf(10) + 1;
      if (end === 0) {
        this.#bufferBytes(chunk);
        return [];
      }
      if (this.#pendingByteLength > 0) {
        end += this.#pendingByteLength;
        chunk = this.#bufferBytes(chunk);
      }
      const lines = this.#tokenizeChunk(
        chunk.subarray(0, end),
        this.#tail + this.#pendingSurrogate
      );
      this.#tail = '';
      this.#pendingSurrogate = '';
      this.#pendingByteLength = 0;
      if (end < chunk.length) this.#bufferBytes(chunk.subarray(end));
      lines.pop(); // The trailing empty line belongs to the next chunk.
      return lines;
    }
    if (this.#pendingByteLength > 0) {
      // Finish pending UTF-8 before appending text to preserve chunk order.
      chunk =
        dec.decode(this.#pendingBytes.subarray(0, this.#pendingByteLength)) +
        chunk;
      this.#pendingByteLength = 0;
    }
    chunk = this.#pendingSurrogate + chunk;
    this.#pendingSurrogate = '';
    const lastCode = chunk.charCodeAt(chunk.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      this.#pendingSurrogate = chunk.slice(-1);
      chunk = chunk.slice(0, -1);
    }
    const end = chunk.lastIndexOf('\n') + 1;
    if (end === 0) {
      this.#tail += chunk;
      return [];
    }
    const code = this.#tail + chunk.slice(0, end);
    this.#tail = chunk.slice(end);
    const lines = this.#tokenizeChunk(code);
    lines.pop(); // The trailing empty line belongs to the next chunk.
    return lines;
  }

  /**
   * Finish UTF-8 decoding and return the remaining lines.
   * A trailing line terminator produces a final empty line, as in
   * `codeToTokens`.
   */
  end(): ThemedToken[][] {
    if (this.#hl == null) throw new Error('stream has ended');
    try {
      if (this.#pendingByteLength > 0) {
        return this.#tokenizeChunk(
          this.#pendingBytes.subarray(0, this.#pendingByteLength),
          this.#tail + this.#pendingSurrogate
        );
      }
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
    this.#pendingBytes = new Uint8Array(0);
    this.#pendingByteLength = 0;
    this.#pendingSurrogate = '';
    this.#tail = '';
  }

  /** Own unfinished bytes so callers can reuse chunks; grow geometrically for long lines. */
  #bufferBytes(chunk: Uint8Array): Uint8Array {
    const length = this.#pendingByteLength + chunk.length;
    if (length > this.#pendingBytes.length) {
      const buffer = new Uint8Array(
        Math.max(length, this.#pendingBytes.length * 2, 1024)
      );
      buffer.set(this.#pendingBytes.subarray(0, this.#pendingByteLength));
      this.#pendingBytes = buffer;
    }
    this.#pendingBytes.set(chunk, this.#pendingByteLength);
    this.#pendingByteLength = length;
    return this.#pendingBytes.subarray(0, length);
  }

  /** Tokenize completed input; a string prefix preserves original UTF-16 when mixing inputs. */
  #tokenizeChunk(input: string | Uint8Array, prefix = ''): ThemedToken[][] {
    const hl = this.#hl;
    if (hl == null) throw new Error('stream has ended');
    let code = toCode(input);
    // Replacement characters must reach Wasm as valid UTF-8 for matching offsets.
    if (typeof input !== 'string' && code.includes('\ufffd')) input = code;
    code = prefix + code;
    let byteLen = prefix === '' ? 0 : hl.writeInput(prefix);
    byteLen += hl.writeInput(input, byteLen);
    const recs = hl.tokenizeLineRecords(
      this.#langId,
      byteLen,
      !this.#streamStarted
    );
    this.#streamStarted = true;
    const lines = lineRecordsToTokens(
      code,
      recs,
      this.#themes,
      this.#cssVariablePrefix,
      this.#maxLineLength,
      this.#streamChar
    );
    this.#streamChar += code.length;
    return lines;
  }
}
