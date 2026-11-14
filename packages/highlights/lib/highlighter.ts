import { AnsiState, ansiTokens, isAnsi } from './ansi';
import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  Highlighter,
  HighlighterOptions,
  Lang,
  Language,
  RegisteredHighlighter,
  Theme,
  ThemedToken,
  ThemeFamily,
  TokensResult,
} from './core';
import languages from './languages';
import {
  defaultCssVariablePrefix,
  escapeAttribute,
  prepareTheme,
  resolveTheme,
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
 * Check whether a name or alias has a built-in lexer, including `plain`/`text`,
 * or is `ansi`. Names from `registerLanguages` are not built in; use
 * `isRegisteredLanguage` for them.
 */
export function isSupportedLanguage(lang: string): lang is Lang {
  return typeof LANGS[String(lang).toLowerCase()] === 'number' || isAnsi(lang);
}

/**
 * Check whether `registerLanguages` added a name or alias. The shared
 * `codeToHtml` and `codeToTokens` use its lexer. `StreamTokenizer` and
 * `LiveTokenizer` use it too, unless it is a built-in language module.
 */
export function isRegisteredLanguage(lang: string): boolean {
  return registeredLexers.has(String(lang).toLowerCase());
}

export class HighlightsHighlighter implements Highlighter<
  Theme | ThemeFamily,
  string
> {
  #highlight: () => void;
  #highlightStream: (reset: number | boolean) => void;
  #themeWritten: Uint8Array | undefined;
  #htmlPrefix: string | undefined;
  #htmlPrefixBytes = new Uint8Array(0);
  #beforeRun?: (
    langId: number,
    mode: number,
    inputLength: number,
    reset?: boolean
  ) => void;
  #languageIds?: ReadonlyMap<string, number>;
  inputPtr: number;
  themePtr: number;
  wasmModule: WebAssembly.Module;
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  buffer: Uint8Array;
  dv: DataView;
  pageN: number;

  constructor(
    wasmModule: WebAssembly.Module,
    beforeRun?: (
      langId: number,
      mode: number,
      inputLength: number,
      reset?: boolean
    ) => void,
    imports: Record<string, (...args: number[]) => number> = {},
    languageIds?: ReadonlyMap<string, number>
  ) {
    this.#beforeRun = beforeRun;
    this.#languageIds = languageIds;
    this.wasmModule = wasmModule;
    const env = {
      // The combined module imports it for the documents of registered lexers.
      lex_line: () => 0,
      ...imports,
      is_id_start: (ptr: number, len: number) => this.#idClass(ptr, len, 0),
      is_id_continue: (ptr: number, len: number) => this.#idClass(ptr, len, 2),
    };
    const instance = new WebAssembly.Instance(wasmModule, { env });
    this.instance = instance;
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.inputPtr = Number(
      (instance.exports.inputPtr as WebAssembly.Global).value
    );
    this.themePtr = Number(
      (instance.exports.themePtr as WebAssembly.Global | undefined)?.value ?? 0
    );
    // Only an emitter gets `languageIds`; the combined module has `emit` too.
    const emit = languageIds === undefined ? undefined : instance.exports.emit;
    this.#highlight = (emit ??
      instance.exports.highlight ??
      instance.exports.lex) as () => void;
    this.#highlightStream = (emit ??
      instance.exports.highlightStream ??
      instance.exports.lexStream) as (reset: number | boolean) => void;
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
        this.buffer.subarray(this.inputPtr + offset, this.buffer.length - 96)
      );
      if (read < input.length) {
        const rest = input.slice(read);
        this.#growMemoryIfNeeded(offset + written + rest.length * 3 + 96);
        written += enc.encodeInto(
          rest,
          this.buffer.subarray(
            this.inputPtr + offset + written,
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
    this.buffer.set(input, this.inputPtr + offset);
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
    this.#beforeRun?.(langId, mode, inputLength, reset);
    this.dv.setUint8(0, langId);
    this.dv.setUint8(1, mode);
    this.dv.setUint32(2, inputLength, true);
    this.buffer[this.inputPtr + inputLength] = 0; // NUL sentinel: lexers treat byte 0 at EOF as end
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
    options: CodeToHtmlOptions<Theme | ThemeFamily, string>
  ): Uint8Array {
    const cssVariablePrefix =
      options.cssVariablePrefix ?? defaultCssVariablePrefix;
    if (isAnsi(options.lang)) {
      const themes = resolveOptionThemes(options);
      const { fg, bg, rootStyle } = themeMeta(themes, cssVariablePrefix);
      const code = toCode(input);
      // Tag a single theme as inline so every token gets `htmlStyle`.
      const lines = ansiTokens(
        code,
        themes[0].role === 'single'
          ? [{ ...themes[0], role: 'default' }]
          : themes,
        cssVariablePrefix
      );
      let html = `<pre class="highlights" style="${escapeAttribute(
        rootStyle ??
          (bg === undefined ? '' : `background-color:${bg};`) +
            (fg === undefined ? '' : `color:${fg}`)
      )}"><code>`;
      for (let i = 0, lf = -1; i < lines.length; i++) {
        if (i > 0) {
          lf = code.indexOf('\n', lf + 1);
          html += code.charCodeAt(lf - 1) === 13 ? '\r\n' : '\n';
        }
        for (const { content, htmlStyle } of lines[i]) {
          let css = '';
          for (const property in htmlStyle) {
            css += `${css === '' ? '' : ';'}${property}:${htmlStyle[property]}`;
          }
          html += `<span style="${escapeAttribute(css)}">${content
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')}</span>`;
        }
      }
      return enc.encode(`${html}</code></pre>`);
    }
    const langId =
      this.#languageIds?.get(String(options.lang).toLowerCase()) ??
      langIdOf(options.lang);
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
      const blobPtr = (this.inputPtr + inputLength + 47) & ~15;
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
      const prefixPtr = (this.inputPtr + inputLength + 47) & ~15;
      this.buffer.set(bytes, prefixPtr);
      this.dv.setUint32(14, prefixPtr, true);
      this.dv.setUint32(18, bytes.length, true);
      mode = 1;
    } else {
      if (this.#themeWritten !== table) {
        this.buffer.set(table, this.themePtr);
        this.buffer.fill(
          0,
          this.themePtr + table.length,
          this.themePtr + themeTableBytes
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

  /**
   * Run record output and return the address of the records. Control word 10
   * holds their byte length. `reset` starts or continues a stream. Mode 5
   * makes the combined module return byte records, as a lexer module does.
   */
  lexRecords(
    langId: number,
    inputLength: number,
    reset?: boolean,
    mode = 3
  ): number {
    this.#run(langId, mode, inputLength, reset);
    return this.dv.getUint32(6, true);
  }

  /**
   * Copy lexer records to this emitter, after the input and the theme data.
   * Only the first record can be a leading gap (255), and the emitter has no
   * gap type.
   */
  writeRecords(mode: number, length: number, records: Uint32Array): void {
    if (records.length > 0 && records[1] === 255) records[1] = 0;
    const blobEnd =
      mode === 0 || mode === 3
        ? 0
        : this.dv.getUint32(14, true) + this.dv.getUint32(18, true);
    const recordsPtr =
      Math.ceil(Math.max(this.inputPtr + length + 96, blobEnd) / 16) * 16;
    const pages = Math.ceil((recordsPtr + records.byteLength + 96) / pageSize);
    if (pages > this.pageN) {
      this.memory.grow(pages - this.pageN);
      this.bindMemory();
    }
    this.buffer.set(
      new Uint8Array(records.buffer, records.byteOffset, records.byteLength),
      recordsPtr
    );
    this.dv.setUint32(22, recordsPtr, true);
    this.dv.setUint32(26, records.byteLength, true);
  }

  /** Return UTF-16 token records; `reset` starts or continues a stream. */
  tokenizeLineRecords(
    langId: number,
    inputLength: number,
    reset?: boolean
  ): Uint32Array {
    const outStart = this.lexRecords(langId, inputLength, reset);
    return new Uint32Array(
      this.buffer.buffer,
      outStart,
      this.dv.getUint32(10, true) >> 2
    );
  }

  /**
   * Tokenize code into Shiki-compatible themed tokens, one array per line.
   */
  codeToTokens(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToTokensOptions<Theme | ThemeFamily, string>
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
    const tokens = isAnsi(options.lang)
      ? ansiTokens(
          code,
          themes,
          cssVariablePrefix,
          options.tokenizeMaxLineLength
        )
      : lineRecordsToTokens(
          code,
          this.tokenizeLineRecords(
            this.#languageIds?.get(String(options.lang).toLowerCase()) ??
              langIdOf(options.lang),
            this.writeInput(input)
          ),
          themes,
          cssVariablePrefix,
          options.tokenizeMaxLineLength
        );
    return { tokens, ...themeMeta(themes, cssVariablePrefix) };
  }

  /** Grow the wasm linear memory if needed. */
  #growMemoryIfNeeded(len: number): void {
    const neededPages = Math.ceil((this.inputPtr + len) / pageSize);
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
    // Growth detaches the old buffer, so its view has length 0.
    // This check avoids the slow `memory.buffer` getter on every call.
    if (this.buffer.length !== 0) return;
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

const lexerModules = new WeakMap<
  Language,
  WebAssembly.Module | Promise<WebAssembly.Module>
>();
let emitterModule: Promise<WebAssembly.Module> | undefined;

/**
 * Supply a compiled emitter module. Use it where the runtime cannot compile
 * WebAssembly from bytes, such as Cloudflare Workers.
 */
export function initEmitter(wasm: WebAssembly.Module): void {
  emitterModule = Promise.resolve(wasm);
}

/** Decode base64 Wasm. */
export function wasmBytes(wasm: string): Uint8Array<ArrayBuffer> {
  // This runs at import, before the JIT: the `atob` loop is about 1 ms slower
  // than a native decoder for the combined module.
  const native = globalThis as unknown as {
    Uint8Array: { fromBase64?: (text: string) => Uint8Array<ArrayBuffer> };
    Buffer?: { from: (text: string, encoding: 'base64') => Uint8Array };
  };
  if (native.Uint8Array.fromBase64 !== undefined)
    return native.Uint8Array.fromBase64(wasm);
  if (native.Buffer !== undefined) {
    const buffer = native.Buffer.from(wasm, 'base64');
    return new Uint8Array(
      buffer.buffer as ArrayBuffer,
      buffer.byteOffset,
      buffer.length
    );
  }
  const binary = atob(wasm);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function createHighlighter(
  options: HighlighterOptions
): Promise<RegisteredHighlighter> {
  emitterModule ??= import('./emitter.wasm.mjs')
    .then(({ default: wasm }) => WebAssembly.compile(wasmBytes(wasm)))
    .catch((error: unknown) => {
      emitterModule = undefined;
      throw error;
    });
  const languages = [...new Set(options.langs)];
  const [emitter, ...compiled] = await Promise.all([
    emitterModule,
    ...languages.map((language) => {
      const { wasm } = language;
      if (typeof wasm !== 'string') return Promise.resolve(wasm);
      let compiledModule = lexerModules.get(language);
      if (compiledModule === undefined) {
        compiledModule = WebAssembly.compile(wasmBytes(wasm)).then((module) => {
          lexerModules.set(language, module);
          return module;
        });
        lexerModules.set(language, compiledModule);
      }
      return Promise.resolve(compiledModule);
    }),
  ]);
  return buildHighlighter(emitter, languages, compiled, options.themes, false);
}

/**
 * Register compiled lexers and themes with an emitter. Shared by
 * `createHighlighter` and `registerLanguages`. With `combined`, the emitter
 * is the combined module, and it lexes the embedded built-in languages that
 * have no registered lexer.
 */
function buildHighlighter(
  emitter: WebAssembly.Module,
  languages: readonly Language[],
  compiled: readonly WebAssembly.Module[],
  themeOptions: HighlighterOptions['themes'],
  combined: boolean
): RegisteredHighlighter {
  const registrations = new Map<
    number,
    { module: WebAssembly.Module; id: number }
  >();
  const languageIds = new Map<string, number>([
    ['plain', 0],
    ['plaintext', 0],
    ['text', 0],
    ['txt', 0],
    ['ansi', -1],
  ]);
  let nextLanguageId = 256;
  for (let i = 0; i < languages.length; i++) {
    const localIds = new Map<number, number>();
    for (const [alias, id] of Object.entries(languages[i].aliases)) {
      const name = alias.toLowerCase();
      if (!Number.isInteger(id) || id < 0 || id > 255) {
        throw new RangeError(`invalid lexer entry: ${alias}`);
      }
      if (name === 'ansi') throw new RangeError('reserved language name: ansi');
      // A built-in ID also routes embedded languages. Only a built-in module
      // keeps it; any other lexer gets a new ID, so its alias cannot reroute
      // embedded code.
      let externalId: number | undefined;
      if (id > 0 && id === LANGS[name]) {
        registrations.set(id, { module: compiled[i], id });
        externalId = id;
      } else {
        externalId = localIds.get(id);
        if (externalId === undefined) {
          externalId = nextLanguageId++;
          if (externalId > 0x7fff)
            throw new RangeError('too many registered languages');
          localIds.set(id, externalId);
          registrations.set(externalId, { module: compiled[i], id });
        }
      }
      languageIds.set(name, externalId);
    }
  }
  const roots = new Map<WebAssembly.Module, HighlightsHighlighter>();
  function createLexer(
    compiledModule: WebAssembly.Module,
    depth: number
  ): HighlightsHighlighter {
    const streams = new Map<
      number,
      { module: WebAssembly.Module; lexer: HighlightsHighlighter }
    >();
    // Finished child lexers wait here for reuse. Whole-body lexers [0] and
    // stream lexers [1] stay separate: a whole-body run does not clear an
    // unfinished stream's state.
    const idle = [
      new Map<WebAssembly.Module, HighlightsHighlighter[]>(),
      new Map<WebAssembly.Module, HighlightsHighlighter[]>(),
    ];
    const release = (
      module: WebAssembly.Module,
      child: HighlightsHighlighter
    ): void => {
      if (child.pageN > 16) return;
      const free = idle[1].get(module);
      if (free === undefined) idle[1].set(module, [child]);
      else free.push(child);
    };
    const lexer = new HighlightsHighlighter(
      compiledModule,
      (_id, _mode, _length, reset) => {
        if (reset !== false && streams.size > 0) {
          for (const child of streams.values()) {
            release(child.module, child.lexer);
          }
          streams.clear();
        }
      },
      {
        language: (ptr: number, length: number) => {
          lexer.bindMemory();
          const bytes = lexer.buffer;
          let name = '';
          for (let i = ptr; i < ptr + length; i++) {
            if (bytes[i] > 127) {
              name = dec.decode(bytes.subarray(ptr, ptr + length));
              break;
            }
            name += String.fromCharCode(bytes[i]);
          }
          name = name.toLowerCase();
          const id =
            languageIds.get(name) ?? (combined ? LANGS[name] : undefined);
          return id !== undefined && id > 0 ? id : 0;
        },
        // Most embedded bodies are under 32 bytes. Short copies use loops: a
        // typed array view costs about 30 ns.
        embed: (
          id: number,
          from: number,
          to: number,
          reset: number,
          context: number,
          out: number,
          cap: number
        ) => {
          if (reset === 2) {
            const child = streams.get(context);
            if (child !== undefined) {
              streams.delete(context);
              release(child.module, child.lexer);
            }
            return 0;
          }
          // An empty body can still start a stream. Its reset must
          // reach the child, or a reused lexer continues its last stream.
          if (to <= from && reset !== 1) return context;
          let registration = registrations.get(id);
          if (registration === undefined && combined && id > 0 && id < 256) {
            registration = { module: emitter, id };
            registrations.set(id, registration);
          }
          if (registration === undefined || depth >= 64) return context;
          const { module } = registration;
          let child: HighlightsHighlighter;
          let free: HighlightsHighlighter[] | undefined;
          if (reset < 0) {
            free = idle[0].get(module);
            child = free?.pop() ?? createLexer(module, depth + 1);
          } else {
            if (context === 0) {
              do context++;
              while (streams.has(context));
            }
            const open = streams.get(context);
            if (open?.module === module) child = open.lexer;
            else {
              if (open !== undefined) release(open.module, open.lexer);
              child =
                idle[1].get(module)?.pop() ?? createLexer(module, depth + 1);
              streams.set(context, { module, lexer: child });
              // A reused lexer must not continue the state of its last stream.
              if (reset === 0) child.lexRecords(registration.id, 0, true, 5);
            }
          }
          lexer.bindMemory();
          let length = to - from;
          let at = child.inputPtr;
          // The four-byte steps can pass the end by three bytes.
          // Both buffers keep 96 spare bytes there.
          if (length <= 96 && at + 192 <= child.buffer.length) {
            for (let i = 0; i < length; i += 4)
              child.dv.setUint32(
                at + i,
                lexer.dv.getUint32(from + i, true),
                true
              );
          } else length = child.writeInput(lexer.buffer.subarray(from, to));
          at = child.lexRecords(
            registration.id,
            length,
            reset < 0 ? undefined : reset !== 0,
            5
          );
          length = child.dv.getUint32(10, true);
          if (length > 0) {
            if (out + length + 16 > cap) {
              out = reserve(length);
              lexer.bindMemory();
            }
            if (length <= 96) {
              for (let i = 0; i < length; i += 4)
                lexer.dv.setUint32(
                  out + i,
                  child.dv.getUint32(at + i, true),
                  true
                );
            } else
              lexer.buffer.set(child.buffer.subarray(at, at + length), out);
            lexer.dv.setUint32(10, length, true);
          }
          if (reset < 0 && child.pageN <= 16) {
            if (free === undefined) idle[0].set(module, [child]);
            else free.push(child);
          }
          return context;
        },
      }
    );
    // Markdown reads its nesting depth from control byte 14.
    lexer.buffer[14] = depth;
    const reserve = lexer.instance.exports.reserve as (bytes: number) => number;
    return lexer;
  }
  const themes = new Map<string, Theme>();
  for (const value of themeOptions) {
    const first = resolveTheme(value);
    let names = first === value || !value.name ? [] : [value.name];
    for (const member of first === value
      ? [first]
      : (value as ThemeFamily).themes) {
      const theme = resolveTheme(member);
      if (theme.id !== undefined) themes.set(theme.id, theme);
      names.push(theme.name);
      for (const name of names) {
        themes.set(name, theme);
        themes.set(
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
          theme
        );
      }
      names = [];
    }
  }
  const plainRecord = new Uint32Array(2);
  const beforeEmit = (id: number, mode: number, length: number): void => {
    let records: Uint32Array;
    if (id === 0) {
      plainRecord[0] = length;
      records = length === 0 ? plainRecord.subarray(0, 0) : plainRecord;
    } else {
      const registration = registrations.get(id)!;
      let lexer = roots.get(registration.module);
      // Wasm memory cannot shrink. Replace a lexer above 8 MiB when small
      // inputs resume.
      if (lexer === undefined || (lexer.pageN > 128 && length <= pageSize)) {
        lexer = createLexer(registration.module, 0);
        roots.set(registration.module, lexer);
      }
      records = lexer.tokenizeLineRecords(
        registration.id,
        lexer.writeInput(
          highlighter.buffer.subarray(
            highlighter.inputPtr,
            highlighter.inputPtr + length
          )
        )
      );
    }
    highlighter.writeRecords(mode, length, records);
  };
  let highlighter = new HighlightsHighlighter(
    emitter,
    beforeEmit,
    {},
    languageIds
  );
  const resolveOptions = (
    input: string | Uint8Array | ArrayBuffer,
    value: CodeToTokensOptions<Theme | ThemeFamily | string, string>
  ): CodeToTokensOptions<Theme | ThemeFamily, string> => {
    const lang = String(value.lang).toLowerCase();
    if (!languageIds.has(lang))
      throw new RangeError(`language is not loaded: ${value.lang}`);
    const resolved: Record<string, Theme | ThemeFamily> = {};
    const entries =
      value.themes === undefined
        ? [['theme', value.theme] as const]
        : Object.entries(value.themes);
    for (const [key, reference] of entries) {
      if (typeof reference !== 'string') {
        resolved[key] = reference;
        continue;
      }
      const theme = themes.get(reference);
      if (theme === undefined)
        throw new RangeError(`theme is not loaded: ${reference}`);
      resolved[key] = theme;
    }
    if (
      highlighter.pageN > 128 &&
      (typeof input === 'string' ? input.length : input.byteLength) <= pageSize
    ) {
      highlighter = new HighlightsHighlighter(
        emitter,
        beforeEmit,
        {},
        languageIds
      );
    }
    return value.themes === undefined
      ? { ...value, theme: resolved.theme, themes: undefined }
      : { ...value, theme: undefined, themes: resolved };
  };
  return {
    // `resolveOptions` can replace `highlighter`. Call it first.
    codeToHtml: (input, value) => {
      const resolved = resolveOptions(input, value);
      return highlighter.codeToHtml(input, resolved);
    },
    codeToTokens: (input, value) => {
      const resolved = resolveOptions(input, value);
      return highlighter.codeToTokens(input, resolved);
    },
    getLoadedLanguages: () => [...languageIds.keys()],
  };
}

let registered: RegisteredHighlighter | undefined;
let registeredLangs: Language[] = [];
let registeredLexers = new Map<
  string,
  { module?: WebAssembly.Module; id: number }
>();

/**
 * The lexer that `StreamTokenizer` and `LiveTokenizer` use for a name from
 * `registerLanguages`. A lexer from `@pierre/wat-tools` has `module`. A
 * built-in language module has none, and `id` selects the built-in lexer:
 * its own lexer calls the host for embedded code and cannot save its state.
 */
export function registeredLexer(
  lang: string
): { module?: WebAssembly.Module; id: number } | undefined {
  return registeredLexers.get(String(lang).toLowerCase());
}

/**
 * Add lexers to `codeToHtml` and `codeToTokens`. Their names and aliases
 * override built-in names there. Call `init` first; the combined module emits
 * their HTML, so no other Wasm loads.
 */
export function registerLanguages(langs: readonly Language[]): void {
  const list = registeredLangs.slice();
  for (const language of langs) {
    // A loader can return a new object for the same lexer on each call, so
    // compare the content.
    if (
      !list.some(
        (old) =>
          old === language ||
          (old.name === language.name &&
            old.wasm === language.wasm &&
            JSON.stringify(old.aliases) === JSON.stringify(language.aliases))
      )
    )
      list.push(language);
  }
  if (registered !== undefined && list.length === registeredLangs.length) {
    return;
  }
  const compiled = list.map((language) => {
    const { wasm } = language;
    if (typeof wasm !== 'string') return wasm;
    let compiledModule = lexerModules.get(language);
    if (!(compiledModule instanceof WebAssembly.Module)) {
      compiledModule = new WebAssembly.Module(wasmBytes(wasm));
      lexerModules.set(language, compiledModule);
    }
    return compiledModule;
  });
  registered = buildHighlighter(assertWasmModule(), list, compiled, [], true);
  registeredLangs = list;
  registeredLexers = new Map();
  for (let i = 0; i < list.length; i++) {
    const custom = WebAssembly.Module.exports(compiled[i]).some(
      ({ name }) => name === 'saveState'
    )
      ? compiled[i]
      : undefined;
    for (const [alias, id] of Object.entries(list[i].aliases))
      registeredLexers.set(alias.toLowerCase(), { module: custom, id });
  }
}

/**
 * Return a `<pre class="highlights">` fragment with inline colors.
 * With `themes`, each span uses the default theme inline and CSS custom
 * properties for the other themes, as in `codeToTokens`'s `htmlStyle`.
 */
export function codeToHtml(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToHtmlOptions<Theme | ThemeFamily, Lang | (string & {})>
): Uint8Array {
  if (
    registered !== undefined &&
    registeredLexers.has(String(options.lang).toLowerCase())
  ) {
    return registered.codeToHtml(input, options);
  }
  return assertShared(input).codeToHtml(input, options);
}

/**
 * Return Shiki-compatible tokens, grouped by line.
 * WebAssembly lexes the input and splits lines. JavaScript converts the
 * style records to tokens.
 */
export function codeToTokens(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToTokensOptions<Theme | ThemeFamily, Lang | (string & {})>
): TokensResult {
  if (
    registered !== undefined &&
    registeredLexers.has(String(options.lang).toLowerCase())
  ) {
    return registered.codeToTokens(input, options);
  }
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
  #ansi: AnsiState | undefined;
  #themes: ResolvedTheme[];
  #cssVariablePrefix: string;
  #maxLineLength: number | undefined;
  #pendingBytes: Uint8Array = new Uint8Array(0);
  #pendingByteLength = 0;
  #pendingSurrogate = '';
  #tail = '';
  #streamChar = 0;
  #streamStarted = false;
  #pooled = true;

  constructor(
    options: CodeToTokensOptions<Theme | ThemeFamily, Lang | (string & {})>
  ) {
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
    const registered = registeredLexer(options.lang);
    this.#ansi = isAnsi(options.lang) ? new AnsiState() : undefined;
    this.#langId =
      registered?.id ?? (this.#ansi === undefined ? langIdOf(options.lang) : 0);
    this.#themes = resolveOptionThemes(options);
    const compiledWasm = assertWasmModule();
    if (registered?.module === undefined) {
      this.#hl =
        pooledStreamHighlighter?.wasmModule === compiledWasm
          ? pooledStreamHighlighter
          : new HighlightsHighlighter(compiledWasm);
      pooledStreamHighlighter = undefined;
    } else {
      // The custom lexer keeps the stream state. The combined module only
      // converts its records to line records, so it cannot go to the pool.
      this.#pooled = false;
      const lexer = new HighlightsHighlighter(registered.module);
      const emitter = new HighlightsHighlighter(
        compiledWasm,
        (id, mode, length, reset) =>
          emitter.writeRecords(
            mode,
            length,
            lexer.tokenizeLineRecords(
              id,
              lexer.writeInput(
                emitter.buffer.subarray(
                  emitter.inputPtr,
                  emitter.inputPtr + length
                )
              ),
              reset
            )
          ),
        {},
        new Map()
      );
      this.#hl = emitter;
    }
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
      this.#pooled &&
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
    let lines: ThemedToken[][];
    if (this.#ansi === undefined) {
      let byteLen = prefix === '' ? 0 : hl.writeInput(prefix);
      byteLen += hl.writeInput(input, byteLen);
      const recs = hl.tokenizeLineRecords(
        this.#langId,
        byteLen,
        !this.#streamStarted
      );
      this.#streamStarted = true;
      lines = lineRecordsToTokens(
        code,
        recs,
        this.#themes,
        this.#cssVariablePrefix,
        this.#maxLineLength,
        this.#streamChar
      );
    } else {
      lines = ansiTokens(
        code,
        this.#themes,
        this.#cssVariablePrefix,
        this.#maxLineLength,
        this.#ansi,
        this.#streamChar
      );
    }
    this.#streamChar += code.length;
    return lines;
  }
}
