import {
  assertWasmModule,
  HighlightsHighlighter,
  langIdOf,
} from './highlighter';
import type { CodeToTokensOptions, ThemedToken } from './index';
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
 * One styled run within a line: the run's UTF-16 start column, its CSS color
 * (the theme foreground for unstyled runs, `''` when the theme defines none),
 * and its text. Colors come from the first resolved theme; use
 * `getLineTokens` when per-theme custom properties or font styles are needed.
 */
export type HighlightedToken = [char: number, fg: string, text: string];

/**
 * A half-open `[startLine, endLine)` window in post-edit line numbers. Lines
 * up to `endLine` are re-tokenized synchronously; the rest converges in
 * background slices reported through `onDeferTokenize`.
 */
export interface LiveUpdateOptions {
  readonly renderRange?: readonly [startLine: number, endLine: number];
}

/** Constructor options: tokenization options plus the initial document. */
export type LiveTokenizerOptions = CodeToTokensOptions & {
  /** The initial document; defaults to the empty document. */
  code?: string;
  /**
   * Receives finished tokens outside `renderRange`, once synchronously per
   * update and once per background slice when either produces lines. Line
   * numbers refer to the document at delivery time. With a constructor
   * `renderRange`, this can run before the instance is assigned to a variable.
   */
  onDeferTokenize?: (lines: Map<number, HighlightedToken[]>) => void;
  /**
   * Bounds synchronous tokenization of the initial document. Lines past it
   * converge through `onDeferTokenize`, whose first delivery may happen inside
   * the constructor.
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
   * Tokens for the lines re-tokenized inside `renderRange` during the
   * synchronous slice, keyed by post-edit line number. Empty when the update
   * was made without a `renderRange`; read changed lines through
   * `lineChanges` and `getLineTokens` instead.
   */
  readonly lines: Map<number, HighlightedToken[]>;
}

/**
 * A zero-copy view of one line's token records. `packed24` data holds one
 * `(tokenId << 24) | endUtf16` word per token; `wide32` holds
 * `[endUtf16, tokenId]` pairs for lines past the 24-bit end range. Starts are
 * implicit: each record starts at the previous record's end (0 for the
 * first). The view is valid until the next successful edit, reset, dispose,
 * or deferred re-tokenization slice; callers `.slice()` for ownership.
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
  liveApplyEdits(ptr: number): void;
  liveRun(budget: number): number;
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

/** A high or low surrogate without its partner (WTF-8 slow path trigger). */
const loneSurrogateRe =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Encode preserving lone surrogates as 3-byte WTF-8 sequences. */
function encodeWtf8(s: string): Uint8Array {
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
function decodeWtf8(bytes: Uint8Array): string {
  const units: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      units.push(b);
      i += 1;
    } else if (b < 0xe0) {
      units.push(((b & 31) << 6) | (bytes[i + 1] & 63));
      i += 2;
    } else if (b < 0xf0) {
      units.push(
        ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)
      );
      i += 3;
    } else {
      const cp =
        ((b & 7) << 18) |
        ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) |
        (bytes[i + 3] & 63);
      units.push(
        0xd800 + ((cp - 0x10000) >> 10),
        0xdc00 + ((cp - 0x10000) & 0x3ff)
      );
      i += 4;
    }
  }
  let s = '';
  for (let at = 0; at < units.length; at += 4096) {
    s += String.fromCharCode(...units.slice(at, at + 4096));
  }
  return s;
}

/** Encode text for the live document, falling back to WTF-8 when needed. */
function encodeLiveText(s: string): Uint8Array {
  return loneSurrogateRe.test(s) ? encodeWtf8(s) : enc.encode(s);
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
 * Ref or unref a MessagePort. Node and Bun keep the event loop alive while a
 * started port is ref'd; browser ports have neither method, so both calls
 * are optional.
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
 * An editable document and incremental tokenizer in an isolated Wasm
 * instance. Edits use UTF-16 positions and may split or join `\r\n`, `\n`,
 * or lone `\r` terminators; lexers see each line break as `\n`.
 * Re-tokenization starts at each changed region and stops when its outgoing
 * lexer state matches the previous state. A `renderRange` limits synchronous
 * work; background slices finish the document through `onDeferTokenize`.
 * Unreached lines retain their previous tokens; `flush` completes them.
 */
export class LiveTokenizer {
  #hl: HighlightsHighlighter | undefined;
  #ex: LiveWasmExports;
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
  #deferBudget = 64;
  #paused = false;
  // Set while applyEdits or reset runs, including the synchronous
  // onDeferTokenize delivery inside it: a mutating call from that callback
  // would replace the change list the outer update is about to report.
  #updating = false;

  constructor(options: LiveTokenizerOptions) {
    this.#langId = langIdOf(options.lang);
    this.#themes = resolveOptionThemes(options);
    this.#cssVariablePrefix = options.cssVariablePrefix ?? '--hls-';
    this.#maxLineLength = options.tokenizeMaxLineLength ?? 0;
    this.#onDeferTokenize = options.onDeferTokenize;
    const renderRange = checkRenderRange(options.renderRange);
    [this.#hl, this.#ex] = LiveTokenizer.#createStaged(
      options.code ?? '',
      this.#langId
    );
    this.#runSlice(this.#hl, this.#ex, renderRange);
  }

  /** Instantiate an isolated Wasm instance and stage `code` into its line
   *  table; the caller drives tokenization. */
  static #createStaged(
    code: string,
    langId: number
  ): [HighlightsHighlighter, LiveWasmExports] {
    const hl = new HighlightsHighlighter(assertWasmModule());
    const ex = hl.instance.exports as unknown as LiveWasmExports;
    const bytes = encodeLiveText(code);
    const ptr = ex.liveStage(bytes.length);
    hl.bindMemory();
    hl.buffer.set(bytes, ptr);
    ex.liveInitDoc(ptr, bytes.length, langId);
    hl.bindMemory();
    return [hl, ex];
  }

  /** Return the active instance or throw after disposal. */
  #live(): HighlightsHighlighter {
    const hl = this.#hl;
    if (hl == null) throw new Error('tokenizer is disposed');
    return hl;
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

  /** True while deferred re-tokenization beyond a `renderRange` is pending. */
  get pendingTokenization(): boolean {
    this.#live();
    return this.#ex.liveStats(9) !== 0;
  }

  /**
   * Finish pending deferred re-tokenization synchronously, delivering the
   * finished lines through `onDeferTokenize`. Clears a `pause`.
   */
  flush(): void {
    const hl = this.#live();
    this.#paused = false;
    this.#settle(hl, this.#ex);
  }

  /**
   * Suspend background re-tokenization without discarding the pending work:
   * no slices run and nothing is delivered while paused, and reads of
   * unreached lines keep returning pre-edit tokens. `resume` reschedules the
   * remainder; `flush`, `applyEdits`, and `reset` implicitly resume (a
   * mutating call starts background work for its own deferred tail).
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
    if (this.#ex.liveStats(9) !== 0) {
      this.#scheduleSlice(this.#deferGeneration);
    }
  }

  /** Release the Wasm instance and drop deferred work; later calls throw. */
  dispose(): void {
    if (this.#hl == null) return;
    this.#deferGeneration += 1;
    this.#hl = undefined;
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
      return decodeWtf8(bytes);
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
   * Themed tokens for one line plus line-relative string/comment/regex
   * ranges for bracket matching. Offsets are line-relative. Lines at or
   * above `tokenizeMaxLineLength` collapse to one unthemed token while the
   * raw records stay precise. While deferred re-tokenization is pending, a
   * line it has not reached yet returns pre-edit tokens; a line with no
   * records yet (freshly spliced in) returns its text as one unthemed token.
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
   * Validate and apply a batch against the current document. Without
   * `renderRange`, tokenization completes synchronously and `lines` is empty.
   * With it, finished in-range lines are returned; finished off-range lines
   * reach `onDeferTokenize` before return, followed by background deliveries.
   * Pending work is remapped through the edits without waiting for completion.
   * Calling `applyEdits` or `reset` from this update's synchronous callback
   * throws; reads, `pause`, and `flush` are allowed.
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
    const ex = this.#ex;
    this.#checkNotUpdating();
    const renderRange = checkRenderRange(options?.renderRange);
    if (typeof code !== 'string') throw new TypeError('code must be a string');
    // pending tokens describe the outgoing document; drop them, don't settle
    this.#deferGeneration += 1;
    this.#paused = false;
    const previousLineCount = ex.liveLineCount();
    [this.#hl, this.#ex] = LiveTokenizer.#createStaged(code, this.#langId);
    this.#revision += 1;
    this.#updating = true;
    let lines: Map<number, HighlightedToken[]>;
    try {
      lines = this.#runSlice(this.#hl, this.#ex, renderRange);
    } finally {
      this.#updating = false;
    }
    const lineCount = this.#ex.liveLineCount();
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

  /**
   * Run the synchronous part of an update: to convergence without a
   * `renderRange`, otherwise until the driver's cursor passes its end.
   * Returns the in-range token map, flushes finished off-range lines through
   * `onDeferTokenize`, and schedules background slices for the remainder.
   */
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
    const from = ex.liveStats(10);
    const [rangeStart, rangeEnd] = renderRange;
    // a range past the end of the document shows nothing; defer everything
    const end =
      rangeStart >= ex.liveLineCount()
        ? from
        : Math.min(rangeEnd, ex.liveLineCount());
    while (ex.liveStats(9) !== 0) {
      const cursor = ex.liveStats(10);
      if (cursor >= end) break;
      ex.liveRun(end - cursor);
    }
    hl.bindMemory();
    const to = ex.liveStats(10);
    const lines = this.#collectLines(
      hl,
      ex,
      Math.max(from, rangeStart),
      Math.min(to, end)
    );
    if (this.#onDeferTokenize !== undefined) {
      // an edit above the range re-tokenizes lines before it, and a budget
      // overshoot can pass its end; both are final now, so flush them
      const off = this.#collectLines(hl, ex, from, Math.min(to, rangeStart));
      this.#collectLines(hl, ex, Math.max(from, end), to, off);
      if (off.size > 0) this.#onDeferTokenize(off);
    }
    // an onDeferTokenize callback above may have paused the tokenizer; a
    // paused instance schedules nothing until resume
    if (ex.liveStats(9) !== 0 && !this.#paused) {
      this.#scheduleSlice(this.#deferGeneration);
    }
    return lines;
  }

  /**
   * Queue a background slice through MessageChannel to avoid nested timer
   * clamping while yielding between slices. Fall back to a timer in runtimes
   * without MessageChannel.
   */
  #scheduleSlice(generation: number): void {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(() => this.#deferSlice(generation), 0);
      return;
    }
    if (this.#channel === undefined) {
      const created = new MessageChannel();
      created.port1.onmessage = (event) => {
        const posted: unknown = event.data;
        this.#postedSlices -= 1;
        try {
          if (typeof posted === 'number') this.#deferSlice(posted);
        } finally {
          if (this.#postedSlices === 0) refPort(created.port1, false);
        }
      };
      this.#channel = created;
    }
    if (this.#postedSlices === 0) refPort(this.#channel.port1, true);
    this.#postedSlices += 1;
    this.#channel.port2.postMessage(generation);
  }

  /**
   * One budgeted background slice; delivers its lines and reschedules itself
   * until the document converges or the generation is invalidated.
   */
  #deferSlice(generation: number): void {
    if (generation !== this.#deferGeneration || this.#hl == null) return;
    const hl = this.#hl;
    const ex = this.#ex;
    if (ex.liveStats(9) === 0) return;
    const from = ex.liveStats(10);
    const t0 = performance.now();
    const more = ex.liveRun(this.#deferBudget);
    hl.bindMemory();
    // aim for roughly millisecond slices with an adaptive line budget
    const dt = performance.now() - t0;
    if (dt < 0.5 && this.#deferBudget < 1 << 20) this.#deferBudget <<= 1;
    else if (dt > 2 && this.#deferBudget > 16) this.#deferBudget >>= 1;
    if (more !== 0) this.#scheduleSlice(generation);
    this.#deliverDeferred(hl, ex, from, ex.liveStats(10));
  }

  /**
   * Cancel scheduled slices and run pending deferred work to completion,
   * delivering the finished lines through `onDeferTokenize`.
   */
  #settle(hl: HighlightsHighlighter, ex: LiveWasmExports): void {
    this.#deferGeneration += 1;
    if (ex.liveStats(9) === 0) return;
    const from = ex.liveStats(10);
    ex.liveRun(0x7fffffff);
    hl.bindMemory();
    this.#deliverDeferred(hl, ex, from, ex.liveStats(10));
  }

  #deliverDeferred(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    from: number,
    to: number
  ): void {
    const onDeferTokenize = this.#onDeferTokenize;
    if (onDeferTokenize === undefined) return;
    const lines = this.#collectLines(hl, ex, from, to);
    if (lines.size > 0) onDeferTokenize(lines);
  }

  /**
   * Collect finished lines in `[from, to)` directly from the change list.
   * The active entry ends at the driver's cursor; later entries are pending.
   */
  #collectLines(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    from: number,
    to: number,
    lines = new Map<number, HighlightedToken[]>()
  ): Map<number, HighlightedToken[]> {
    if (from >= to) return lines;
    const base = ex.liveChangesPtr();
    const count = hl.dv.getUint32(base, true);
    const active = ex.liveStats(9) !== 0;
    const current = ex.liveStats(11);
    const cursor = ex.liveStats(10);
    const limit = active ? Math.min(count, current + 1) : count;
    for (let i = 0; i < limit; i++) {
      const at = base + 4 + i * 16;
      const start = hl.dv.getUint32(at + 8, true);
      if (start >= to) break;
      const end =
        active && i === current ? cursor : hl.dv.getUint32(at + 12, true);
      const stop = Math.min(end, to);
      for (let line = Math.max(start, from); line < stop; line++) {
        lines.set(line, this.#lineTuples(hl, ex, line));
      }
    }
    return lines;
  }

  /**
   * One line's tokens as editor-shaped `[start, color, text]` tuples. Runs
   * without a syntax color inherit the theme foreground. Missing records and
   * lines past `tokenizeMaxLineLength` use one tuple in the theme foreground,
   * the same color `getLineTokens` gives such a line.
   */
  #lineTuples(
    hl: HighlightsHighlighter,
    ex: LiveWasmExports,
    line: number
  ): HighlightedToken[] {
    const text = this.#lineText(hl, ex, line);
    const max = this.#maxLineLength;
    const tokens: HighlightedToken[] = [];
    const { styles, fg } = this.#themes[0];
    if (max <= 0 || text.length < max) {
      const n = ex.liveLineTokCount(line);
      const wide = (ex.liveLineFlags(line) & 4) !== 0;
      const data = new Uint32Array(
        hl.memory.buffer,
        n === 0 ? 0 : ex.liveLineTokPtr(line),
        wide ? n * 2 : n
      );
      let start = 0;
      for (let r = 0; r < n; r++) {
        const end = wide ? data[r * 2] : data[r] & 0xffffff;
        const hli = wide ? data[r * 2 + 1] : data[r] >>> 24;
        if (end > start) {
          tokens.push([
            start,
            styles[hli]?.color ?? fg ?? '',
            text.slice(start, end),
          ]);
          start = end;
        }
      }
    }
    if (tokens.length === 0) {
      tokens.push([0, text.length > 0 ? (fg ?? '') : '', text]);
    }
    return tokens;
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
   * Validate the whole batch against the pre-call revision before any
   * mutation: shapes, bounds, ordering, and overlap. Returns the surviving
   * edits sorted ascending with no-ops (byte-identical replacements)
   * removed.
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
    // Exactly-touching edits collapse into one range so each boundary is
    // spliced exactly once: a CRLF merge at a shared boundary must not
    // restructure a line another edit's pre-batch coordinates still name.
    const merged: NormalizedEdit[] = [];
    for (const e of items) {
      if (this.#isNoopEdit(e, hl, ex)) continue;
      const prev = merged[merged.length - 1];
      if (prev !== undefined && prev.el === e.sl && prev.ec === e.sc) {
        prev.el = e.el;
        prev.ec = e.ec;
        prev.newText += e.newText;
      } else {
        merged.push(e);
      }
    }
    return merged;
  }

  /** True when the replacement text equals the range's current text. */
  #isNoopEdit(
    e: NormalizedEdit,
    hl: HighlightsHighlighter,
    ex: LiveWasmExports
  ): boolean {
    let rangeLen = e.ec - e.sc;
    for (let line = e.sl; line < e.el; line++) {
      rangeLen += ex.liveLineLen(line) + (ex.liveLineFlags(line) & 3);
      if (rangeLen > e.newText.length) return false;
    }
    if (rangeLen !== e.newText.length) return false;
    if (rangeLen === 0) return true;
    let text = '';
    for (let line = e.sl; line <= e.el; line++) {
      const lineText = this.#lineText(hl, ex, line);
      text += lineText.slice(
        line === e.sl ? e.sc : 0,
        line === e.el ? e.ec : lineText.length
      );
      if (line < e.el) {
        text += eol(ex.liveLineFlags(line));
      }
    }
    return text === e.newText;
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
    ex.liveApplyEdits(ptr);
    hl.bindMemory();
  }
}
