import type { HighlighterCore } from 'shiki/core';
import {
  EncodedTokenMetadata,
  type IGrammar,
  INITIAL,
  type StateStack,
} from 'shiki/textmate';

import type { TextDocumentChange } from '../editor/textDocument';
import { debounce } from '../editor/utils';
import type { HighlightedToken, RenderRange } from '../types';
import type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
} from './tokenizer-types';
import type { DiffsHighlighter } from './types';

// A cold regex engine can exceed a deadline and return an incomplete state.
// Bound work by line length and background slices instead of accepting it.
const TOKENIZE_TIME_LIMIT = 0;
let nextTokenizerId = 0;

/** TextMate state caching and background work for a single editable document. */
export class ShikiLiveTokenizer implements DiffsLiveTokenizer {
  #highlighter: HighlighterCore;
  #grammar: IGrammar | undefined;
  #themeName: string;
  #colorMap: string[];
  #textDocument: DiffsLiveTokenizerOptions['textDocument'];
  #tokenizeMaxLineLength: number;
  #onDeferTokenize: DiffsLiveTokenizerOptions['onDeferTokenize'];
  #matchBrackets: boolean;
  #debug: boolean;
  #isCleanedUp = false;
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
    // Drop work scheduled before disposal; a late timer must not call setTheme
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
      await this.backend?.loadLanguages?.([this.#textDocument.languageId]);
      if (this.#isCleanedUp) {
        return;
      }
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
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
    if (this.#bracketIgnoredRanges[lineIndex] === undefined) {
      this.#buildStateStack(lineIndex);
      const state = this.#stateStack[lineIndex] ?? INITIAL;
      const result = this.#tokenizeLineAt(lineIndex, state);
      this.#stateStack[lineIndex + 1] = result.state;
    }
    return this.#bracketIgnoredRanges[lineIndex] ?? null;
  }

  constructor(
    highlighter: HighlighterCore,
    options: DiffsLiveTokenizerOptions,
    private readonly backend?: Pick<
      DiffsHighlighter,
      'getTheme' | 'loadLanguages'
    >
  ) {
    this.#highlighter = highlighter;
    this.#textDocument = options.textDocument;
    this.#themeName = options.theme;
    this.#colorMap = [];
    // Lines at or above the limit stay unthemed, matching Shiki's codeToTokens
    // and the Highlights backend so every render path agrees on the cutoff.
    this.#tokenizeMaxLineLength = options.tokenizeMaxLineLength ?? 1000;
    this.#onDeferTokenize = options.onDeferTokenize;
    this.#matchBrackets = options.matchBrackets !== false;
    this.#debug = options.__debug ?? false;
    this.#ensureGrammar();
    this.#ensureActiveTheme();
  }

  setTheme(themeName: string): void {
    if (this.#themeName === themeName) return;
    this.#themeName = themeName;
    this.#ensureActiveTheme();
    this.stopBackgroundTokenize();
    this.#stateStack = [INITIAL];
    this.#comparisonStateStack = [];
    this.#comparisonStateStackStart = 0;
    this.#comparisonLineChanges = [];
    if (this.#grammar !== undefined && this.#textDocument.lineCount > 0) {
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
    if (this.#themeName === '') {
      return;
    }
    // Resolving a theme does not attach it to Shiki until the backend uses it.
    this.backend?.getTheme(this.#themeName);
    const { colorMap } = this.#highlighter.setTheme(this.#themeName);
    this.#colorMap = colorMap;
  }

  dispose(): void {
    this.#isCleanedUp = true;
    this.stopBackgroundTokenize();
    this.#detachMessageListener();
  }

  // Prebuild viewport state with prebuildStateStack before the first edit.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
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
    const canReuseCachedStates =
      change.lineDelta === 0 &&
      (change.changedLineChanges?.every(([, , lineDelta]) => lineDelta === 0) ??
        true);
    if (this.#matchBrackets && !canReuseCachedStates) {
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
      this.#onDeferTokenize(offscreenDirtyLines);
    }

    if (backgroundStartLine !== undefined) {
      if (this.#matchBrackets && canReuseCachedStates) {
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
      if (this.#matchBrackets && canReuseCachedStates) {
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
    const lineText = this.#textDocument.getLineText(line);
    if (lineText.length >= this.#tokenizeMaxLineLength) {
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
      this.#textDocument.lineCount
    );
    if (this.#stateStack.length > boundedEndAt || this.#grammar === undefined) {
      return true;
    }
    const startedAt = timeBudget === undefined ? 0 : performance.now();
    let line = this.#stateStack.length - 1;
    let state = this.#stateStack[line] ?? INITIAL;
    while (line < boundedEndAt) {
      this.#stateStack[line] = state;
      const lineText = this.#textDocument.getLineText(line);
      if (
        lineText.length < this.#tokenizeMaxLineLength &&
        lineText !== '' &&
        lineText.trim() !== ''
      ) {
        const result = tokenizeLine(
          this.#grammar,
          this.#colorMap,
          lineText,
          state,
          TOKENIZE_TIME_LIMIT,
          this.#matchBrackets,
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
      const result = this.#tokenizeLineAt(line, state);
      lines.set(line, result.resolvedTokens);
      state = result.state;

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

    this.#onDeferTokenize(lines);
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

// Shiki special-cases `text` and `ansi` in codeToHast but does not expose grammars.
function isGrammarlessLanguage(languageId: string): boolean {
  return languageId === 'text' || languageId === 'ansi';
}
