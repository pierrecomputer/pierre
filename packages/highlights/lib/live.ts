import {
  assertWasmModule,
  HighlightsHighlighter,
  langIdOf,
} from './highlighter';
import type { CodeToTokensOptions, ThemedToken } from './index';
import { defaultCssVariablePrefix } from './theme';
import tokenTypes from './token-types';
import type { ResolvedTheme } from './tokens';
import { rangeToToken, resolveOptionThemes, standardTypes } from './tokens';

const enc = new TextEncoder();

/** `$Token` names in slot order; a raw record's token id indexes this list. */
export const tokenNames: readonly string[] = tokenTypes;

/** A zero-based UTF-16 position; `character` may equal the line length. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** One replacement of an end-exclusive range in the pre-edit document. */
export interface TextEdit {
  readonly range: {
    readonly start: Position;
    readonly end: Position;
  };
  readonly newText: string;
}

/** One coalesced half-open span of changed or re-tokenized lines. */
export interface LiveLineChange {
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  readonly newStartLine: number;
  readonly newEndLine: number;
}

/**
 * One styled run: its UTF-16 start column, CSS color, and text.
 * Unstyled runs use the theme foreground, or `''` if none is defined.
 * Colors come from the first resolved theme. Use `getLineTokens` for
 * font styles or custom properties for multiple themes.
 */
export type HighlightedToken = [char: number, fg: string, text: string];

/**
 * A half-open `[startLine, endLine)` range in post-edit line numbers.
 * Synchronous tokenization targets this range with a one-millisecond
 * budget. `onDeferTokenize` receives unfinished lines later.
 */
export interface LiveUpdateOptions {
  readonly renderRange?: readonly [startLine: number, endLine: number];
}

/** Constructor options: tokenization options plus the initial document. */
export type LiveTokenizerOptions = CodeToTokensOptions & {
  /** The initial document; defaults to the empty document. */
  code?: string;
  /**
   * Receive completed lines outside `renderRange` during the update,
   * then all deferred lines in background batches. Deferred lines can
   * include lines in `renderRange`. Line numbers refer to the document
   * at delivery time.
   *
   * With a constructor `renderRange`, this callback can run before the
   * instance is assigned to a variable.
   */
  onDeferTokenize?: (lines: Map<number, HighlightedToken[]>) => void;
  /**
   * Request initial tokenization of this range within the time budget.
   * `onDeferTokenize` receives unfinished lines later. The callback can
   * first run inside the constructor.
   */
  renderRange?: readonly [startLine: number, endLine: number];
};

/** The result of a successful update batch. */
export interface LiveTokenizerUpdate {
  readonly revision: number;
  readonly previousLineCount: number;
  readonly lineCount: number;
  readonly lineChanges: readonly LiveLineChange[];
  /**
   * Lines completed within `renderRange` during synchronous tokenization,
   * keyed by post-edit line number. Empty if the update has no `renderRange`.
   * `onDeferTokenize` receives unfinished lines later. Use `flush` to
   * complete them synchronously.
   */
  readonly lines: Map<number, HighlightedToken[]>;
}

/**
 * A borrowed view of one line's token records.
 * `packed24` stores one `(tokenId << 24) | endUtf16` word per token.
 * `wide32` stores `[endUtf16, tokenId]` pairs when line ends exceed 24 bits.
 * Each record starts at the previous end, or 0 for the first record.
 *
 * The next successful edit, reset, disposal, or deferred tokenization
 * slice invalidates this view. Use `.slice()` to keep a copy.
 */
export interface LiveTokenRecords {
  readonly revision: number;
  readonly format: 'packed24' | 'wide32';
  readonly data: Uint32Array;
}

/** The live-tokenizer entry points exported by the Wasm module. */
interface LiveWasmExports {
  liveStage(len: number): number;
  liveInitDoc(ptr: number, len: number, lang: number): void;
  liveApplyEdits(ptr: number, undelivered?: number): void;
  liveRun(budget: number, endLine?: number, work?: number): number;
  liveLineCount(): number;
  liveLineLen(i: number): number;
  liveLineByteLen(i: number): number;
  liveLineTextPtr(i: number): number;
  liveLineFlags(i: number): number;
  liveLineTokPtr(i: number): number;
  liveLineTokCount(i: number): number;
  liveChangesPtr(): number;
  liveStats(k: number): number;
}

/** A validated, normalized edit in ascending document order. */
interface NormalizedEdit {
  sl: number;
  sc: number;
  el: number;
  ec: number;
  newText: string;
}

const fatalDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const loneSurrogateRe =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Encode preserving lone surrogates as 3-byte WTF-8 sequences. */
function encodeLiveText(s: string): Uint8Array {
  if (!loneSurrogateRe.test(s)) return enc.encode(s);
  const out = new Uint8Array(s.length * 3);
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out[w++] = c;
    } else if (c < 0x800) {
      out[w++] = 0xc0 | (c >> 6);
      out[w++] = 0x80 | (c & 63);
    } else {
      if (c >= 0xd800 && c < 0xdc00) {
        const lo = s.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo < 0xe000) {
          const cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          out[w++] = 0xf0 | (cp >> 18);
          out[w++] = 0x80 | ((cp >> 12) & 63);
          out[w++] = 0x80 | ((cp >> 6) & 63);
          out[w++] = 0x80 | (cp & 63);
          i++;
          continue;
        }
      }
      out[w++] = 0xe0 | (c >> 12);
      out[w++] = 0x80 | ((c >> 6) & 63);
      out[w++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, w);
}

/** Decode WTF-8 bytes, restoring lone surrogates the fatal decoder rejects. */
function decodeWtf8(bytes: Uint8Array, length: number): string {
  const units = new Array<number>(length);
  let written = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      units[written++] = b;
      i += 1;
    } else if (b < 0xe0) {
      units[written++] = ((b & 31) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b < 0xf0) {
      units[written++] =
        ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      i += 3;
    } else {
      const cp =
        ((b & 7) << 18) |
        ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) |
        (bytes[i + 3] & 63);
      units[written++] = 0xd800 + ((cp - 0x10000) >> 10);
      units[written++] = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      i += 4;
    }
  }
  let text = '';
  for (let at = 0; at < written; at += 4096) {
    text += String.fromCharCode(
      ...units.slice(at, Math.min(at + 4096, written))
    );
  }
  return text;
}

/** Validate a half-open `[startLine, endLine)` render range option. */
function checkRenderRange(
  range: readonly [number, number] | undefined
): readonly [number, number] | undefined {
  if (range === undefined) return undefined;
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    !Number.isInteger(range[0]) ||
    !Number.isInteger(range[1]) ||
    range[0] < 0 ||
    range[1] < range[0]
  ) {
    throw new TypeError(
      'renderRange must be [startLine, endLine] with 0 <= startLine <= endLine'
    );
  }
  return range;
}

/**
 * Ref or unref a MessagePort. Node and Bun keep the event loop active
 * while a started port is referenced. Browser ports have neither method.
 */
function refPort(port: MessagePort, alive: boolean): void {
  const p = port as MessagePort & { ref?: () => void; unref?: () => void };
  if (alive) p.ref?.();
  else p.unref?.();
}

/** A line's terminator from its descriptor flags: byte-count bits 0-1
 *  (0 none, 1 one byte, 2 CRLF) plus bit 4 marking a one-byte CR. */
function eol(flags: number): string {
  const term = flags & 3;
  if (term === 0) return '';
  if (term === 2) return '\r\n';
  return (flags & 16) !== 0 ? '\r' : '\n';
}

/**
 * An editable document with an incremental tokenizer and its own Wasm
 * instance. Edits use UTF-16 positions and can split or join `\r\n`,
 * `\n`, or lone `\r` terminators. Lexers receive each line break as `\n`.
 *
 * Tokenization starts at each changed region. It stops when the outgoing
 * lexer state matches the previous state. `renderRange` limits synchronous
 * work. Background batches deliver the rest through `onDeferTokenize`.
 * Pending lines keep their previous tokens until processed. Use `flush`
 * to complete them synchronously.
 */
export class LiveTokenizer {
  #hl: HighlightsHighlighter | undefined;
  #langId: number;
  #themes: ResolvedTheme[];
  #cssVariablePrefix: string;
  #maxLineLength: number;
  #onDeferTokenize:
    | ((lines: Map<number, HighlightedToken[]>) => void)
    | undefined;
  #revision = 0;
  // Incremented by edits, reset, flush, pause, and dispose to cancel old slices.
  #deferGeneration = 0;
  // Created on first use and closed by dispose.
  #channel: MessageChannel | undefined;
  // Keep Node/Bun alive only while slice messages are pending.
  #postedSlices = 0;
  #materializing:
    | {
        line: number;
        byte: number;
        text: string;
        record: number;
        start: number;
        tokens: HighlightedToken[];
      }
    | undefined;
  #paused = false;
  // Set while applyEdits or reset runs, including the synchronous
  // onDeferTokenize delivery inside it: a mutating call from that callback
  // would replace the change list the outer update is about to report.
  #updating = false;

  constructor(options: LiveTokenizerOptions) {
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix =
      options.cssVariablePrefix ?? defaultCssVariablePrefix;
    this.#maxLineLength = options.tokenizeMaxLineLength ?? 0;
    this.#onDeferTokenize = options.onDeferTokenize;
    const renderRange = checkRenderRange(options.renderRange);
    this.#hl = LiveTokenizer.#createStaged(options.code ?? '', this.#langId);
    this.#runSlice(this.#hl, this.#ex, renderRange);
  }

  /** Instantiate an isolated Wasm instance and stage `code` into its line
   *  table; the caller drives tokenization. */
  static #createStaged(code: string, langId: number): HighlightsHighlighter {
    const hl = new HighlightsHighlighter(assertWasmModule());
    const ex = hl.instance.exports as unknown as LiveWasmExports;
    const bytes = encodeLiveText(code);
    const ptr = ex.liveStage(bytes.length);
    hl.bindMemory();
    hl.buffer.set(bytes, ptr);
    ex.liveInitDoc(ptr, bytes.length, langId);
    hl.bindMemory();
    return hl;
  }

  /** Return the active instance or throw after disposal. */
  #live(): HighlightsHighlighter {
    const hl = this.#hl;
    if (hl == null) throw new Error('tokenizer is disposed');
    return hl;
  }

  /** Resolve exports through the active instance so disposal releases both. */
  get #ex(): LiveWasmExports {
    return this.#live().instance.exports as unknown as LiveWasmExports;
  }

  /** Monotonic revision; bumps once per successful mutating batch. */
  get revision(): number {
    this.#live();
    return this.#revision;
  }

  /** Number of lines in the document (a trailing terminator adds one). */
  get lineCount(): number {
    this.#live();
    return this.#ex.liveLineCount();
  }

  /** True while deferred scanning or token materialization remains pending. */
  get pendingTokenization(): boolean {
    this.#live();
    return this.#materializing !== undefined || this.#ex.liveStats(9) !== 0;
  }

  /**
   * Complete pending lines before `endLine`, or all lines if it is omitted.
   * Deliver completed lines through `onDeferTokenize`. Clear any pause and
   * schedule remaining work in the background.
   */
  flush(endLine?: number): void {
    const hl = this.#live();
    if (endLine !== undefined) checkRenderRange([0, endLine]);
    const ex = this.#ex;
    this.#paused = false;
    const generation = ++this.#deferGeneration;
    const end = Math.min(endLine ?? ex.liveLineCount(), ex.liveLineCount());
    try {
      this.#workSlice(hl, ex, end, Infinity);
    } finally {
      if (
        generation === this.#deferGeneration &&
        this.#hl === hl &&
        !this.#paused &&
        this.pendingTokenization
      )
        this.#scheduleSlice(generation);
    }
  }

  /**
   * Pause background tokenization and keep the pending work.
   * No background batches run or deliver tokens while paused. Pending lines
   * keep their previous tokens. `resume`, `flush`, `applyEdits`, and `reset`
   * clear the pause. Edits and resets schedule their own remaining work.
   */
  pause(): void {
    this.#live();
    if (this.#paused) return;
    this.#paused = true;
    this.#deferGeneration += 1;
  }

  /** Resume background re-tokenization suspended by `pause`. */
  resume(): void {
    this.#live();
    if (!this.#paused) return;
    this.#paused = false;
    if (this.pendingTokenization) {
      this.#scheduleSlice(this.#deferGeneration);
    }
  }

  /** Release the Wasm instance and drop deferred work; later calls throw. */
  dispose(): void {
    if (this.#hl == null) return;
    this.#deferGeneration += 1;
    this.#hl = undefined;
    this.#materializing = undefined;
    if (this.#channel !== undefined) {
      this.#channel.port1.close();
      this.#channel.port2.close();
      this.#channel = undefined;
    }
  }

  /** UTF-16 length of one line, excluding its terminator. */
  getLineLength(line: number): number {
    this.#live();
    const ex = this.#ex;
    this.#checkLine(line, ex);
    return ex.liveLineLen(line);
  }

  /** One line's text, excluding its terminator. */
  getLineText(line: number): string {
    const hl = this.#live();
    const ex = this.#ex;
    this.#checkLine(line, ex);
    return this.#lineText(hl, ex, line);
  }

  /** The whole document's text, reconstructing each line's terminator. */
  getText(): string {
    const hl = this.#live();
    const ex = this.#ex;
    const count = ex.liveLineCount();
    let text = '';
    for (let line = 0; line < count; line++) {
      text += this.#lineText(hl, ex, line);
      text += eol(ex.liveLineFlags(line));
    }
    return text;
  }

  #lineText(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    line: number
  ): string {
    const ptr = ex.liveLineTextPtr(line);
    const len = ex.liveLineByteLen(line);
    if (len === 0) return '';
    const bytes = hl.buffer.subarray(ptr, ptr + len);
    try {
      return fatalDecoder.decode(bytes);
    } catch {
      return decodeWtf8(bytes, ex.liveLineLen(line));
    }
  }

  /**
   * Zero-copy packed records for one line. The view is invalidated by the
   * next successful edit, reset, dispose, or deferred tokenization slice.
   */
  getLineRecords(line: number): LiveTokenRecords {
    const hl = this.#live();
    const ex = this.#ex;
    this.#checkLine(line, ex);
    const n = ex.liveLineTokCount(line);
    const wide = (ex.liveLineFlags(line) & 4) !== 0;
    return {
      revision: this.#revision,
      format: wide ? 'wide32' : 'packed24',
      data: new Uint32Array(
        hl.memory.buffer,
        n === 0 ? 0 : ex.liveLineTokPtr(line),
        wide ? n * 2 : n
      ),
    };
  }

  /**
   * Return themed tokens and string, comment, and regex ranges for bracket
   * matching. All offsets are relative to the line.
   * At `tokenizeMaxLineLength`, return one token without syntax styles.
   * Raw records remain available.
   *
   * Pending lines return their previous tokens. A new line with no records
   * returns its text as one token without syntax styles.
   */
  getLineTokens(line: number): {
    tokens: ThemedToken[];
    bracketIgnoredRanges: [start: number, end: number][];
  } {
    const hl = this.#live();
    const ex = this.#ex;
    this.#checkLine(line, ex);
    const text = this.#lineText(hl, ex, line);
    const max = this.#maxLineLength;
    if (max > 0 && text.length >= max) {
      return {
        tokens: [
          rangeToToken(
            text,
            0,
            text.length,
            0,
            this.#themes,
            this.#cssVariablePrefix
          ),
        ],
        bracketIgnoredRanges: [],
      };
    }
    const n = ex.liveLineTokCount(line);
    const wide = (ex.liveLineFlags(line) & 4) !== 0;
    const ptr = ex.liveLineTokPtr(line);
    const data = new Uint32Array(
      hl.memory.buffer,
      n === 0 ? 0 : ptr,
      wide ? n * 2 : n
    );
    const tokens: ThemedToken[] = [];
    const bracketIgnoredRanges: [number, number][] = [];
    let start = 0;
    for (let r = 0; r < n; r++) {
      const end = wide ? data[r * 2] : data[r] & 0xffffff;
      const hli = wide ? data[r * 2 + 1] : data[r] >>> 24;
      if (end > start) {
        tokens.push(
          rangeToToken(
            text,
            start,
            end,
            hli,
            this.#themes,
            this.#cssVariablePrefix
          )
        );
        if (standardTypes[hli] !== 0) {
          const last = bracketIgnoredRanges[bracketIgnoredRanges.length - 1];
          if (last !== undefined && last[1] >= start) last[1] = end;
          else bracketIgnoredRanges.push([start, end]);
        }
        start = end;
      }
    }
    // no records does not imply an empty line: a freshly spliced line that
    // deferred work has not reached yet still has text to show unstyled
    if (tokens.length === 0 && text.length > 0) {
      tokens.push(
        rangeToToken(
          text,
          0,
          text.length,
          0,
          this.#themes,
          this.#cssVariablePrefix
        )
      );
    }
    return { tokens, bracketIgnoredRanges };
  }

  /**
   * Validate and apply edits to the current document. Without `renderRange`,
   * tokenization completes synchronously and `lines` is empty.
   * With `renderRange`, return lines completed within its time budget.
   * `onDeferTokenize` receives all remaining lines later.
   *
   * Remap pending work through the edits without waiting for completion.
   * Calling `applyEdits` or `reset` from this update's synchronous callback
   * throws. Reads, `pause`, and `flush` are allowed.
   */
  applyEdits(
    edits: readonly TextEdit[],
    options?: LiveUpdateOptions
  ): LiveTokenizerUpdate {
    const hl = this.#live();
    const ex = this.#ex;
    this.#checkNotUpdating();
    const renderRange = checkRenderRange(options?.renderRange);
    const batch = this.#validate(edits, hl, ex);
    const previousLineCount = ex.liveLineCount();
    if (batch.length === 0) {
      this.resume();
      return {
        revision: this.#revision,
        previousLineCount,
        lineCount: previousLineCount,
        lineChanges: [],
        lines: new Map(),
      };
    }
    // scheduled slices are superseded: the native splice absorbs the pending
    // dirty ranges into this batch and #runSlice restarts the background tail
    this.#deferGeneration += 1;
    this.#paused = false;
    this.#updating = true;
    try {
      this.#stageEdits(hl, ex, batch);
      this.#revision += 1;
      const lines = this.#runSlice(hl, ex, renderRange);
      return this.#readUpdate(hl, ex, previousLineCount, lines);
    } finally {
      this.#updating = false;
    }
  }

  /** Replace the document in a fresh Wasm instance and swap it in. */
  reset(code: string, options?: LiveUpdateOptions): LiveTokenizerUpdate {
    this.#live();
    this.#checkNotUpdating();
    const renderRange = checkRenderRange(options?.renderRange);
    if (typeof code !== 'string') throw new TypeError('code must be a string');
    // pending tokens describe the outgoing document; drop them, don't settle
    this.#deferGeneration += 1;
    this.#paused = false;
    const previousLineCount = this.#ex.liveLineCount();
    this.#materializing = undefined;
    const hl = LiveTokenizer.#createStaged(code, this.#langId);
    this.#hl = hl;
    const ex = this.#ex;
    this.#revision += 1;
    this.#updating = true;
    let lines: Map<number, HighlightedToken[]>;
    try {
      lines = this.#runSlice(hl, ex, renderRange);
    } finally {
      this.#updating = false;
    }
    const lineCount = ex.liveLineCount();
    return {
      revision: this.#revision,
      previousLineCount,
      lineCount,
      lineChanges: [
        {
          oldStartLine: 0,
          oldEndLine: previousLineCount,
          newStartLine: 0,
          newEndLine: lineCount,
        },
      ],
      lines,
    };
  }

  /** Reject a mutating call made from inside a synchronous update. */
  #checkNotUpdating(): void {
    if (this.#updating) {
      throw new Error(
        'applyEdits and reset cannot be called from onDeferTokenize during an update; use pause, flush, or the reads instead'
      );
    }
  }

  #runSlice(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    renderRange: readonly [number, number] | undefined
  ): Map<number, HighlightedToken[]> {
    if (renderRange === undefined) {
      ex.liveRun(0x7fffffff);
      hl.bindMemory();
      return new Map();
    }
    const generation = this.#deferGeneration;
    const end =
      renderRange[0] >= ex.liveLineCount()
        ? 0
        : Math.min(renderRange[1], ex.liveLineCount());
    try {
      return this.#workSlice(hl, ex, end, performance.now() + 1, renderRange);
    } finally {
      if (
        generation === this.#deferGeneration &&
        this.#hl === hl &&
        !this.#paused &&
        this.pendingTokenization
      )
        this.#scheduleSlice(generation);
    }
  }

  /**
   * Schedule a background batch through MessageChannel to avoid delays
   * from nested timers. Use a timer if MessageChannel is unavailable.
   */
  #scheduleSlice(generation: number): void {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(() => this.#deferSlice(generation), 0);
      return;
    }
    if (this.#channel === undefined) {
      const created = new MessageChannel();
      created.port1.addEventListener('message', (event) => {
        const posted = (event as MessageEvent<unknown>).data;
        this.#postedSlices -= 1;
        try {
          if (typeof posted === 'number') this.#deferSlice(posted);
        } finally {
          if (this.#postedSlices === 0) refPort(created.port1, false);
        }
      });
      created.port1.start();
      this.#channel = created;
    }
    if (this.#postedSlices === 0) refPort(this.#channel.port1, true);
    this.#postedSlices += 1;
    this.#channel.port2.postMessage(generation);
  }

  #deferSlice(generation: number): void {
    if (
      generation !== this.#deferGeneration ||
      this.#hl == null ||
      this.#paused
    )
      return;
    const hl = this.#hl;
    try {
      this.#workSlice(
        hl,
        this.#ex,
        this.#ex.liveLineCount(),
        performance.now() + 1
      );
    } finally {
      if (
        generation === this.#deferGeneration &&
        this.#hl === hl &&
        !this.#paused &&
        this.pendingTokenization
      )
        this.#scheduleSlice(generation);
    }
  }

  #workSlice(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    endLine: number,
    deadline: number,
    renderRange?: readonly [number, number]
  ): Map<number, HighlightedToken[]> {
    const generation = this.#deferGeneration;
    const lines = new Map<number, HighlightedToken[]>();
    let deferred = new Map<number, HighlightedToken[]>();
    const { styles, fg } = this.#themes[0];
    while (
      generation === this.#deferGeneration &&
      performance.now() < deadline
    ) {
      let current = this.#materializing;
      if (current === undefined) {
        const line = ex.liveStats(10);
        if (ex.liveStats(9) === 0 || line >= endLine) break;
        ex.liveRun(1, endLine, deadline === Infinity ? 0 : 4096);
        hl.bindMemory();
        if (ex.liveStats(10) === line) continue;
        if (
          this.#onDeferTokenize === undefined &&
          (renderRange === undefined ||
            line < renderRange[0] ||
            line >= renderRange[1])
        )
          continue;
        current = { line, byte: 0, text: '', record: 0, start: 0, tokens: [] };
        this.#materializing = current;
        if (performance.now() >= deadline) break;
      }
      const { line } = current;
      if (line >= endLine) break;
      const byteLength = ex.liveLineByteLen(line);
      if (current.byte < byteLength) {
        const ptr = ex.liveLineTextPtr(line);
        let to = Math.min(byteLength, current.byte + 65536);
        while (to < byteLength && (hl.buffer[ptr + to] & 0xc0) === 0x80) to++;
        const bytes = hl.buffer.subarray(ptr + current.byte, ptr + to);
        try {
          current.text += fatalDecoder.decode(bytes);
        } catch {
          current.text += decodeWtf8(bytes, bytes.length);
        }
        current.byte = to;
        if (to < byteLength || performance.now() >= deadline) continue;
      }
      const max = this.#maxLineLength;
      const count =
        max > 0 && ex.liveLineLen(line) >= max ? 0 : ex.liveLineTokCount(line);
      const wide = (ex.liveLineFlags(line) & 4) !== 0;
      const data = new Uint32Array(
        hl.memory.buffer,
        count === 0 ? 0 : ex.liveLineTokPtr(line),
        wide ? count * 2 : count
      );
      const stop = Math.min(count, current.record + 256);
      for (; current.record < stop; current.record++) {
        const r = current.record;
        const end = wide ? data[r * 2] : data[r] & 0xffffff;
        const hli = wide ? data[r * 2 + 1] : data[r] >>> 24;
        if (end > current.start) {
          current.tokens.push([
            current.start,
            styles[hli]?.color ?? fg ?? '',
            current.text.slice(current.start, end),
          ]);
          current.start = end;
        }
      }
      if (current.record < count) continue;
      if (current.tokens.length === 0)
        current.tokens.push([
          0,
          current.text.length > 0 ? (fg ?? '') : '',
          current.text,
        ]);
      if (
        renderRange !== undefined &&
        line >= renderRange[0] &&
        line < renderRange[1]
      )
        lines.set(line, current.tokens);
      else deferred.set(line, current.tokens);
      this.#materializing = undefined;
      if (renderRange === undefined && deferred.size >= 16) {
        const ready = deferred;
        deferred = new Map();
        this.#onDeferTokenize?.(ready);
      }
    }
    if (deferred.size > 0) this.#onDeferTokenize?.(deferred);
    return lines;
  }

  /** Read the coalesced change list the native driver produced. */
  #readUpdate(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    previousLineCount: number,
    lines: Map<number, HighlightedToken[]>
  ): LiveTokenizerUpdate {
    const base = ex.liveChangesPtr();
    const count = hl.dv.getUint32(base, true);
    const lineChanges: LiveLineChange[] = [];
    for (let i = 0; i < count; i++) {
      const at = base + 4 + i * 16;
      lineChanges.push({
        oldStartLine: hl.dv.getUint32(at, true),
        oldEndLine: hl.dv.getUint32(at + 4, true),
        newStartLine: hl.dv.getUint32(at + 8, true),
        newEndLine: hl.dv.getUint32(at + 12, true),
      });
    }
    return {
      revision: this.#revision,
      previousLineCount,
      lineCount: ex.liveLineCount(),
      lineChanges,
      lines,
    };
  }

  #checkLine(line: number, ex: LiveWasmExports): void {
    if (!Number.isInteger(line) || line < 0 || line >= ex.liveLineCount()) {
      throw new RangeError(`line ${line} out of range`);
    }
  }

  /**
   * Validate all edit shapes, bounds, ordering, and overlaps before changing
   * the document. Return edits in ascending order. Remove replacements
   * whose bytes match the existing text.
   */
  #validate(
    edits: readonly TextEdit[],
    hl: HighlightsHighlighter,
    ex: LiveWasmExports
  ): NormalizedEdit[] {
    if (!Array.isArray(edits)) throw new TypeError('edits must be an array');
    const lineCount = ex.liveLineCount();
    const items: NormalizedEdit[] = [];
    for (const edit of edits as readonly TextEdit[]) {
      if (edit == null || typeof edit !== 'object' || edit.range == null) {
        throw new TypeError('each edit needs a range and newText');
      }
      const { start, end } = edit.range;
      const newText = edit.newText;
      if (typeof newText !== 'string') {
        throw new TypeError('newText must be a string');
      }
      for (const pos of [start, end]) {
        if (
          pos == null ||
          !Number.isInteger(pos.line) ||
          !Number.isInteger(pos.character) ||
          pos.line < 0 ||
          pos.character < 0
        ) {
          throw new TypeError('positions must be non-negative integers');
        }
        if (pos.line >= lineCount) {
          throw new RangeError(`line ${pos.line} out of range`);
        }
        if (pos.character > ex.liveLineLen(pos.line)) {
          throw new RangeError(
            `character ${pos.character} past the end of line ${pos.line}`
          );
        }
      }
      if (
        start.line > end.line ||
        (start.line === end.line && start.character > end.character)
      ) {
        throw new RangeError('range start is after its end');
      }
      items.push({
        sl: start.line,
        sc: start.character,
        el: end.line,
        ec: end.character,
        newText,
      });
    }
    items.sort((a, b) => {
      if (a.sl !== b.sl) return a.sl - b.sl;
      if (a.sc !== b.sc) return a.sc - b.sc;
      if (a.el !== b.el) return a.el - b.el;
      return a.ec - b.ec;
    });
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const cur = items[i];
      if (prev.el > cur.sl || (prev.el === cur.sl && prev.ec > cur.sc)) {
        throw new RangeError('edit ranges overlap');
      }
      // two inserts at one position have no defined order; reject them
      if (
        prev.sl === cur.sl &&
        prev.sc === cur.sc &&
        prev.el === cur.el &&
        prev.ec === cur.ec &&
        prev.sl === prev.el &&
        prev.sc === prev.ec
      ) {
        throw new RangeError('edit ranges overlap');
      }
    }
    // Edits sharing a line collapse into one splice, preserving untouched
    // text between them. Reuse decoded text for no-op checks and gaps.
    let lastLine = -1;
    let lastText = '';
    const readLine = (line: number) => {
      if (line !== lastLine) {
        lastText = this.#lineText(hl, ex, line);
        lastLine = line;
      }
      return lastText;
    };
    const merged: NormalizedEdit[] = [];
    for (const e of items) {
      if (this.#isNoopEdit(e, ex, readLine)) continue;
      const prev = merged[merged.length - 1];
      if (prev !== undefined && prev.el === e.sl) {
        prev.newText += readLine(e.sl).slice(prev.ec, e.sc) + e.newText;
        prev.el = e.el;
        prev.ec = e.ec;
      } else {
        merged.push(e);
      }
    }
    return merged;
  }

  /** True when the replacement text equals the range's current text. */
  #isNoopEdit(
    e: NormalizedEdit,
    ex: LiveWasmExports,
    readLine: (line: number) => string
  ): boolean {
    let rangeLen = e.ec - e.sc;
    for (let line = e.sl; line < e.el; line++) {
      rangeLen += ex.liveLineLen(line) + (ex.liveLineFlags(line) & 3);
      if (rangeLen > e.newText.length) return false;
    }
    if (rangeLen !== e.newText.length) return false;
    if (rangeLen === 0) return true;
    let offset = 0;
    for (let line = e.sl; line <= e.el; line++) {
      const lineText = readLine(line);
      const text = lineText.slice(
        line === e.sl ? e.sc : 0,
        line === e.el ? e.ec : lineText.length
      );
      if (!e.newText.startsWith(text, offset)) return false;
      offset += text.length;
      if (line < e.el) {
        const terminator = eol(ex.liveLineFlags(line));
        if (!e.newText.startsWith(terminator, offset)) return false;
        offset += terminator.length;
      }
    }
    return true;
  }

  /** Encode and copy the batch into a staged block, then splice natively. */
  #stageEdits(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    batch: NormalizedEdit[]
  ): void {
    const encoded = batch.map((e) => encodeLiveText(e.newText));
    let total = 4 + batch.length * 24;
    for (const bytes of encoded) total += bytes.length;
    const ptr = ex.liveStage(total);
    hl.bindMemory();
    let textOff = 4 + batch.length * 24;
    for (let i = 0; i < batch.length; i++) {
      const at = ptr + 4 + i * 24;
      const e = batch[i];
      hl.dv.setUint32(at, e.sl, true);
      hl.dv.setUint32(at + 4, e.sc, true);
      hl.dv.setUint32(at + 8, e.el, true);
      hl.dv.setUint32(at + 12, e.ec, true);
      hl.dv.setUint32(at + 16, textOff, true);
      hl.dv.setUint32(at + 20, encoded[i].length, true);
      hl.buffer.set(encoded[i], ptr + textOff);
      textOff += encoded[i].length;
    }
    hl.dv.setUint32(ptr, batch.length, true);
    ex.liveApplyEdits(ptr, (this.#materializing?.line ?? -1) + 1);
    this.#materializing = undefined;
    hl.bindMemory();
  }
}
