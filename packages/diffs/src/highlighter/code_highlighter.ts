import type { Root } from 'hast';
import type { CodeToTokensOptions, GrammarState } from 'shiki/core';

import type {
  CodeToHastOptions,
  DiffsHighlighter,
  DiffsThemeNames,
  HighlightedToken,
  HighlighterTypes,
  SupportedLanguages,
  ThemedToken,
  ThemeRegistrationResolved,
} from '../types';

/** Languages and themes a render pass needs the highlighter to have ready. */
export interface CodeHighlighterOptions {
  langs: SupportedLanguages[];
  themes: DiffsThemeNames[];
  preferredHighlighter?: HighlighterTypes;
}

/**
 * Streaming tokenizer contract used by `FileStream`: push code chunks, get
 * back completed lines of themed tokens (`end` flushes the rest).
 */
export interface CodeStreamTokenizer {
  pushCode(code: string): ThemedToken[][];
  end(): ThemedToken[][];
}

/** A zero-based UTF-16 position; `character` may equal the line length. */
export interface CodeTextPosition {
  readonly line: number;
  readonly character: number;
}

/** One replacement of an end-exclusive range in the pre-edit document. */
export interface CodeTextEdit {
  readonly range: {
    readonly start: CodeTextPosition;
    readonly end: CodeTextPosition;
  };
  readonly newText: string;
}

/** One coalesced half-open span of changed or re-tokenized lines. */
export interface CodeLiveLineChange {
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  readonly newStartLine: number;
  readonly newEndLine: number;
}

/**
 * A half-open `[startLine, endLine)` window in post-edit line numbers. Lines
 * up to `endLine` are re-tokenized synchronously; the rest converges in
 * background slices reported through `onDeferTokenize`.
 */
export interface CodeLiveUpdateOptions {
  readonly renderRange?: readonly [startLine: number, endLine: number];
}

/** The result of one live-tokenizer edit batch or reset. */
export interface CodeLiveTokenizerUpdate {
  /** Monotonic revision; bumps once per successful mutating batch. */
  readonly revision: number;
  readonly previousLineCount: number;
  readonly lineCount: number;
  readonly lineChanges: readonly CodeLiveLineChange[];
  /**
   * Tokens for the lines re-tokenized inside `renderRange` during the
   * synchronous slice, keyed by post-edit line number.
   */
  readonly lines: Map<number, HighlightedToken[]>;
}

/**
 * Incremental document tokenizer contract used by edit mode: the tokenizer
 * holds the document, `applyEdits` applies UTF-16 range replacements and
 * returns the re-tokenized lines inside the visible range, and lines
 * re-tokenized outside it flow through `onDeferTokenize` (synchronously for
 * already-finished lines, then in background slices until convergence).
 */
export interface CodeLiveTokenizer {
  /** Monotonic revision; bumps once per successful mutating batch. */
  readonly revision: number;
  readonly lineCount: number;
  /** True while deferred re-tokenization beyond a `renderRange` is pending. */
  readonly pendingTokenization: boolean;
  applyEdits(
    edits: readonly CodeTextEdit[],
    options?: CodeLiveUpdateOptions
  ): CodeLiveTokenizerUpdate;
  /** Replace the whole document. */
  reset(code: string, options?: CodeLiveUpdateOptions): CodeLiveTokenizerUpdate;
  /**
   * One line's current tokens as editor-shaped `[char, fg, text]` tuples plus
   * the line-relative string/comment/regex ranges bracket matching must
   * ignore. While deferred re-tokenization is pending, a line it has not
   * reached yet returns pre-edit tokens.
   */
  getLineTokens(line: number): {
    tokens: HighlightedToken[];
    bracketIgnoredRanges: [start: number, end: number][];
  };
  /** Finish pending deferred re-tokenization synchronously. */
  flush(): void;
  /**
   * Suspend background re-tokenization without discarding pending work; a
   * later `resume`, `flush`, or mutating call restarts it.
   */
  pause?(): void;
  /** Resume background re-tokenization suspended by `pause`. */
  resume?(): void;
  /** Release the tokenizer and drop pending deferred work. */
  dispose(): void;
}

/** Options for creating a `CodeLiveTokenizer` for one document. */
export interface CodeLiveTokenizerOptions {
  lang: SupportedLanguages;
  theme: DiffsThemeNames;
  /** The initial document; defaults to the empty document. */
  code?: string;
  tokenizeMaxLineLength?: number;
  /**
   * Receives tokens for lines re-tokenized outside the active `renderRange`,
   * keyed by post-edit line number at delivery time.
   */
  onDeferTokenize?: (lines: Map<number, HighlightedToken[]>) => void;
  /** Bounds synchronous tokenization of the initial document. */
  renderRange?: readonly [startLine: number, endLine: number];
}

/**
 * A pluggable syntax highlighter for `@pierre/diffs`.
 *
 * The library renders with the built-in shiki implementation by default.
 * `setHighlighter` swaps the implementation for subsequently created
 * renderers, e.g. the experimental `@pierre/diffs/chamele`.
 */
export interface CodeHighlighter {
  /** Implementation name, e.g. `'shiki'` or `'chamele'`. */
  readonly name: string;
  /**
   * Load everything the given languages/themes need.
   */
  load(options: CodeHighlighterOptions): Promise<void> | void;
  /** Whether the given languages/themes can highlight synchronously right now. */
  isReady(options: CodeHighlighterOptions): boolean;
  /** Resolved theme metadata (`type`, `colors`, fg/bg) for pre styling. */
  getTheme(name: DiffsThemeNames): ThemeRegistrationResolved;
  /**
   * Tokenize code into shiki-shaped themed tokens per line. Shiki carries
   * `grammarState`; other implementations may ignore it.
   */
  codeToTokens(
    code: string,
    options: CodeToTokensOptions<string, string>
  ): { tokens: ThemedToken[][]; grammarState?: GrammarState };
  /** Highlight code as a shiki-shaped hast tree (transformers included). */
  codeToHast(code: string, options: CodeToHastOptions<DiffsThemeNames>): Root;
  /** Streaming tokenizer for `FileStream`; each instance owns its own state. */
  StreamTokenizer: new (
    options: CodeToTokensOptions<string, string>
  ) => CodeStreamTokenizer;
  /**
   * Incremental document tokenizer for edit mode. Implementations without
   * one (shiki, whose edit-mode tokenization runs through the editor's own
   * TextMate incremental-state machinery) leave this undefined.
   */
  createLiveTokenizer?(options: CodeLiveTokenizerOptions): CodeLiveTokenizer;
  /**
   * The loaded shiki instance backing this highlighter, when there is one.
   * Internals use it to keep the exact pre-existing shiki code paths (worker
   * rendering, TextMate edit mode, grammar-state streaming) byte-identical.
   */
  getShikiInstance?(): DiffsHighlighter | undefined;
}

/**
 * The render-facing slice of a highlighter: what the render functions
 * (`renderFileWithHighlighter`, `renderDiffWithHighlighter`) actually call.
 * Both a loaded shiki instance and a `CodeHighlighter` satisfy it.
 */
export type RenderHighlighter = Pick<
  CodeHighlighter,
  'codeToHast' | 'codeToTokens' | 'getTheme'
>;

let registeredHighlighter: CodeHighlighter | undefined;

// Identity of the built-in shiki adapter. The pre-existing shiki code paths
// (worker pool, TextMate edit mode, raw instances in renderers) must only
// engage for that exact adapter — a custom highlighter that happens to
// implement `getShikiInstance` still owns its `load`/`isReady`/render
// pipeline.
const builtinShikiAdapters = new WeakSet<CodeHighlighter>();

/**
 * Mark a highlighter as the built-in shiki adapter. Called once when the
 * adapter is created.
 * @internal
 */
export function markBuiltinShikiHighlighter(
  highlighter: CodeHighlighter
): void {
  builtinShikiAdapters.add(highlighter);
}

/** Whether this highlighter is the built-in shiki adapter. */
export function isBuiltinShikiHighlighter(
  highlighter: CodeHighlighter
): boolean {
  return builtinShikiAdapters.has(highlighter);
}

/**
 * Register the highlighter the library renders with from now on. Renderers,
 * editors, streams, and SSR passes capture the registration when they are
 * created; existing instances keep the implementation they captured. The
 * registry starts on the built-in shiki implementation — restore it by
 * passing `shikiHighlighter`.
 */
export function setHighlighter(highlighter: CodeHighlighter): void {
  registeredHighlighter = highlighter;
}

/**
 * The highlighter registered with `setHighlighter`, or `undefined` while the
 * library is on its built-in shiki default. Internal — consumers read the
 * active implementation through `getCodeHighlighter`.
 * @internal
 */
export function getRegisteredHighlighter(): CodeHighlighter | undefined {
  return registeredHighlighter;
}
