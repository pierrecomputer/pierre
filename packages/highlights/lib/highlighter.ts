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
} from './index';
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
 * or is `ansi`.
 */
export function isSupportedLanguage(lang: string): lang is Lang {
  return typeof LANGS[String(lang).toLowerCase()] === 'number' || isAnsi(lang);
}

export class HighlightsHighlighter implements Highlighter {
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
    this.#highlight = (instance.exports.highlight ??
      instance.exports.lex ??
      instance.exports.emit) as () => void;
    this.#highlightStream = (instance.exports.highlightStream ??
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
    options: CodeToHtmlOptions
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

const lexerModules = new WeakMap<Language, Promise<WebAssembly.Module>>();
let emitterModule: Promise<WebAssembly.Module> | undefined;

export async function createHighlighter(
  options: HighlighterOptions
): Promise<RegisteredHighlighter> {
  emitterModule ??= import('./emitter.wasm.mjs').then(({ default: bytes }) =>
    WebAssembly.compile(bytes)
  );
  const languages = [...new Set(options.langs)];
  const [emitter, ...compiled] = await Promise.all([
    emitterModule,
    ...languages.map((language) => {
      let compiledModule = lexerModules.get(language);
      if (compiledModule === undefined) {
        const binary = atob(language.wasm);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        compiledModule = WebAssembly.compile(bytes);
        lexerModules.set(language, compiledModule);
      }
      return compiledModule;
    }),
  ]);
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
      const builtIn = LANGS[name];
      let externalId = typeof builtIn === 'number' ? builtIn : localIds.get(id);
      externalId ??= nextLanguageId++;
      if (externalId > 0x7fff)
        throw new RangeError('too many registered languages');
      localIds.set(id, externalId);
      languageIds.set(name, externalId);
      registrations.set(externalId, { module: compiled[i], id });
    }
  }
  const roots = new Map<WebAssembly.Module, HighlightsHighlighter>();
  function createLexer(
    compiledModule: WebAssembly.Module,
    depth: number
  ): HighlightsHighlighter {
    const children = new Map<
      number,
      { language: number; lexer: HighlightsHighlighter }
    >();
    let nextContext = 0;
    const lexer = new HighlightsHighlighter(
      compiledModule,
      (_id, _mode, _length, reset) => {
        if (reset !== false) {
          children.clear();
          nextContext = 0;
        }
      },
      {
        language: (ptr: number, length: number) => {
          lexer.bindMemory();
          const name = dec
            .decode(lexer.buffer.subarray(ptr, ptr + length))
            .toLowerCase();
          return languageIds.get(name) ?? 0;
        },
        embed: (
          id: number,
          from: number,
          to: number,
          reset: number,
          context: number
        ) => {
          const record = lexer.instance.exports.record as (
            type: number,
            end: number
          ) => void;
          const registration = registrations.get(id);
          if (
            registration === undefined ||
            id === 0 ||
            to <= from ||
            depth >= 64
          ) {
            if (to > from) record(0, to);
            return context;
          }
          if (context === 0) context = ++nextContext;
          let child = children.get(context);
          if (child === undefined || child.language !== id) {
            child = {
              language: id,
              lexer: createLexer(registration.module, depth + 1),
            };
            children.set(context, child);
          }
          lexer.bindMemory();
          const records = child.lexer.tokenizeLineRecords(
            registration.id,
            child.lexer.writeInput(lexer.buffer.subarray(from, to)),
            reset < 0 ? undefined : reset !== 0
          );
          const gap = lexer.instance.exports.gap as (end: number) => void;
          for (let i = 0; i < records.length; i += 2) {
            if (records[i + 1] === 255) gap(from + records[i]);
            else record(records[i + 1], from + records[i]);
          }
          if (records.length === 0) record(0, to);
          return context;
        },
      }
    );
    return lexer;
  }
  const themes = new Map<string, Theme>();
  for (const value of options.themes) {
    const theme = resolveTheme(value);
    if (theme.id !== undefined) themes.set(theme.id, theme);
    themes.set(theme.name, theme);
    themes.set(
      theme.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      theme
    );
  }
  const plainRecord = new Uint32Array(2);
  const highlighter = new HighlightsHighlighter(
    emitter,
    (id, mode, length) => {
      let records: Uint32Array;
      if (id === 0) {
        plainRecord[0] = length;
        records = length === 0 ? plainRecord.subarray(0, 0) : plainRecord;
      } else {
        const registration = registrations.get(id)!;
        let lexer = roots.get(registration.module);
        if (lexer === undefined) {
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
        for (let i = 1; i < records.length; i += 2) {
          if (records[i] === 255) records[i] = 0;
        }
      }
      const blobEnd =
        mode === 0 || mode === 3
          ? 0
          : highlighter.dv.getUint32(14, true) +
            highlighter.dv.getUint32(18, true);
      const recordsPtr =
        Math.ceil(Math.max(highlighter.inputPtr + length + 96, blobEnd) / 16) *
        16;
      const pages = Math.ceil((recordsPtr + records.byteLength + 96) / 65536);
      if (pages > highlighter.pageN) {
        highlighter.memory.grow(pages - highlighter.pageN);
        highlighter.bindMemory();
      }
      highlighter.buffer.set(
        new Uint8Array(records.buffer, records.byteOffset, records.byteLength),
        recordsPtr
      );
      highlighter.dv.setUint32(22, recordsPtr, true);
      highlighter.dv.setUint32(26, records.byteLength, true);
    },
    {},
    languageIds
  );
  const resolveOptions = (
    value: CodeToTokensOptions<Theme | ThemeFamily | string>
  ): CodeToTokensOptions => {
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
    return value.themes === undefined
      ? { ...value, theme: resolved.theme, themes: undefined }
      : { ...value, theme: undefined, themes: resolved };
  };
  return {
    codeToHtml: (input, value) =>
      highlighter.codeToHtml(input, resolveOptions(value)),
    codeToTokens: (input, value) =>
      highlighter.codeToTokens(input, resolveOptions(value)),
  };
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
    this.#ansi = isAnsi(options.lang) ? new AnsiState() : undefined;
    this.#langId = this.#ansi === undefined ? langIdOf(options.lang) : 0;
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
