import {
  EncodedTokenMetadata,
  type IGrammar,
  INITIAL,
  type StateStack,
} from 'shiki/textmate';

import { DEFAULT_THEMES } from '../constants';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  HighlightedToken,
  RenderRange,
} from '../types';
import type { TextDocument, TextDocumentChange } from './textDocument';
import { addEventListener, debounce, h } from './utils';

const TOKENIZE_TIME_LIMIT = 500;

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

/** Stoppable code tokenizer for the editor */
export class EditorTokenizer {
  #highlighter: DiffsHighlighter;
  #grammar: IGrammar | undefined;
  #mediaQueryList: MediaQueryList;
  #themeType: 'light' | 'dark' = 'dark';
  // The resolved name of the theme currently applied to the editor (e.g.
  // `github-light`). Tracked so `syncTheme` can detect a host-driven theme swap
  // even when the light/dark mode itself is unchanged.
  #themeName = '';
  #colorMap: string[];
  #textDocument: TextDocument<unknown>;
  #tokenizeMaxLineLength: number;
  #setStyle: EditorTokenizerProps['setStyle'];
  #onDeferTokenize: EditorTokenizerProps['onDeferTokenize'];
  #onThemeChange: EditorTokenizerProps['onThemeChange'];
  #matchBrackets: boolean;
  #debug: boolean;
  #disposes?: (() => void)[];
  #isCleanedUp = false;

  // state
  #stateStack: StateStack[] = [INITIAL]; // cached state stack by line index
  #comparisonStateStack: StateStack[] = [];
  #lastLine: number = -1;
  #isStopped: boolean = true;
  #isPaused: boolean = false;
  #backgroundJobId: number = 0;
  #backgroundChangedLineRanges: readonly [number, number][] | undefined;
  #backgroundChangedRangeIndex: number = 0;
  #bracketIgnoredRanges: Map<number, [number, number][] | null> = new Map();
  #isMessageListenerAttached: boolean = false;

  #prebuildStateStack = debounce(async (renderRange?: RenderRange) => {
    // Drop work scheduled before cleanUp; a late timer must not call setTheme
    // on a highlighter that tests (or hosts) have already disposed.
    if (this.#isCleanedUp) {
      return;
    }
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const endLine = Math.min(
      totalLines === Infinity ? Infinity : startingLine + totalLines,
      this.#textDocument.lineCount
    );
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      await this.#highlighter.loadLanguage(this.#textDocument.languageId);
      if (this.#isCleanedUp) {
        return;
      }
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
      );
    }
    this.#ensureActiveTheme();
    this.#buildStateStack(endLine);
  }, 500);

  #onMessage = ({ data }: MessageEvent<unknown>) => {
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const { type, jobId } = data as {
      type?: unknown;
      jobId?: unknown;
    };
    if (
      type === 'tokenize' &&
      typeof jobId === 'number' &&
      jobId === this.#backgroundJobId
    ) {
      this.#backgroundTokenize(jobId);
    }
  };

  get themeType(): 'light' | 'dark' {
    return this.#themeType;
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    if (
      !this.#matchBrackets ||
      lineIndex < 0 ||
      lineIndex >= this.#textDocument.lineCount
    ) {
      return null;
    }
    this.#ensureGrammar();
    if (this.#grammar === undefined) {
      return null;
    }
    if (!this.#bracketIgnoredRanges.has(lineIndex)) {
      this.#buildStateStack(lineIndex);
      const state = this.#stateStack[lineIndex] ?? INITIAL;
      const result = this.#tokenizeLineAt(lineIndex, state);
      this.#stateStack[lineIndex + 1] = result.state;
    }
    return this.#bracketIgnoredRanges.get(lineIndex) ?? null;
  }

  constructor({
    codeOptions,
    highlighter,
    textDocument,
    matchBrackets,
    setStyle,
    onDeferTokenize,
    onThemeChange,
    __debug,
  }: EditorTokenizerProps) {
    const {
      themeType: themeTypeOption = 'system',
      theme = DEFAULT_THEMES,
      tokenizeMaxLineLength = 1000,
    } = codeOptions;
    this.#mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    let themeType: 'light' | 'dark' | undefined;
    if (themeTypeOption === 'system') {
      // Prefer the host document's computed color-scheme (page CSS/classes can
      // force light/dark while the OS media query differs) over matchMedia.
      themeType = this.#resolveSystemThemeType();
    } else {
      themeType = themeTypeOption;
    }
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
            const themeType = this.#resolveSystemThemeType();
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
          const themeType = this.#resolveSystemThemeType();
          this.#emitThemeChange(theme[themeType], themeType);
        }),
        () => observer.disconnect(),
      ];
    }
    this.#highlighter = highlighter;
    this.#textDocument = textDocument;
    this.#tokenizeMaxLineLength = tokenizeMaxLineLength;
    this.#setStyle = setStyle;
    this.#onDeferTokenize = onDeferTokenize;
    this.#onThemeChange = onThemeChange;
    this.#matchBrackets = matchBrackets !== false;
    this.#debug = __debug ?? false;
    this.#ensureGrammar();
    this.#colorMap = [];
    this.#setTheme(
      typeof theme === 'string' ? theme : theme[themeType],
      themeType
    );
  }

  // By default, diffs components support dual themes, but the tokenizer only renders
  // the preferred theme. When the theme type is changed, the tokenizer will re-tokenize the document.
  #emitThemeChange(themeName: string, themeType: 'light' | 'dark') {
    this.#setTheme(themeName, themeType);
    this.stopBackgroundTokenize();
    this.#stateStack = [INITIAL];
    this.#comparisonStateStack = [];
    if (this.#grammar !== undefined && this.#textDocument.lineCount > 0) {
      this.#scheduleBackgroundTokenize(0);
    }
    // The theme CSS is now applied, so overlay pieces that captured a resolved
    // theme color (e.g. rounded selection corner masks) can recompute against
    // the new colors instead of keeping the old light/dark value.
    this.#onThemeChange?.();
  }

  // Resolve `themeType: 'system'` the same way the MutationObserver does: from
  // the host document's computed `color-scheme`. Apps often force a scheme via
  // page CSS/classes while the OS `prefers-color-scheme` media query differs;
  // using matchMedia here would flip tokens back to the OS preference on every
  // render sync and fight the observer.
  #resolveSystemThemeType(): 'light' | 'dark' {
    try {
      if (
        typeof document !== 'undefined' &&
        typeof getComputedStyle === 'function' &&
        document.body != null
      ) {
        return getComputedStyle(document.body).colorScheme === 'dark'
          ? 'dark'
          : 'light';
      }
    } catch {
      // jsdom and similar harnesses may lack getComputedStyle or throw; fall
      // through to the OS media query.
    }
    return this.#mediaQueryList.matches ? 'dark' : 'light';
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
    const nextThemeType =
      themeType === 'system' ? this.#resolveSystemThemeType() : themeType;
    const nextThemeName =
      typeof theme === 'string' ? theme : theme[nextThemeType];
    if (
      nextThemeType === this.#themeType &&
      nextThemeName === this.#themeName
    ) {
      return;
    }
    this.#emitThemeChange(nextThemeName, nextThemeType);
  }

  #setTheme(themeName: string, themeType?: 'light' | 'dark') {
    const { theme, colorMap } = this.#highlighter.setTheme(themeName);
    const { colors = {} } = this.#highlighter.getTheme(themeName);
    const selectionBackground = colors['editor.selectionBackground'];
    const lineHighlightBackground = colors['editor.lineHighlightBackground'];
    const cursorForeground = colors['editorCursor.foreground'];
    const findMatchBackground = colors['editor.findMatchBackground'];
    const findMatchHighlightBackground =
      colors['editor.findMatchHighlightBackground'];
    const bracketMatchBackground = colors['editorBracketMatch.background'];
    const bracketMatchBorder = colors['editorBracketMatch.border'];
    const hintForeground = colors['editorHint.foreground'];
    const infoForeground = colors['editorInfo.foreground'];
    const warningForeground = colors['editorWarning.foreground'];
    const errorForeground = colors['editorError.foreground'];
    this.#setStyle(`:host {
      --diffs-editor-selection-bg: ${selectionBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-bg: ${lineHighlightBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-match-bg: ${findMatchBackground ?? 'initial'};
      --diffs-editor-match-highlight-bg: ${findMatchHighlightBackground ?? 'initial'};
      --diffs-editor-bracket-match-bg: ${bracketMatchBackground ?? 'initial'};
      --diffs-editor-bracket-match-border: ${bracketMatchBorder ?? 'initial'};
      --diffs-editor-cursor-fg: ${cursorForeground ?? 'initial'};
      --diffs-editor-hint-fg: ${hintForeground ?? 'initial'};
      --diffs-editor-info-fg: ${infoForeground ?? 'initial'};
      --diffs-editor-warning-fg: ${warningForeground ?? 'initial'};
      --diffs-editor-error-fg: ${errorForeground ?? 'initial'};
    }`);
    this.#themeName = themeName;
    this.#themeType = themeType ?? theme.type;
    this.#colorMap = colorMap;
  }

  // The shared highlighter is also used for dual-theme SSR (`themes: {dark,light}`),
  // which leaves its active theme on whichever pass finished last (usually light).
  // The tokenizer caches a single-theme colorMap from construction; if we tokenize
  // without re-activating that theme, grammar color indices are looked up in the
  // wrong map — property names resolve to a near-foreground gray while types and
  // comments (stable across maps) still look correct. Re-apply before every
  // tokenize path so a first edit after load matches a later file-switch re-attach.
  #ensureActiveTheme(): void {
    if (this.#themeName === '') {
      return;
    }
    const { colorMap } = this.#highlighter.setTheme(this.#themeName);
    this.#colorMap = colorMap;
  }

  cleanUp(): void {
    this.#isCleanedUp = true;
    this.stopBackgroundTokenize();
    this.#detachMessageListener();
    this.#disposes?.forEach((dispose) => dispose());
    this.#disposes = undefined;
  }

  // to use `tokenize`, call `prebuildStateStackMap` first to prebuild
  // the state stack map for the given render range.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, Array<HighlightedToken>> {
    this.#ensureGrammar();
    this.#ensureActiveTheme();
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      throw new Error(
        `Grammar for language "${this.#textDocument.languageId}" not loaded`
      );
    }

    if (this.#matchBrackets) {
      // Clear ignored token ranges for lines invalidated by the edit.
      for (const line of this.#bracketIgnoredRanges.keys()) {
        if (line >= change.startLine) {
          this.#bracketIgnoredRanges.delete(line);
        }
      }
    }

    const { lineCount } = this.#textDocument;
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
    const canReuseCachedStates = change.lineDelta === 0;
    const canCacheTokenizedStates =
      canReuseCachedStates ||
      renderRange === undefined ||
      dirtyStart >= viewStart;
    const changedLineRanges: readonly [number, number][] =
      change.changedLineRanges ?? [[dirtyStart, change.endLine]];
    this.#comparisonStateStack = [];
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
        canReuseCachedStates &&
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
        if (this.#stateStack[nextRange[0]] === undefined) {
          currentChangedRangeEnd = nextRange[1];
          line++;
        } else {
          line = nextRange[0];
          state = this.#stateStack[line] ?? state;
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

    if (offscreenDirtyLines !== undefined && offscreenDirtyLines.size > 0) {
      this.#onDeferTokenize(offscreenDirtyLines, this.#themeType);
    }

    if (backgroundStartLine !== undefined) {
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
    if (this.#isStopped) {
      return;
    }
    this.#isStopped = true;
    this.#isPaused = false;
    this.#lastLine = -1;
    this.#backgroundChangedLineRanges = undefined;
    this.#backgroundChangedRangeIndex = 0;
    this.#comparisonStateStack = [];
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
      !isGrammarlessLanguage(this.#textDocument.languageId) &&
      this.#highlighter
        .getLoadedLanguages()
        .includes(this.#textDocument.languageId)
    ) {
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
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
    globalThis.postMessage({ type: 'tokenize', jobId });
  }

  #scheduleBackgroundTokenize(
    startLine: number,
    changedLineRanges?: readonly [number, number][],
    changedRangeIndex = 0
  ): void {
    if (isGrammarlessLanguage(this.#textDocument.languageId)) {
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
    this.#backgroundChangedLineRanges = changedLineRanges;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    this.#attachMessageListener();
    this.#postTokenizeMessage(jobId);
  }

  #tokenizeLineAt(
    line: number,
    state: StateStack
  ): { resolvedTokens: Array<HighlightedToken>; state: StateStack } {
    const lineText = this.#textDocument.getLineText(line);
    if (lineText.length > this.#tokenizeMaxLineLength) {
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
      this.#matchBrackets
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
    if (this.#matchBrackets) {
      this.#bracketIgnoredRanges.set(line, ranges);
    }
  }

  // Preserve old end states as comparison-only sentinels. They let background
  // tokenization stop when grammar state reconverges without letting foreground
  // tokenization seed from stale pre-edit states.
  #shiftComparisonStateStack(change: TextDocumentChange): void {
    const lineChanges =
      change.changedLineChanges ??
      ([[change.startLine, change.endLine, change.lineDelta]] as const);
    const comparisonStateStack = this.#stateStack.slice();

    for (const [startLine, endLine, lineDelta] of lineChanges) {
      if (lineDelta === 0) {
        continue;
      }

      const insertedLineSpan = endLine - startLine;
      const oldLineSpan = insertedLineSpan - lineDelta;
      const sourceStart = startLine + oldLineSpan + 1;
      const targetStart = startLine + insertedLineSpan + 1;
      const originalLength = comparisonStateStack.length;

      if (lineDelta > 0) {
        for (let line = originalLength - 1; line >= sourceStart; line--) {
          const targetLine = line + lineDelta;
          if (line in comparisonStateStack) {
            comparisonStateStack[targetLine] = comparisonStateStack[line];
          } else {
            Reflect.deleteProperty(comparisonStateStack, targetLine);
          }
        }
      } else {
        for (let line = sourceStart; line < originalLength; line++) {
          const targetLine = line + lineDelta;
          if (line in comparisonStateStack) {
            comparisonStateStack[targetLine] = comparisonStateStack[line];
          } else {
            Reflect.deleteProperty(comparisonStateStack, targetLine);
          }
        }
        comparisonStateStack.length = Math.max(
          Math.min(originalLength, startLine + 1),
          originalLength + lineDelta
        );
      }

      for (let line = startLine + 1; line < targetStart; line++) {
        Reflect.deleteProperty(comparisonStateStack, line);
      }
    }

    this.#stateStack.length = Math.min(
      this.#stateStack.length,
      change.startLine + 1
    );
    comparisonStateStack.length = Math.min(
      comparisonStateStack.length,
      this.#textDocument.lineCount + 1
    );
    for (let line = 0; line <= change.startLine; line++) {
      Reflect.deleteProperty(comparisonStateStack, line);
    }
    this.#comparisonStateStack = comparisonStateStack;
  }

  #getPreviousEndState(line: number): StateStack | undefined {
    return this.#comparisonStateStack[line] ?? this.#stateStack[line];
  }

  #buildStateStack(endAt: number) {
    const boundedEndAt = Math.min(
      Math.max(0, endAt),
      this.#textDocument.lineCount
    );
    if (this.#stateStack.length > boundedEndAt || this.#grammar === undefined) {
      return;
    }
    let line = this.#stateStack.length - 1;
    let state = this.#stateStack[line] ?? INITIAL;
    for (; line < boundedEndAt; line++) {
      this.#stateStack[line] = state;
      const lineText = this.#textDocument.getLineText(line);
      if (
        lineText.length <= this.#tokenizeMaxLineLength &&
        lineText !== '' &&
        lineText.trim() !== ''
      ) {
        const result = tokenizeLine(
          this.#grammar,
          this.#colorMap,
          lineText,
          state,
          TOKENIZE_TIME_LIMIT,
          this.#matchBrackets
        );
        this.#cacheBracketIgnoredRanges(line, result.bracketIgnoredRanges);
        state = result.ruleStack;
      } else {
        this.#cacheBracketIgnoredRanges(line, null);
      }
    }
    this.#stateStack[line] = state;
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
    const totalLines = this.#textDocument.lineCount;
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
      const lineText = this.#textDocument.getLineText(line);
      if (lineText.length > this.#tokenizeMaxLineLength) {
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
          this.#matchBrackets
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

    this.#onDeferTokenize(lines, this.#themeType);
    if (this.#isStopped || this.#isPaused || jobId !== this.#backgroundJobId) {
      return;
    }

    if (settled || line >= totalLines) {
      this.stopBackgroundTokenize();
      return;
    }

    this.#lastLine = line;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    this.#postTokenizeMessage(jobId);
  }
}

function tokenizeLine(
  grammar: IGrammar,
  colorMap: string[],
  lineText: string,
  stateStack: StateStack,
  timeLimit?: number,
  collectBracketIgnoredRanges = true
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
  for (let j = 0; j < tokensLength; j++) {
    const offset = rawTokens[2 * j];
    const nextOffset =
      j + 1 < tokensLength ? rawTokens[2 * j + 2] : lineText.length;
    if (offset === nextOffset) {
      // should never reach here, skip if happens anyway
      continue;
    }
    const metadata = rawTokens[2 * j + 1];
    const fg = EncodedTokenMetadata.getForeground(metadata);
    const tokenText = lineText.slice(offset, nextOffset);
    resolvedTokens.push([offset, colorMap[fg], tokenText]);
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
