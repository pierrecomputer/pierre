import { colorUtils } from '@pierre/theming/color';
import {
  EncodedTokenMetadata,
  type IGrammar,
  INITIAL,
  type StateStack,
} from 'shiki/textmate';

import { DEFAULT_THEMES } from '../constants';
import type {
  CodeHighlighter,
  CodeLiveTokenizer,
  CodeLiveTokenizerUpdate,
} from '../highlighter/code_highlighter';
import type { RenderersHighlighter } from '../highlighter/resolve_highlighter';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  HighlightedToken,
  RenderRange,
  SupportedLanguages,
} from '../types';
import type { TextDocument, TextDocumentChange } from './textDocument';
import { addEventListener, debounce, h } from './utils';

const TOKENIZE_TIME_LIMIT = 500;
let nextTokenizerId = 0;

export interface EditorTokenizerProps {
  highlighter: DiffsHighlighter;
  textDocument: TextDocument<unknown>;
  codeOptions: BaseCodeOptions;
  matchBrackets?: boolean;
  setStyle: (style: string) => void;
  onDeferTokenize: (
    lines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light'
  ) => void;
  // Fired after the active theme (light/dark mode or theme name) changes and the
  // new theme CSS has been applied. Lets the editor recompute overlay pieces
  // that captured a resolved theme color, e.g. rounded selection corner masks.
  onThemeChange?: () => void;
  __debug?: boolean;
}

interface LiveEditorTokenizerProps extends Omit<
  EditorTokenizerProps,
  'highlighter'
> {
  highlighter: CodeHighlighter;
}

/**
 * The tokenizer surface the editor drives. `ShikiEditorTokenizer` implements
 * it over shiki's TextMate grammars with incremental grammar states;
 * `LiveEditorTokenizer` implements it over a `CodeHighlighter`'s incremental
 * live tokenizer. `createEditorTokenizer` picks one.
 */
export interface DiffsEditorTokenizer {
  readonly themeType: 'light' | 'dark';
  /**
   * Sorted, non-overlapping `[start, end)` column ranges of line `lineIndex`
   * that bracket matching must ignore (strings, comments, regexes); `null`
   * when the line has none or cannot be tokenized.
   */
  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null;
  /** Re-apply the surface's current theme, re-tokenizing on change. */
  syncTheme(codeOptions: BaseCodeOptions): void;
  cleanUp(): void;
  /** Tokenize after a document change; returns the lines needing repaint. */
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows?: boolean
  ): Map<number, Array<HighlightedToken>>;
  /** Warm whatever per-line state the viewport needs (may be a no-op). */
  prebuildStateStack(renderRange?: RenderRange): void;
  stopBackgroundTokenize(): void;
  pauseBackgroundTokenize(): void;
  resumeBackgroundTokenize(): void;
}

// Editor-chrome CSS (`--diffs-editor-*`: selection, active line, search and
// bracket matches, cursor, diagnostics) derived from a theme's VS Code color
// keys. Custom highlighters with another theme format (chamele's Zed themes)
// map their colors onto these keys in `getTheme`.
function buildEditorThemeCSS(colors: Record<string, string>): string {
  const selectionBackground = colors['editor.selectionBackground'];
  const themeLineHighlightBackground = colors['editor.lineHighlightBackground'];
  const lineHighlightBackground =
    themeLineHighlightBackground != null &&
    themeLineHighlightBackground.trim() !== '' &&
    !colorUtils.isFullyTransparent(themeLineHighlightBackground)
      ? themeLineHighlightBackground
      : undefined;
  // A usable theme background opts into the semantic active-line mix.
  // Missing backgrounds retain the resolved row color and rely on a border.
  const lineHighlightBorder =
    colors['editor.lineHighlightBorder'] ??
    (lineHighlightBackground == null
      ? 'color-mix(in lab, var(--diffs-bg) 70%, var(--diffs-fg))'
      : 'transparent');
  const activeLineSourceMix = lineHighlightBackground == null ? '100%' : '85%';
  return `:host {
      --diffs-editor-selection-bg: ${selectionBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-border: ${lineHighlightBorder};
      --diffs-editor-active-line-source-mix: ${activeLineSourceMix};
      --diffs-editor-match-bg: ${colors['editor.findMatchBackground'] ?? 'initial'};
      --diffs-editor-match-highlight-bg: ${colors['editor.findMatchHighlightBackground'] ?? 'initial'};
      --diffs-editor-bracket-match-bg: ${colors['editorBracketMatch.background'] ?? 'initial'};
      --diffs-editor-bracket-match-border: ${colors['editorBracketMatch.border'] ?? 'initial'};
      --diffs-editor-cursor-fg: ${colors['editorCursor.foreground'] ?? 'initial'};
      --diffs-editor-hint-fg: ${colors['editorHint.foreground'] ?? 'initial'};
      --diffs-editor-info-fg: ${colors['editorInfo.foreground'] ?? 'initial'};
      --diffs-editor-warning-fg: ${colors['editorWarning.foreground'] ?? 'initial'};
      --diffs-editor-error-fg: ${colors['editorError.foreground'] ?? 'initial'};
    }`;
}

/**
 * Shared plumbing for both editor tokenizers: the active theme (name and
 * light/dark type), the document/OS color-scheme observers dual-theme
 * surfaces follow, and applying the editor-chrome CSS on theme changes.
 * Subclasses activate the theme in their highlighter (`activateTheme`) and
 * drop their tokenization caches when it changes (`resetForThemeChange`).
 */
abstract class BaseEditorTokenizer implements DiffsEditorTokenizer {
  protected readonly textDocument: TextDocument<unknown>;
  protected readonly tokenizeMaxLineLength: number;
  protected readonly setStyle: EditorTokenizerProps['setStyle'];
  protected readonly onDeferTokenize: EditorTokenizerProps['onDeferTokenize'];
  protected readonly matchBrackets: boolean;
  protected isCleanedUp = false;

  readonly #onThemeChange: EditorTokenizerProps['onThemeChange'];
  readonly #mediaQueryList: MediaQueryList;
  readonly #initialThemeName: string;
  readonly #initialThemeType: 'light' | 'dark' | undefined;
  // The resolved name of the theme currently applied to the editor (e.g.
  // `github-light`). Tracked so `syncTheme` can detect a host-driven theme swap
  // even when the light/dark mode itself is unchanged.
  #themeName = '';
  #themeType: 'light' | 'dark' = 'dark';
  #disposes?: (() => void)[];

  constructor({
    codeOptions,
    textDocument,
    matchBrackets,
    setStyle,
    onDeferTokenize,
    onThemeChange,
  }: Omit<EditorTokenizerProps, 'highlighter'>) {
    const { themeType: themeTypeOption = 'system', theme = DEFAULT_THEMES } =
      codeOptions;
    this.textDocument = textDocument;
    this.tokenizeMaxLineLength = codeOptions.tokenizeMaxLineLength ?? 1000;
    this.setStyle = setStyle;
    this.onDeferTokenize = onDeferTokenize;
    this.#onThemeChange = onThemeChange;
    this.matchBrackets = matchBrackets !== false;
    this.#mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    // Prefer the host document's computed color-scheme (page CSS/classes can
    // force light/dark while the OS media query differs) over matchMedia.
    const themeType =
      themeTypeOption === 'system'
        ? this.resolveSystemThemeType()
        : themeTypeOption;
    // Only track the document/system color scheme when the surface follows it
    // (`themeType: 'system'`). A surface pinned to an explicit 'dark'/'light'
    // theme keeps that theme regardless of the page, so re-tokenizing after an
    // edit must emit the same `--diffs-token-{theme}` variable the SSR markup
    // used; otherwise the edited tokens fall back to the default foreground.
    if (typeof theme !== 'string' && themeTypeOption === 'system') {
      const observer = new MutationObserver((mutations) => {
        for (const { type, attributeName } of mutations) {
          if (
            type === 'attributes' &&
            attributeName !== null &&
            (attributeName === 'class' || attributeName.startsWith('data-'))
          ) {
            const themeType = this.resolveSystemThemeType();
            this.#emitThemeChange(theme[themeType], themeType);
            break;
          }
        }
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });
      this.#disposes = [
        addEventListener(this.#mediaQueryList, 'change', () => {
          // Re-read computed color-scheme so a host-forced scheme still wins
          // when the OS preference changes underneath it.
          const themeType = this.resolveSystemThemeType();
          this.#emitThemeChange(theme[themeType], themeType);
        }),
        () => observer.disconnect(),
      ];
    }
    this.#initialThemeName =
      typeof theme === 'string' ? theme : theme[themeType];
    this.#initialThemeType = typeof theme === 'string' ? undefined : themeType;
  }

  get themeType(): 'light' | 'dark' {
    return this.#themeType;
  }

  protected get themeName(): string {
    return this.#themeName;
  }

  /**
   * Apply the theme resolved during construction. Subclasses call this at the
   * end of their constructor — `activateTheme` touches subclass state, which
   * only exists after the base constructor has returned.
   */
  protected applyInitialTheme(): void {
    this.applyTheme(this.#initialThemeName, this.#initialThemeType);
  }

  // Activate the theme and record it as current. Without an explicit type
  // (a pinned single theme) the theme's own classification is authoritative.
  protected applyTheme(themeName: string, themeType?: 'light' | 'dark'): void {
    this.activateTheme(themeName);
    this.#themeName = themeName;
    this.#themeType = themeType ?? this.resolveThemeType(themeName);
  }

  // Re-apply the editor's theme from the surface's current code options. Edit
  // mode reuses a single tokenizer across re-renders, so when the host swaps the
  // theme — a theme picker, a light/dark toggle, etc. — we must recompute the
  // active theme and re-tokenize. Without this the editor keeps rendering the
  // theme it captured when it first attached (stale line-highlight background
  // and token colors). System-driven changes are still handled by the
  // observers wired up in the constructor; this covers explicit `themeType`/
  // `theme` option changes that those observers don't see.
  syncTheme(codeOptions: BaseCodeOptions): void {
    const { themeType = 'system', theme = DEFAULT_THEMES } = codeOptions;
    // A single pinned theme does not follow the themeType option or system
    // scheme flips; its own classification stays authoritative.
    if (typeof theme === 'string') {
      this.#emitThemeChange(theme, this.resolveThemeType(theme));
      return;
    }
    const nextThemeType =
      themeType === 'system' ? this.resolveSystemThemeType() : themeType;
    this.#emitThemeChange(theme[nextThemeType], nextThemeType);
  }

  // By default, diffs components support dual themes, but the tokenizer only
  // renders the preferred theme. When the theme changes, the tokenizer
  // re-tokenizes the document.
  #emitThemeChange(themeName: string, themeType: 'light' | 'dark'): void {
    if (themeName === this.#themeName && themeType === this.#themeType) {
      return;
    }
    this.applyTheme(themeName, themeType);
    this.stopBackgroundTokenize();
    this.resetForThemeChange();
    // The theme CSS is now applied, so overlay pieces that captured a resolved
    // theme color (e.g. rounded selection corner masks) can recompute against
    // the new colors instead of keeping the old light/dark value.
    this.#onThemeChange?.();
  }

  // Respect an explicit host color-scheme override. When the computed value
  // advertises support for both schemes, let the OS preference choose one.
  protected resolveSystemThemeType(): 'light' | 'dark' {
    try {
      if (
        typeof document !== 'undefined' &&
        typeof getComputedStyle === 'function' &&
        document.body != null
      ) {
        const colorSchemes = getComputedStyle(document.body).colorScheme.split(
          /\s+/
        );
        const supportsDark = colorSchemes.includes('dark');
        const supportsLight = colorSchemes.includes('light');
        // A single host-forced scheme wins. `light dark` only declares support
        // for both schemes, so the media query still selects the active one.
        if (supportsDark !== supportsLight) {
          return supportsDark ? 'dark' : 'light';
        }
      }
    } catch {
      // jsdom and similar harnesses may lack getComputedStyle or throw; fall
      // through to the OS media query.
    }
    return this.#mediaQueryList.matches ? 'dark' : 'light';
  }

  cleanUp(): void {
    this.isCleanedUp = true;
    this.stopBackgroundTokenize();
    this.#disposes?.forEach((dispose) => dispose());
    this.#disposes = undefined;
  }

  /** Activate `themeName` in the highlighter and emit its editor-chrome CSS. */
  protected abstract activateTheme(themeName: string): void;
  /** Drop cached tokenization state and repaint after a theme change. */
  protected abstract resetForThemeChange(): void;
  /** The theme's own light/dark classification, for pinned single themes. */
  protected abstract resolveThemeType(themeName: string): 'light' | 'dark';

  abstract getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null;
  abstract tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows?: boolean
  ): Map<number, Array<HighlightedToken>>;
  abstract prebuildStateStack(renderRange?: RenderRange): void;
  abstract stopBackgroundTokenize(): void;
  abstract pauseBackgroundTokenize(): void;
  abstract resumeBackgroundTokenize(): void;
}

/** Stoppable code tokenizer for the editor, over shiki's TextMate grammars. */
export class ShikiEditorTokenizer extends BaseEditorTokenizer {
  #highlighter: DiffsHighlighter;
  #grammar: IGrammar | undefined;
  #colorMap: string[] = [];
  #debug: boolean;

  // state
  #stateStack: StateStack[] = [INITIAL]; // cached state stack by line index
  #comparisonStateStack: StateStack[] = [];
  #comparisonStateStackStart = 0;
  #comparisonLineChanges: NonNullable<
    TextDocumentChange['changedLineChanges']
  > = [];
  #lastLine: number = -1;
  #isStopped: boolean = true;
  #isPaused: boolean = false;
  #backgroundJobId: number = 0;
  #tokenizerId = ++nextTokenizerId;
  #backgroundPrebuildEndLine = -1;
  #pendingPrebuildEndLine = -1;
  #backgroundChangedLineRanges: readonly [number, number][] | undefined;
  #backgroundChangedRangeIndex: number = 0;
  #bracketIgnoredRanges: ([number, number][] | null | undefined)[] = [];
  #isMessageListenerAttached: boolean = false;

  #prebuildStateStack = debounce(async (renderRange?: RenderRange) => {
    // Drop work scheduled before cleanUp; a late timer must not call setTheme
    // on a highlighter that tests (or hosts) have already disposed.
    if (this.isCleanedUp) {
      return;
    }
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const endLine = Math.min(
      totalLines === Infinity ? Infinity : startingLine + totalLines,
      this.textDocument.lineCount
    );
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.textDocument.languageId)
    ) {
      await this.#highlighter.loadLanguage(this.textDocument.languageId);
      if (this.isCleanedUp) {
        return;
      }
      this.#grammar = this.#highlighter.getLanguage(
        this.textDocument.languageId
      );
    }
    this.#ensureActiveTheme();
    this.#scheduleStatePrebuild(endLine);
  }, 500);

  #onMessage = ({ data }: MessageEvent<unknown>) => {
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const { type, tokenizerId, jobId } = data as {
      type?: unknown;
      tokenizerId?: unknown;
      jobId?: unknown;
    };
    if (
      type === 'tokenize' &&
      tokenizerId === this.#tokenizerId &&
      typeof jobId === 'number' &&
      jobId === this.#backgroundJobId
    ) {
      if (this.#backgroundPrebuildEndLine >= 0) {
        this.#backgroundPrebuild(jobId);
      } else {
        this.#backgroundTokenize(jobId);
      }
    }
  };

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    if (
      !this.matchBrackets ||
      lineIndex < 0 ||
      lineIndex >= this.textDocument.lineCount
    ) {
      return null;
    }
    this.#ensureGrammar();
    if (this.#grammar === undefined) {
      return null;
    }
    if (this.#bracketIgnoredRanges[lineIndex] === undefined) {
      this.#buildStateStack(lineIndex);
      const state = this.#stateStack[lineIndex] ?? INITIAL;
      const result = this.#tokenizeLineAt(lineIndex, state);
      this.#stateStack[lineIndex + 1] = result.state;
    }
    return this.#bracketIgnoredRanges[lineIndex] ?? null;
  }

  constructor(props: EditorTokenizerProps) {
    super(props);
    this.#highlighter = props.highlighter;
    this.#debug = props.__debug ?? false;
    this.#ensureGrammar();
    this.applyInitialTheme();
  }

  // Activate the theme on the shiki instance (its colorMap feeds token
  // resolution) and emit the editor-chrome CSS from its VS Code color keys.
  protected activateTheme(themeName: string): void {
    const { colorMap } = this.#highlighter.setTheme(themeName);
    const { colors = {} } = this.#highlighter.getTheme(themeName);
    this.setStyle(buildEditorThemeCSS(colors));
    this.#colorMap = colorMap;
  }

  protected resolveThemeType(themeName: string): 'light' | 'dark' {
    return this.#highlighter.getTheme(themeName).type;
  }

  protected resetForThemeChange(): void {
    this.#stateStack = [INITIAL];
    this.#comparisonStateStack = [];
    this.#comparisonStateStackStart = 0;
    this.#comparisonLineChanges = [];
    if (this.#grammar !== undefined && this.textDocument.lineCount > 0) {
      this.#scheduleBackgroundTokenize(0);
    }
  }

  // The shared highlighter is also used for dual-theme SSR (`themes: {dark,light}`),
  // which leaves its active theme on whichever pass finished last (usually light).
  // The tokenizer caches a single-theme colorMap from construction; if we tokenize
  // without re-activating that theme, grammar color indices are looked up in the
  // wrong map — property names resolve to a near-foreground gray while types and
  // comments (stable across maps) still look correct. Re-apply before every
  // tokenize path so a first edit after load matches a later file-switch re-attach.
  #ensureActiveTheme(): void {
    if (this.themeName === '') {
      return;
    }
    const { colorMap } = this.#highlighter.setTheme(this.themeName);
    this.#colorMap = colorMap;
  }

  override cleanUp(): void {
    super.cleanUp();
    this.#detachMessageListener();
  }

  // to use `tokenize`, call `prebuildStateStackMap` first to prebuild
  // the state stack map for the given render range.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
  ): Map<number, Array<HighlightedToken>> {
    this.#ensureGrammar();
    this.#ensureActiveTheme();
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.textDocument.languageId)
    ) {
      throw new Error(
        `Grammar for language "${this.textDocument.languageId}" not loaded`
      );
    }

    const { lineCount } = this.textDocument;
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const renderRangeEndLine =
      totalLines === Infinity
        ? lineCount
        : Math.min(startingLine + totalLines, lineCount);

    const dirtyStart = change.startLine;
    const viewStart = Math.max(startingLine, dirtyStart);
    const crossesRenderRangeEnd =
      renderRange !== undefined &&
      totalLines !== Infinity &&
      change.lineDelta > 0 &&
      dirtyStart < renderRangeEndLine &&
      change.endLine >= renderRangeEndLine;
    const canReuseCachedStates =
      change.lineDelta === 0 &&
      (change.changedLineChanges?.every(([, , lineDelta]) => lineDelta === 0) ??
        true);
    if (this.matchBrackets && !canReuseCachedStates) {
      // Structural edits shift cache indexes, so only the untouched prefix is
      // safe. Same-line edits overwrite every range they re-tokenize and can
      // retain the untouched suffix once grammar state reconverges.
      this.#bracketIgnoredRanges.length = Math.min(
        this.#bracketIgnoredRanges.length,
        change.startLine
      );
    }
    const canReuseShiftedStates =
      hostRealignsRows && change.lineDelta !== 0 && dirtyStart >= startingLine;
    const canCacheTokenizedStates =
      canReuseCachedStates ||
      renderRange === undefined ||
      dirtyStart >= viewStart;
    const changedLineRanges: readonly [number, number][] =
      change.changedLineRanges ?? [[dirtyStart, change.endLine]];
    this.#comparisonStateStack = [];
    this.#comparisonStateStackStart = 0;
    this.#comparisonLineChanges = [];
    let offscreenSyncEnd = -1;
    if (dirtyStart < viewStart) {
      for (const [rangeStart, rangeEnd] of changedLineRanges) {
        if (rangeStart < viewStart) {
          offscreenSyncEnd = Math.max(
            offscreenSyncEnd,
            Math.min(rangeEnd, viewStart - 1)
          );
        }
      }
    }
    const shouldFlushOffscreenLines =
      offscreenSyncEnd >= dirtyStart &&
      (canReuseCachedStates || change.lineDelta < 0);
    if (canReuseCachedStates) {
      this.#buildStateStack(dirtyStart);
    } else {
      this.#shiftComparisonStateStack(change);
      if (renderRange === undefined || dirtyStart >= viewStart) {
        this.#buildStateStack(viewStart);
      }
    }

    let changedRangeIndex = 0;
    let currentChangedRangeEnd = changedLineRanges[changedRangeIndex][1];
    let backgroundStartLine: number | undefined;
    let backgroundChangedRangeIndex = 0;
    let line = canReuseCachedStates
      ? changedLineRanges[changedRangeIndex][0]
      : viewStart;
    let settled = false;
    const dirtyLines: Map<number, Array<HighlightedToken>> = new Map();
    const offscreenDirtyLines:
      | Map<number, Array<HighlightedToken>>
      | undefined = shouldFlushOffscreenLines ? new Map() : undefined;
    if (offscreenDirtyLines !== undefined && !canReuseCachedStates) {
      const offscreenEnd = Math.min(
        offscreenSyncEnd + 1,
        viewStart,
        renderRangeEndLine
      );
      if (offscreenEnd > dirtyStart) {
        this.#buildStateStack(offscreenEnd);
        let offscreenLine = dirtyStart;
        let offscreenState = this.#stateStack[offscreenLine] ?? INITIAL;
        for (; offscreenLine < offscreenEnd; offscreenLine++) {
          const resolved = this.#tokenizeLineAt(offscreenLine, offscreenState);
          offscreenState = resolved.state;
          offscreenDirtyLines.set(offscreenLine, resolved.resolvedTokens);
        }
        this.#stateStack[offscreenEnd] = offscreenState;
      }
    }
    // Seed the loop's grammar state after the offscreen flush, not before it.
    // When a delete's removed lines reach the viewport's first line, the flush
    // rebuilds the cached state up to `line`; reading it earlier would capture
    // the truncated INITIAL state and color the viewport as if outside an open
    // construct (block comment, template literal) it is actually inside.
    let state = this.#stateStack[line] ?? INITIAL;
    for (; line < renderRangeEndLine; ) {
      const previousNextState = canReuseCachedStates
        ? this.#stateStack[line + 1]
        : canReuseShiftedStates
          ? this.#getPreviousEndState(line + 1)
          : undefined;
      if (canCacheTokenizedStates) {
        this.#stateStack[line] = state;
      }

      const { resolvedTokens, state: nextState } = this.#tokenizeLineAt(
        line,
        state
      );
      state = nextState;

      if (line >= viewStart) {
        dirtyLines.set(line, resolvedTokens);
      } else {
        offscreenDirtyLines?.set(line, resolvedTokens);
      }

      if (canCacheTokenizedStates) {
        this.#stateStack[line + 1] = state;
      }
      settled =
        line >= currentChangedRangeEnd &&
        (canReuseCachedStates || canReuseShiftedStates) &&
        previousNextState !== undefined &&
        state.equals(previousNextState);
      if (settled) {
        changedRangeIndex++;
        const nextRange = changedLineRanges[changedRangeIndex];
        if (nextRange === undefined) {
          break;
        }
        if (nextRange[0] >= renderRangeEndLine) {
          backgroundStartLine = nextRange[0];
          backgroundChangedRangeIndex = changedRangeIndex;
          break;
        }
        let nextState: StateStack | undefined = this.#stateStack[nextRange[0]];
        if (canReuseShiftedStates) {
          for (
            let stateLine = line + 2;
            stateLine <= nextRange[0];
            stateLine++
          ) {
            nextState = this.#getPreviousEndState(stateLine);
            if (nextState === undefined) {
              break;
            }
            this.#stateStack[stateLine] = nextState;
          }
        }
        if (nextState === undefined) {
          currentChangedRangeEnd = nextRange[1];
          line++;
        } else {
          line = nextRange[0];
          state = nextState;
          currentChangedRangeEnd = nextRange[1];
        }
        settled = false;
        continue;
      }
      line++;
    }

    if (canCacheTokenizedStates) {
      if (line < renderRangeEndLine) {
        this.#stateStack[line + 1] = state;
      } else {
        this.#stateStack[line] = state;
      }
    }

    if (settled && canReuseShiftedStates && backgroundStartLine === undefined) {
      for (let stateLine = line + 2; stateLine <= lineCount; stateLine++) {
        const previousState = this.#getPreviousEndState(stateLine);
        if (previousState === undefined) {
          break;
        }
        this.#stateStack[stateLine] = previousState;
      }
      this.#comparisonStateStack = [];
      this.#comparisonStateStackStart = 0;
      this.#comparisonLineChanges = [];
    }

    if (offscreenDirtyLines !== undefined && offscreenDirtyLines.size > 0) {
      this.onDeferTokenize(offscreenDirtyLines, this.themeType);
    }

    if (backgroundStartLine !== undefined) {
      if (this.matchBrackets && canReuseCachedStates) {
        this.#bracketIgnoredRanges.length = Math.min(
          this.#bracketIgnoredRanges.length,
          backgroundStartLine
        );
      }
      this.#scheduleBackgroundTokenize(
        backgroundStartLine,
        changedLineRanges,
        backgroundChangedRangeIndex
      );
    } else if (!settled && line < lineCount) {
      const backgroundLine =
        crossesRenderRangeEnd && dirtyStart >= viewStart
          ? renderRangeEndLine
          : dirtyStart < viewStart && !canReuseCachedStates
            ? dirtyStart
            : line;
      if (this.matchBrackets && canReuseCachedStates) {
        this.#bracketIgnoredRanges.length = Math.min(
          this.#bracketIgnoredRanges.length,
          backgroundLine
        );
      }
      this.#scheduleBackgroundTokenize(
        backgroundLine,
        changedLineRanges,
        changedRangeIndex
      );
    }

    return dirtyLines;
  }

  prebuildStateStack(renderRange?: RenderRange): void {
    this.#ensureGrammar();
    this.#prebuildStateStack(renderRange);
  }

  stopBackgroundTokenize(): void {
    this.#pendingPrebuildEndLine = -1;
    if (this.#isStopped) {
      return;
    }
    this.#isStopped = true;
    this.#isPaused = false;
    this.#lastLine = -1;
    this.#backgroundPrebuildEndLine = -1;
    this.#backgroundChangedLineRanges = undefined;
    this.#backgroundChangedRangeIndex = 0;
    this.#comparisonStateStack = [];
    this.#comparisonStateStackStart = 0;
    this.#comparisonLineChanges = [];
    this.#detachMessageListener();
  }

  pauseBackgroundTokenize(): void {
    if (this.#isStopped || this.#isPaused) {
      return;
    }
    if (this.#debug) {
      console.log('[diffs/editor] background tokenization paused', {
        jobId: this.#backgroundJobId,
      });
    }
    this.#isPaused = true;
  }

  resumeBackgroundTokenize(): void {
    if (
      this.#isStopped ||
      !this.#isPaused ||
      this.#grammar === undefined ||
      this.#lastLine < 0
    ) {
      return;
    }
    if (this.#debug) {
      console.log('[diffs/editor] background tokenization resumed', {
        jobId: this.#backgroundJobId,
      });
    }
    this.#isPaused = false;
    this.#postTokenizeMessage(this.#backgroundJobId);
  }

  #ensureGrammar(): void {
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.textDocument.languageId) &&
      this.#highlighter
        .getLoadedLanguages()
        .includes(this.textDocument.languageId)
    ) {
      this.#grammar = this.#highlighter.getLanguage(
        this.textDocument.languageId
      );
    }
  }

  #attachMessageListener(): void {
    if (this.#isMessageListenerAttached) {
      return;
    }
    globalThis.addEventListener('message', this.#onMessage);
    this.#isMessageListenerAttached = true;
  }

  #detachMessageListener(): void {
    if (!this.#isMessageListenerAttached) {
      return;
    }
    globalThis.removeEventListener('message', this.#onMessage);
    this.#isMessageListenerAttached = false;
  }

  #postTokenizeMessage(jobId: number): void {
    // use `postMessage` instead of `setTimeout(fn, 0)` to avoid 4ms delay
    globalThis.postMessage({
      type: 'tokenize',
      tokenizerId: this.#tokenizerId,
      jobId,
    });
  }

  #scheduleBackgroundTokenize(
    startLine: number,
    changedLineRanges?: readonly [number, number][],
    changedRangeIndex = 0
  ): void {
    if (isGrammarlessLanguage(this.textDocument.languageId)) {
      return;
    }

    const jobId = ++this.#backgroundJobId;

    if (this.#debug) {
      console.log('[diffs/editor] background tokenization scheduled', {
        jobId,
        startLine,
        changedLineRanges,
        changedRangeIndex,
      });
    }

    this.#isStopped = false;
    this.#isPaused = false;
    this.#lastLine = startLine;
    if (this.#backgroundPrebuildEndLine >= 0) {
      this.#pendingPrebuildEndLine = Math.max(
        this.#pendingPrebuildEndLine,
        this.#backgroundPrebuildEndLine
      );
    }
    this.#backgroundPrebuildEndLine = -1;
    this.#backgroundChangedLineRanges = changedLineRanges;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    this.#attachMessageListener();
    this.#postTokenizeMessage(jobId);
  }

  #scheduleStatePrebuild(endLine: number): void {
    if (this.#grammar === undefined || this.#stateStack.length > endLine) {
      return;
    }
    // Extend an active prebuild, or retain the target until the foreground
    // edit job reconverges and releases the state cache.
    if (!this.#isStopped) {
      if (this.#backgroundPrebuildEndLine >= 0) {
        this.#backgroundPrebuildEndLine = Math.max(
          this.#backgroundPrebuildEndLine,
          endLine
        );
      } else {
        this.#pendingPrebuildEndLine = Math.max(
          this.#pendingPrebuildEndLine,
          endLine
        );
      }
      return;
    }

    const jobId = ++this.#backgroundJobId;
    this.#isStopped = false;
    this.#isPaused = false;
    this.#lastLine = this.#stateStack.length - 1;
    this.#backgroundPrebuildEndLine = endLine;
    this.#pendingPrebuildEndLine = -1;
    this.#backgroundChangedLineRanges = undefined;
    this.#backgroundChangedRangeIndex = 0;
    this.#attachMessageListener();
    this.#postTokenizeMessage(jobId);
  }

  #tokenizeLineAt(
    line: number,
    state: StateStack
  ): { resolvedTokens: Array<HighlightedToken>; state: StateStack } {
    const lineText = this.textDocument.getLineText(line);
    if (lineText.length > this.tokenizeMaxLineLength) {
      console.warn(
        `[diffs] Line(${line}) too long to tokenize: ${lineText.length}`
      );
      this.#cacheBracketIgnoredRanges(line, null);
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    if (
      this.#grammar === undefined ||
      lineText === '' ||
      lineText.trim() === ''
    ) {
      this.#cacheBracketIgnoredRanges(line, null);
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    const result = tokenizeLine(
      this.#grammar,
      this.#colorMap,
      lineText,
      state,
      TOKENIZE_TIME_LIMIT,
      this.matchBrackets
    );
    this.#cacheBracketIgnoredRanges(line, result.bracketIgnoredRanges);
    return {
      resolvedTokens: result.resolvedTokens,
      state: result.ruleStack,
    };
  }

  #cacheBracketIgnoredRanges(
    line: number,
    ranges: [number, number][] | null
  ): void {
    if (this.matchBrackets) {
      this.#bracketIgnoredRanges[line] = ranges;
    }
  }

  // Preserve old end states as comparison-only sentinels, copying whichever
  // side of the edit is smaller. Index shifts are resolved lazily on lookup.
  #shiftComparisonStateStack(change: TextDocumentChange): void {
    const lineChanges =
      change.changedLineChanges ??
      ([[change.startLine, change.endLine, change.lineDelta]] as const);
    const comparisonStart = change.startLine + 1;
    const comparisonLength = this.#stateStack.length - comparisonStart;
    if (comparisonStart <= comparisonLength) {
      this.#comparisonStateStack = this.#stateStack;
      this.#comparisonStateStackStart = 0;
      this.#stateStack = this.#stateStack.slice(0, comparisonStart);
    } else {
      this.#comparisonStateStackStart = comparisonStart;
      this.#comparisonStateStack = this.#stateStack.slice(comparisonStart);
      this.#stateStack.length = Math.min(
        this.#stateStack.length,
        comparisonStart
      );
    }
    this.#comparisonLineChanges = lineChanges;
  }

  #getPreviousEndState(line: number): StateStack | undefined {
    let previousLine = line;
    for (
      let index = this.#comparisonLineChanges.length - 1;
      index >= 0;
      index--
    ) {
      const [startLine, endLine, lineDelta] =
        this.#comparisonLineChanges[index];
      if (lineDelta === 0) {
        continue;
      }
      if (previousLine > endLine) {
        previousLine -= lineDelta;
      } else if (previousLine > startLine) {
        return this.#stateStack[line];
      }
    }
    return (
      this.#comparisonStateStack[
        previousLine - this.#comparisonStateStackStart
      ] ?? this.#stateStack[line]
    );
  }

  #buildStateStack(endAt: number, timeBudget?: number): boolean {
    const boundedEndAt = Math.min(
      Math.max(0, endAt),
      this.textDocument.lineCount
    );
    if (this.#stateStack.length > boundedEndAt || this.#grammar === undefined) {
      return true;
    }
    const startedAt = timeBudget === undefined ? 0 : performance.now();
    let line = this.#stateStack.length - 1;
    let state = this.#stateStack[line] ?? INITIAL;
    while (line < boundedEndAt) {
      this.#stateStack[line] = state;
      const lineText = this.textDocument.getLineText(line);
      if (
        lineText.length <= this.tokenizeMaxLineLength &&
        lineText !== '' &&
        lineText.trim() !== ''
      ) {
        const result = tokenizeLine(
          this.#grammar,
          this.#colorMap,
          lineText,
          state,
          TOKENIZE_TIME_LIMIT,
          this.matchBrackets,
          false
        );
        this.#cacheBracketIgnoredRanges(line, result.bracketIgnoredRanges);
        state = result.ruleStack;
      } else {
        this.#cacheBracketIgnoredRanges(line, null);
      }
      line++;
      this.#stateStack[line] = state;
      if (
        timeBudget !== undefined &&
        performance.now() - startedAt > timeBudget
      ) {
        break;
      }
    }
    return line >= boundedEndAt;
  }

  #backgroundPrebuild(jobId: number): void {
    if (
      this.#isStopped ||
      this.#isPaused ||
      this.#grammar === undefined ||
      jobId !== this.#backgroundJobId
    ) {
      return;
    }

    this.#ensureActiveTheme();
    // State prebuilds intentionally omit rendered tokens and yield between
    // short chunks so a deep viewport does not monopolize the main thread.
    const complete = this.#buildStateStack(this.#backgroundPrebuildEndLine, 1);
    if (this.#isStopped || this.#isPaused || jobId !== this.#backgroundJobId) {
      return;
    }
    if (complete) {
      this.stopBackgroundTokenize();
      return;
    }
    this.#lastLine = this.#stateStack.length - 1;
    this.#postTokenizeMessage(jobId);
  }

  #backgroundTokenize(jobId: number) {
    if (
      this.#isStopped ||
      this.#isPaused ||
      this.#grammar === undefined ||
      jobId !== this.#backgroundJobId
    ) {
      return;
    }

    this.#ensureActiveTheme();

    const t = performance.now();
    const lines = new Map<number, Array<HighlightedToken>>();
    const totalLines = this.textDocument.lineCount;
    const changedLineRanges = this.#backgroundChangedLineRanges;

    let line = this.#lastLine;
    let state = this.#stateStack[line] ?? INITIAL;
    let settled = false;
    let changedRangeIndex = this.#backgroundChangedRangeIndex;
    let currentChangedRangeEnd = changedLineRanges?.[changedRangeIndex]?.[1];
    for (; line < totalLines; ) {
      this.#stateStack[line] = state;

      const previousNextState =
        currentChangedRangeEnd !== undefined
          ? this.#getPreviousEndState(line + 1)
          : undefined;
      const lineText = this.textDocument.getLineText(line);
      if (lineText.length > this.tokenizeMaxLineLength) {
        console.warn(
          `[diffs] Line(${line}) too long to tokenize: ${lineText.length}`
        );
        lines.set(line, [[0, '', lineText]]);
        this.#cacheBracketIgnoredRanges(line, null);
      } else if (lineText === '' || lineText.trim() === '') {
        lines.set(line, [[0, '', lineText]]);
        this.#cacheBracketIgnoredRanges(line, null);
      } else {
        const ret = tokenizeLine(
          this.#grammar,
          this.#colorMap,
          lineText,
          state,
          TOKENIZE_TIME_LIMIT,
          this.matchBrackets
        );
        lines.set(line, ret.resolvedTokens);
        this.#cacheBracketIgnoredRanges(line, ret.bracketIgnoredRanges);
        state = ret.ruleStack;
      }

      this.#stateStack[line + 1] = state;
      settled =
        currentChangedRangeEnd !== undefined &&
        line >= currentChangedRangeEnd &&
        previousNextState !== undefined &&
        state.equals(previousNextState);
      line++;
      if (settled) {
        changedRangeIndex++;
        const nextRange = changedLineRanges?.[changedRangeIndex];
        if (nextRange === undefined) {
          break;
        }
        currentChangedRangeEnd = nextRange[1];
        if (this.#stateStack[nextRange[0]] === undefined) {
          settled = false;
        } else {
          line = nextRange[0];
          state = this.#stateStack[line] ?? state;
          settled = false;
          continue;
        }
      }

      // limit the time of partial tokenize to 1ms
      if (performance.now() - t > 1) {
        break;
      }
    }

    this.onDeferTokenize(lines, this.themeType);
    if (this.#isStopped || this.#isPaused || jobId !== this.#backgroundJobId) {
      return;
    }

    if (settled || line >= totalLines) {
      const pendingPrebuildEndLine = this.#pendingPrebuildEndLine;
      this.stopBackgroundTokenize();
      if (pendingPrebuildEndLine >= 0) {
        this.#scheduleStatePrebuild(pendingPrebuildEndLine);
      }
      return;
    }

    this.#lastLine = line;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    this.#postTokenizeMessage(jobId);
  }
}

/**
 * Editor tokenizer over a `CodeHighlighter`'s incremental live tokenizer
 * (chamele). The live tokenizer holds its own copy of the document in wasm:
 * every edit batch forwards through `applyEdits`, which re-tokenizes from the
 * first changed line until the lexer state reconverges. Lines inside the
 * viewport come back synchronously as the dirty set; off-viewport lines flow
 * through the live tokenizer's deferred slices into the host's render cache
 * via `onDeferTokenize`.
 */
export class LiveEditorTokenizer extends BaseEditorTokenizer {
  #highlighter: CodeHighlighter;
  #live: CodeLiveTokenizer | undefined;
  #liveLang: string | undefined;
  #syncedRevision = 0;
  #settleLines: Map<number, Array<HighlightedToken>> | undefined;
  #mutating = false;
  #stopped = false;
  #paused = false;
  #pausedLines: Map<number, Array<HighlightedToken>> | undefined;
  #ignoredRanges: ([number, number][] | null | undefined)[] = [];

  constructor(props: LiveEditorTokenizerProps) {
    super(props);
    this.#highlighter = props.highlighter;
    this.applyInitialTheme();
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    if (
      !this.matchBrackets ||
      lineIndex < 0 ||
      lineIndex >= this.textDocument.lineCount
    ) {
      return null;
    }
    if (this.#ignoredRanges[lineIndex] === undefined) {
      this.#lineTokensAt(lineIndex);
    }
    return this.#ignoredRanges[lineIndex] ?? null;
  }

  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
  ): Map<number, Array<HighlightedToken>> {
    this.#stopped = false;
    const { lineCount } = this.textDocument;
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const rangeStart = Math.min(startingLine, lineCount);
    const rangeEnd =
      totalLines === Infinity
        ? lineCount
        : Math.min(startingLine + totalLines, lineCount);

    if (this.#live == null || this.#liveLang !== this.textDocument.languageId) {
      // (Re)built from the already-edited document: the whole viewport is the
      // dirty set and nothing needs deferring — the fresh wasm document was
      // tokenized to convergence on creation.
      this.#ensureLive();
      const dirtyLines = new Map<number, Array<HighlightedToken>>();
      for (let line = rangeStart; line < rangeEnd; line++) {
        dirtyLines.set(line, this.#lineTokensAt(line));
      }
      return dirtyLines;
    }

    const update = this.#applyChange(this.#live, change, [
      rangeStart,
      rangeEnd,
    ]);
    this.#remapIgnoredRanges(update);
    if (this.#pausedLines !== undefined) {
      this.#pausedLines = remapThroughLineChanges(this.#pausedLines, update);
    }
    const settled = this.#settleLines;
    this.#settleLines = undefined;
    if (settled !== undefined && settled.size > 0) {
      // Convergence work from the previous batch that completed during this
      // call's settle: still-valid lines shift to their new numbers and
      // refresh the host cache like any deferred delivery.
      const remapped = remapThroughLineChanges(settled, update);
      for (const line of remapped.keys()) {
        this.#ignoredRanges[line] = undefined;
      }
      if (remapped.size > 0) {
        this.#deliver(remapped);
      }
    }
    const dirtyLines = update.lines;
    for (const line of dirtyLines.keys()) {
      this.#ignoredRanges[line] = undefined;
    }
    // Without host row realignment a structural edit shifts every row below
    // it under unmoved DOM, so the remainder of the viewport must repaint
    // even where tokens did not change.
    const structural =
      change.lineDelta !== 0 ||
      (change.changedLineChanges?.some(([, , delta]) => delta !== 0) ?? false);
    if (structural && !hostRealignsRows) {
      const repaintStart = Math.max(rangeStart, change.startLine);
      for (let line = repaintStart; line < rangeEnd; line++) {
        if (!dirtyLines.has(line)) {
          dirtyLines.set(line, this.#lineTokensAt(line));
        }
      }
    }
    return dirtyLines;
  }

  prebuildStateStack(): void {
    // No grammar states to prebuild; make sure the wasm document is loaded so
    // the first edit tokenizes incrementally from a warm buffer.
    this.#stopped = false;
    this.#ensureLive();
  }

  stopBackgroundTokenize(): void {
    this.#stopped = true;
    this.#paused = false;
    this.#pausedLines = undefined;
  }

  pauseBackgroundTokenize(): void {
    this.#paused = true;
  }

  resumeBackgroundTokenize(): void {
    this.#paused = false;
    const lines = this.#pausedLines;
    this.#pausedLines = undefined;
    if (lines !== undefined && lines.size > 0 && !this.#stopped) {
      this.onDeferTokenize(lines, this.themeType);
    }
  }

  // The chamele adapter maps its Zed theme's editor colors onto the VS Code
  // color keys of `getTheme(...).colors`, so the shared CSS block applies to
  // custom highlighters too.
  protected activateTheme(themeName: string): void {
    this.setStyle(
      buildEditorThemeCSS(this.#highlighter.getTheme(themeName).colors ?? {})
    );
  }

  protected resolveThemeType(themeName: string): 'light' | 'dark' {
    return this.#highlighter.getTheme(themeName).type;
  }

  protected resetForThemeChange(): void {
    // New theme, new colors: rebuild the live tokenizer against the current
    // theme and repaint every line through its deferred slices (an empty
    // initial render range defers the whole document).
    this.#disposeLive();
    if (this.textDocument.lineCount > 0) {
      this.#stopped = false;
      this.#ensureLive([0, 0]);
    }
  }

  override cleanUp(): void {
    super.cleanUp();
    this.#disposeLive();
  }

  /**
   * The live tokenizer for the current document and theme, creating it from
   * the document's full text when missing. Without an `initialRenderRange`
   * the whole document tokenizes synchronously and nothing is delivered;
   * with one, off-range lines flow through the deferred pipeline.
   */
  #ensureLive(
    initialRenderRange?: readonly [number, number]
  ): CodeLiveTokenizer | undefined {
    const { textDocument } = this;
    if (this.#live != null && this.#liveLang === textDocument.languageId) {
      return this.#live;
    }
    this.#disposeLive();
    const factory = this.#highlighter.createLiveTokenizer;
    if (factory == null) {
      return undefined;
    }
    const live = factory.call(this.#highlighter, {
      lang: textDocument.languageId as SupportedLanguages,
      theme: this.themeName,
      code: textDocument.getText(),
      tokenizeMaxLineLength: this.tokenizeMaxLineLength,
      onDeferTokenize: this.#onLiveDefer,
      renderRange: initialRenderRange,
    });
    this.#live = live;
    this.#liveLang = textDocument.languageId;
    this.#syncedRevision = live.revision;
    this.#ignoredRanges = [];
    return live;
  }

  #disposeLive(): void {
    this.#live?.dispose();
    this.#live = undefined;
    this.#liveLang = undefined;
    this.#settleLines = undefined;
    this.#ignoredRanges = [];
  }

  /**
   * Forward one edit batch to the live tokenizer, which splits lines at
   * `\r\n`, `\n`, and lone `\r` exactly like the piece table. Should an
   * edit still fall outside the live tokenizer's model — a validation
   * rejection, or a line count diverging from the document's — the
   * incremental path is abandoned for a full reset from the document text.
   */
  #applyChange(
    live: CodeLiveTokenizer,
    change: TextDocumentChange,
    renderRange: readonly [number, number]
  ): CodeLiveTokenizerUpdate {
    let update: CodeLiveTokenizerUpdate | undefined;
    if (change.changes.length > 0) {
      const edits = change.changes.map((edit) => ({
        range: edit.range,
        newText: edit.text,
      }));
      this.#mutating = true;
      try {
        update = live.applyEdits(edits, { renderRange });
      } catch {
        update = undefined;
      } finally {
        this.#mutating = false;
      }
      if (update !== undefined && update.lineCount !== change.lineCount) {
        update = undefined;
      }
    }
    if (update === undefined) {
      // The buffered settle lines describe a document state being replaced.
      this.#settleLines = undefined;
      this.#mutating = true;
      try {
        update = live.reset(this.textDocument.getText(), { renderRange });
      } finally {
        this.#mutating = false;
      }
    }
    this.#syncedRevision = update.revision;
    return update;
  }

  #lineTokensAt(line: number): Array<HighlightedToken> {
    const live = this.#ensureLive();
    if (live == null || line >= live.lineCount) {
      return [[0, '', this.textDocument.getLineText(line)]];
    }
    const { tokens, bracketIgnoredRanges } = live.getLineTokens(line);
    this.#ignoredRanges[line] =
      this.matchBrackets && bracketIgnoredRanges.length > 0
        ? bracketIgnoredRanges
        : null;
    return tokens;
  }

  #onLiveDefer = (lines: Map<number, Array<HighlightedToken>>): void => {
    if (this.isCleanedUp || this.#stopped) {
      return;
    }
    if (this.#mutating) {
      if (this.#settleLines === undefined) {
        this.#settleLines = lines;
      } else {
        for (const [line, tokens] of lines) {
          this.#settleLines.set(line, tokens);
        }
      }
      return;
    }
    if (this.#live == null || this.#live.revision !== this.#syncedRevision) {
      return;
    }
    for (const line of lines.keys()) {
      this.#ignoredRanges[line] = undefined;
    }
    this.#deliver(lines);
  };

  #deliver(lines: Map<number, Array<HighlightedToken>>): void {
    if (this.#paused) {
      if (this.#pausedLines === undefined) {
        this.#pausedLines = new Map(lines);
      } else {
        for (const [line, tokens] of lines) {
          this.#pausedLines.set(line, tokens);
        }
      }
      return;
    }
    this.onDeferTokenize(lines, this.themeType);
  }

  // Shift the bracket-ignore cache to the update's post-edit line numbers;
  // entries inside replaced ranges reset and refill lazily.
  #remapIgnoredRanges(update: CodeLiveTokenizerUpdate): void {
    if (update.lineChanges.length === 0) {
      return;
    }
    const previous = this.#ignoredRanges;
    const next: ([number, number][] | null | undefined)[] = new Array(
      update.lineCount
    );
    let oldPos = 0;
    let newPos = 0;
    for (const change of update.lineChanges) {
      // the unchanged span between changes keeps its length, so it copies
      // over with one shared offset
      for (let i = 0; oldPos + i < change.oldStartLine; i++) {
        next[newPos + i] = previous[oldPos + i];
      }
      oldPos = change.oldEndLine;
      newPos = change.newEndLine;
    }
    for (
      let i = 0;
      oldPos + i < previous.length && newPos + i < next.length;
      i++
    ) {
      next[newPos + i] = previous[oldPos + i];
    }
    this.#ignoredRanges = next;
  }
}

/**
 * Create the editor tokenizer matching the given highlighter: the TextMate
 * implementation for shiki (raw instance or the built-in shiki
 * `CodeHighlighter`), a `LiveEditorTokenizer` for custom highlighters that
 * provide `createLiveTokenizer`, and plain-text tokenization otherwise.
 */
export function createEditorTokenizer(
  props: Omit<EditorTokenizerProps, 'highlighter'> & {
    highlighter: RenderersHighlighter;
  }
): DiffsEditorTokenizer {
  const { highlighter } = props;
  if (isCodeHighlighter(highlighter)) {
    // An explicit live tokenizer wins over a shiki pass-through, so a custom
    // highlighter that also exposes a shiki instance keeps its own edit mode.
    if (highlighter.createLiveTokenizer != null) {
      return new LiveEditorTokenizer({ ...props, highlighter });
    }
    if (highlighter.getShikiInstance != null) {
      const shiki = highlighter.getShikiInstance();
      if (shiki == null) {
        throw new Error(
          'createEditorTokenizer: the shiki highlighter is not loaded yet'
        );
      }
      return new ShikiEditorTokenizer({ ...props, highlighter: shiki });
    }
    return new LiveEditorTokenizer({ ...props, highlighter });
  }
  return new ShikiEditorTokenizer({ ...props, highlighter });
}

function isCodeHighlighter(
  highlighter: RenderersHighlighter
): highlighter is CodeHighlighter {
  return (
    typeof (highlighter as CodeHighlighter).isReady === 'function' &&
    typeof (highlighter as CodeHighlighter).load === 'function'
  );
}

/**
 * Map pre-batch line numbers onto post-batch ones through an update's line
 * changes: lines inside a replaced old range drop out (the update itself
 * re-tokenized their replacements), lines beyond one shift by its delta.
 */
function remapThroughLineChanges(
  lines: Map<number, Array<HighlightedToken>>,
  update: CodeLiveTokenizerUpdate
): Map<number, Array<HighlightedToken>> {
  const { lineChanges } = update;
  if (lineChanges.length === 0) {
    return lines;
  }
  const remapped = new Map<number, Array<HighlightedToken>>();
  for (const [line, tokens] of lines) {
    let target = line;
    let dropped = false;
    for (const change of lineChanges) {
      if (line >= change.oldEndLine) {
        target +=
          change.newEndLine -
          change.newStartLine -
          (change.oldEndLine - change.oldStartLine);
      } else if (line >= change.oldStartLine) {
        dropped = true;
        break;
      } else {
        // line changes are ascending; the rest cannot affect this line
        break;
      }
    }
    if (!dropped && target < update.lineCount) {
      remapped.set(target, tokens);
    }
  }
  return remapped;
}

function tokenizeLine(
  grammar: IGrammar,
  colorMap: string[],
  lineText: string,
  stateStack: StateStack,
  timeLimit?: number,
  collectBracketIgnoredRanges = true,
  resolveTokens = true
): {
  ruleStack: StateStack;
  resolvedTokens: Array<HighlightedToken>;
  bracketIgnoredRanges: [number, number][];
} {
  const result = grammar.tokenizeLine2(lineText, stateStack, timeLimit);
  if (result.stoppedEarly) {
    console.warn(
      `[diffs] Time limit reached when tokenizing line: ${lineText.substring(0, 100)}`
    );
  }
  const rawTokens = result.tokens;
  const tokensLength = rawTokens.length / 2;
  const resolvedTokens: Array<HighlightedToken> = [];
  const bracketIgnoredRanges: [number, number][] = [];
  if (!resolveTokens && !collectBracketIgnoredRanges) {
    return {
      ruleStack: result.ruleStack,
      resolvedTokens,
      bracketIgnoredRanges,
    };
  }
  for (let j = 0; j < tokensLength; j++) {
    const offset = rawTokens[2 * j];
    const nextOffset =
      j + 1 < tokensLength ? rawTokens[2 * j + 2] : lineText.length;
    if (offset === nextOffset) {
      // should never reach here, skip if happens anyway
      continue;
    }
    const metadata = rawTokens[2 * j + 1];
    if (resolveTokens) {
      const fg = EncodedTokenMetadata.getForeground(metadata);
      resolvedTokens.push([
        offset,
        colorMap[fg],
        lineText.slice(offset, nextOffset),
      ]);
    }
    if (
      collectBracketIgnoredRanges &&
      EncodedTokenMetadata.getTokenType(metadata) > 0
    ) {
      bracketIgnoredRanges.push([offset, nextOffset]);
    }
  }
  return {
    ruleStack: result.ruleStack,
    resolvedTokens,
    bracketIgnoredRanges,
  };
}

export function renderLineTokens(
  tokens: Array<HighlightedToken>
): (HTMLElement | string)[] {
  return tokens.map(([char, fg, textContent]) => {
    if (char === 0 && fg === '') {
      if (textContent === '') {
        return h('br');
      }
      return textContent;
    }
    return h('span', {
      dataset: {
        char: char.toString(),
      },
      style: `color:${fg};`,
      textContent: textContent,
    });
  });
}

// Shiki special-cases `text` and `ansi` in codeToHast but does not expose grammars.
function isGrammarlessLanguage(languageId: string): boolean {
  return languageId === 'text' || languageId === 'ansi';
}
