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
import type { DiffsEditorTokenizer } from './DiffsEditorTokenizer';
import { lineAfterChange, lineRangesAfterChange } from './linesAfterChange';
import type { DiffsEditorTokenizerOptions } from './tokenizer-types';
import type { DiffsHighlighter } from './types';

// Timed aborts can leave incomplete grammar state; limit line length instead.
const TOKENIZE_TIME_LIMIT = 0;
let nextTokenizerId = 0;

/** TextMate state caching and background work for a single editable document. */
export class ShikiEditorTokenizer implements DiffsEditorTokenizer {
  #highlighter: HighlighterCore;
  #grammar: IGrammar | undefined;
  #themeName: string;
  #colorMap: string[];
  #textDocument: DiffsEditorTokenizerOptions['textDocument'];
  #tokenizeMaxLineLength: number;
  #onDeferTokenize: DiffsEditorTokenizerOptions['onDeferTokenize'];
  #matchBrackets: boolean;
  #debug: boolean;
  #isCleanedUp = false;
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
  // Lines that still need coloring because an edit stopped the background
  // job before it got to them. The next edit picks them up again.
  #unfinishedRanges: readonly [number, number][] = [];
  // Lines a bracket read colored for a pending job, waiting for the read's
  // caller to return before they are delivered.
  #pendingDelivery: Map<number, HighlightedToken[]> | undefined;
  #backgroundChangedLineRanges: readonly [number, number][] | undefined;
  #backgroundChangedRangeIndex: number = 0;
  #bracketIgnoredRanges: ([number, number][] | null | undefined)[] = [];
  #isMessageListenerAttached: boolean = false;

  #prebuildStateStack = debounce(async (renderRange?: RenderRange) => {
    // A queued timer may run after the highlighter is disposed.
    if (this.#isCleanedUp) {
      return;
    }
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const endLine = Math.min(
      totalLines === Infinity ? Infinity : startingLine + totalLines,
      this.#textDocument.lineCount
    );
    if (
      this.#grammar == null &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      await this.backend?.loadLanguages([this.#textDocument.languageId]);
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
    if (this.#grammar == null) {
      return null;
    }
    if (this.#bracketIgnoredRanges[lineIndex] === undefined) {
      if (this.#ownsLine(lineIndex)) {
        // The pending job owns the lines from its next one down. The read
        // does the job's work up to its line, so the states it needs come
        // with the tokens the rows need.
        const run = this.#runJob(lineIndex + 1);
        this.#queueDelivery(run.lines);
        if (run.done) {
          this.#finishBackgroundJob();
        }
      } else {
        this.#buildStateStack(lineIndex);
        const state = this.#stateStack[lineIndex] ?? INITIAL;
        const result = this.#tokenizeLineAt(lineIndex, state);
        this.#stateStack[lineIndex + 1] = result.state;
      }
    }
    return this.#bracketIgnoredRanges[lineIndex] ?? null;
  }

  constructor(
    highlighter: HighlighterCore,
    options: DiffsEditorTokenizerOptions,
    private readonly backend?: Pick<
      DiffsHighlighter,
      'getTheme' | 'loadLanguages'
    >
  ) {
    this.#highlighter = highlighter;
    this.#textDocument = options.textDocument;
    this.#themeName = options.theme;
    this.#colorMap = [];
    // The cutoff must match codeToTokens and Highlights: length >= limit.
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
    // The new theme's pass covers the whole document.
    this.#unfinishedRanges = [];
    this.#pendingDelivery = undefined;
    this.#stateStack = [INITIAL];
    this.#comparisonStateStack = [];
    this.#comparisonStateStackStart = 0;
    this.#comparisonLineChanges = [];
    if (this.#grammar != null && this.#textDocument.lineCount > 0) {
      this.#scheduleBackgroundTokenize(0, [
        [0, this.#textDocument.lineCount - 1],
      ]);
    }
  }

  // Dual-theme SSR can change the shared highlighter's active theme. Restore
  // the editor theme before tokenizing so color indices match its color map.
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
    this.#unfinishedRanges = [];
    this.#pendingDelivery = undefined;
    this.#detachMessageListener();
  }

  // Prebuild viewport state with prebuildStateStack before the first edit.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, Array<HighlightedToken>> {
    this.#ensureGrammar();
    this.#ensureActiveTheme();
    if (
      this.#grammar == null &&
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

    // Lines a stopped background job never reached, renumbered through this
    // edit. The ones above the edit are colored below, before the edit's own
    // lines; the job scheduled at the end takes the rest.
    this.#unfinishedRanges = lineRangesAfterChange(
      this.#unfinishedRanges,
      change
    );
    // Lines a bracket read colored still wait to be handed over; they ride
    // with this edit, renumbered. Lines the edit rewrote are lexed again.
    const dirtyLines: Map<number, Array<HighlightedToken>> = new Map();
    const pending = this.#pendingDelivery;
    this.#pendingDelivery = undefined;
    if (pending != null) {
      for (const [line, tokens] of pending) {
        const moved = lineAfterChange(line, change);
        if (moved != null) dirtyLines.set(moved, tokens);
      }
    }
    const changedLineRanges: readonly [number, number][] =
      change.changedLineRanges ?? [[change.startLine, change.endLine]];
    const dirtyStart = change.startLine;
    const viewStart = Math.max(startingLine, dirtyStart);
    const crossesRenderRangeEnd =
      renderRange != null &&
      totalLines !== Infinity &&
      change.lineDelta > 0 &&
      dirtyStart < renderRangeEndLine &&
      change.endLine >= renderRangeEndLine;
    const canReuseCachedStates =
      change.lineDelta === 0 &&
      (change.changedLineChanges?.every(([, , lineDelta]) => lineDelta === 0) ??
        true);
    if (this.#matchBrackets && !canReuseCachedStates) {
      // Structural edits shift line indexes; only the unchanged prefix is valid.
      this.#bracketIgnoredRanges.length = Math.min(
        this.#bracketIgnoredRanges.length,
        change.startLine
      );
    }
    // Rows are keyed by line, so after an edit that moved lines the states
    // below it compare against their old positions and tokenizing stops once
    // they match again.
    const canReuseShiftedStates =
      !canReuseCachedStates && dirtyStart >= startingLine;
    const canCacheTokenizedStates =
      canReuseCachedStates || renderRange == null || dirtyStart >= viewStart;
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
    if (!canReuseCachedStates) {
      this.#shiftComparisonStateStack(change);
    }
    this.#colorOwedLinesAbove(dirtyStart, dirtyLines);

    let changedRangeIndex = 0;
    let currentChangedRangeEnd = changedLineRanges[changedRangeIndex][1];
    let backgroundStartLine: number | undefined;
    let backgroundChangedRangeIndex = 0;
    let line = canReuseCachedStates
      ? changedLineRanges[changedRangeIndex][0]
      : viewStart;
    let settled = false;
    const offscreenDirtyLines:
      | Map<number, Array<HighlightedToken>>
      | undefined = shouldFlushOffscreenLines ? new Map() : undefined;
    if (offscreenDirtyLines != null && !canReuseCachedStates) {
      const offscreenEnd = Math.min(
        offscreenSyncEnd + 1,
        viewStart,
        renderRangeEndLine
      );
      if (offscreenEnd > dirtyStart) {
        let offscreenLine = dirtyStart;
        this.#buildStateStack(offscreenLine);
        let offscreenState = this.#stateStack[offscreenLine] ?? INITIAL;
        for (; offscreenLine < offscreenEnd; offscreenLine++) {
          const resolved = this.#tokenizeLineAt(offscreenLine, offscreenState);
          offscreenState = resolved.state;
          offscreenDirtyLines.set(offscreenLine, resolved.resolvedTokens);
        }
        this.#stateStack[offscreenEnd] = offscreenState;
      }
    }
    // Read state after the offscreen flush; a deletion may have invalidated
    // the viewport's starting state inside a block comment or template literal.
    // An edit above the window that added lines starts the window from the
    // state it has, which the background job from the edit then corrects.
    if (
      canReuseCachedStates ||
      renderRange == null ||
      dirtyStart >= viewStart
    ) {
      this.#buildStateStack(line);
    }
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
        previousNextState != null &&
        state.equals(previousNextState);
      if (settled) {
        changedRangeIndex++;
        const nextRange = changedLineRanges[changedRangeIndex];
        if (nextRange == null) {
          break;
        }
        // The lines up to the next range kept their states, shifted; the
        // next range starts from them, in this pass or in the background.
        let nextState: StateStack | undefined = this.#stateStack[nextRange[0]];
        if (canReuseShiftedStates) {
          for (
            let stateLine = line + 2;
            stateLine <= nextRange[0];
            stateLine++
          ) {
            nextState = this.#getPreviousEndState(stateLine);
            if (nextState == null) {
              break;
            }
            this.#stateStack[stateLine] = nextState;
          }
        }
        if (nextRange[0] >= renderRangeEndLine) {
          backgroundStartLine = nextRange[0];
          backgroundChangedRangeIndex = changedRangeIndex;
          break;
        }
        if (nextState == null) {
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

    if (settled && canReuseShiftedStates && backgroundStartLine == null) {
      for (let stateLine = line + 2; stateLine <= lineCount; stateLine++) {
        const previousState = this.#getPreviousEndState(stateLine);
        if (previousState == null) {
          break;
        }
        this.#stateStack[stateLine] = previousState;
      }
      this.#comparisonStateStack = [];
      this.#comparisonStateStackStart = 0;
      this.#comparisonLineChanges = [];
    }

    // Lines above the window ride with the edit too, so the component applies
    // them against the document the edit produced.
    if (offscreenDirtyLines != null) {
      for (const [line, tokens] of offscreenDirtyLines) {
        dirtyLines.set(line, tokens);
      }
    }

    // The job takes the lines this edit left to it, from where the pass above
    // stopped through the ranges it did not reach, and the unfinished ranges
    // of the job it interrupted.
    let left: readonly [number, number][] = [];
    if (backgroundStartLine != null) {
      left = remainingRanges(
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
      left = remainingRanges(
        backgroundLine,
        changedLineRanges,
        changedRangeIndex
      );
    }
    const jobRanges = mergeLineRanges(left, this.#unfinishedRanges);
    this.#unfinishedRanges = [];
    if (jobRanges.length > 0) {
      const jobStart = jobRanges[0][0];
      if (this.#matchBrackets && canReuseCachedStates) {
        this.#bracketIgnoredRanges.length = Math.min(
          this.#bracketIgnoredRanges.length,
          jobStart
        );
      }
      this.#scheduleBackgroundTokenize(jobStart, jobRanges);
    }

    return dirtyLines;
  }

  prebuildStateStack(renderRange?: RenderRange): void {
    this.#ensureGrammar();
    this.#prebuildStateStack(renderRange);
  }

  // Shiki keeps coloring lines it hasn't reached in the background.
  flush(): Map<number, HighlightedToken[]> {
    return new Map();
  }

  stopBackgroundTokenize(): void {
    this.#pendingPrebuildEndLine = -1;
    if (this.#isStopped) {
      return;
    }
    // A job with lines still to color keeps them for the next edit. A
    // finished job, and a state prebuild, leave nothing.
    const ranges = this.#backgroundChangedLineRanges;
    if (ranges != null && this.#lastLine >= 0) {
      this.#unfinishedRanges = mergeLineRanges(
        this.#unfinishedRanges,
        remainingRanges(
          this.#lastLine,
          ranges,
          this.#backgroundChangedRangeIndex
        )
      );
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

  // Ends a job that reached every line it was given.
  #finishBackgroundJob(): void {
    this.#lastLine = -1;
    this.stopBackgroundTokenize();
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
      this.#grammar == null ||
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
      this.#grammar == null &&
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

    this.#startJob(startLine, changedLineRanges, changedRangeIndex);
    this.#attachMessageListener();
    this.#postTokenizeMessage(jobId);
  }

  // Makes a job of the lines from `startLine` through `changedLineRanges`
  // the pending one, without running it.
  #startJob(
    startLine: number,
    changedLineRanges: readonly [number, number][] | undefined,
    changedRangeIndex: number
  ): void {
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
  }

  #scheduleStatePrebuild(endLine: number): void {
    if (this.#grammar == null || this.#stateStack.length > endLine) {
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
    if (this.#grammar == null || lineText === '' || lineText.trim() === '') {
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

  // The state line `line` started from when its row was last colored, or
  // undefined when that is not known. After an edit that moved lines it comes
  // from the states kept aside, by the line's old number; a state this edit
  // stored is never the answer, since the rows below it still show the old
  // colors.
  #getPreviousEndState(line: number): StateStack | undefined {
    if (this.#comparisonLineChanges.length === 0) {
      return this.#stateStack[line];
    }
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
    if (previousLine < this.#comparisonStateStackStart) {
      return this.#stateStack[line];
    }
    return this.#comparisonStateStack[
      previousLine - this.#comparisonStateStackStart
    ];
  }

  // Whether a pending job still has to color `line`: the job's next line and
  // everything below it show colors from before the edit that started it.
  #ownsLine(line: number): boolean {
    return (
      !this.#isStopped &&
      this.#backgroundPrebuildEndLine < 0 &&
      this.#lastLine >= 0 &&
      line >= this.#lastLine
    );
  }

  // Colors the lines an interrupted job left above `until` now, into
  // `lines`, so the states the edit starts from are current. What lies below
  // stays for the job scheduled after the edit.
  #colorOwedLinesAbove(
    until: number,
    lines: Map<number, HighlightedToken[]>
  ): void {
    const owed = this.#unfinishedRanges;
    if (owed.length === 0 || owed[0][0] >= until || this.#grammar == null) {
      return;
    }
    this.#startJob(owed[0][0], owed, 0);
    const run = this.#runJob(until);
    for (const [line, tokens] of run.lines) lines.set(line, tokens);
    this.#unfinishedRanges = run.done
      ? []
      : remainingRanges(
          this.#lastLine,
          owed,
          this.#backgroundChangedRangeIndex
        );
    this.#isStopped = true;
    this.#lastLine = -1;
    this.#backgroundChangedLineRanges = undefined;
    this.#backgroundChangedRangeIndex = 0;
  }

  // Delivers lines colored inside a bracket read once its caller has
  // returned, since the read runs inside the editor's own event handling.
  #queueDelivery(lines: Map<number, HighlightedToken[]>): void {
    if (lines.size === 0) return;
    const pending = this.#pendingDelivery;
    if (pending != null) {
      for (const [line, tokens] of lines) pending.set(line, tokens);
      return;
    }
    this.#pendingDelivery = lines;
    queueMicrotask(() => {
      const batch = this.#pendingDelivery;
      this.#pendingDelivery = undefined;
      if (batch != null && batch.size > 0 && !this.#isCleanedUp) {
        this.#onDeferTokenize(batch);
      }
    });
  }

  // Lexes a line for its end state alone.
  #lexState(line: number, state: StateStack): StateStack {
    const lineText = this.#textDocument.getLineText(line);
    if (
      this.#grammar == null ||
      lineText.length >= this.#tokenizeMaxLineLength ||
      lineText === '' ||
      lineText.trim() === ''
    ) {
      this.#cacheBracketIgnoredRanges(line, null);
      return state;
    }
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
    return result.ruleStack;
  }

  // Stores the states up to `endAt`, lexing the lines past the last stored
  // one. Those lines were never colored since the last edit above them, so
  // the rows show them as the highlight result does, which these states
  // describe. Returns whether the stored states reach `endAt`.
  #buildStateStack(endAt: number, timeBudget?: number): boolean {
    const boundedEndAt = Math.min(
      Math.max(0, endAt),
      this.#textDocument.lineCount
    );
    if (this.#stateStack.length > boundedEndAt || this.#grammar == null) {
      return true;
    }
    const startedAt = timeBudget == null ? 0 : performance.now();
    let line = this.#stateStack.length - 1;
    let state = this.#stateStack[line] ?? INITIAL;
    while (line < boundedEndAt) {
      this.#stateStack[line] = state;
      state = this.#lexState(line, state);
      line++;
      this.#stateStack[line] = state;
      if (timeBudget != null && performance.now() - startedAt > timeBudget) {
        break;
      }
    }
    return line >= boundedEndAt;
  }

  #backgroundPrebuild(jobId: number): void {
    if (
      this.#isStopped ||
      this.#isPaused ||
      this.#grammar == null ||
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
      this.#finishBackgroundJob();
      return;
    }
    this.#lastLine = this.#stateStack.length - 1;
    this.#postTokenizeMessage(jobId);
  }

  #backgroundTokenize(jobId: number) {
    if (
      this.#isStopped ||
      this.#isPaused ||
      this.#grammar == null ||
      jobId !== this.#backgroundJobId
    ) {
      return;
    }

    this.#ensureActiveTheme();
    const run = this.#runJob(this.#textDocument.lineCount, 1);
    this.#onDeferTokenize(run.lines);
    if (this.#isStopped || this.#isPaused || jobId !== this.#backgroundJobId) {
      return;
    }
    if (run.done) {
      const pendingPrebuildEndLine = this.#pendingPrebuildEndLine;
      this.#finishBackgroundJob();
      if (pendingPrebuildEndLine >= 0) {
        this.#scheduleStatePrebuild(pendingPrebuildEndLine);
      }
      return;
    }
    this.#postTokenizeMessage(jobId);
  }

 // Runs the pending job from its next line: colors each line, stores its
  // state, and moves on until every range settles, `until` is reached, or
  // the time budget runs out. Returns the lines colored and whether the job
  // is done; otherwise the job's next line is where this run stopped.
  #runJob(
    until: number,
    budgetMs?: number
  ): { lines: Map<number, HighlightedToken[]>; done: boolean } {
    const startedAt = budgetMs == null ? 0 : performance.now();
    const lines = new Map<number, Array<HighlightedToken>>();
    const end = Math.min(until, this.#textDocument.lineCount);
    const changedLineRanges = this.#backgroundChangedLineRanges;

    let line = this.#lastLine;
    let state = this.#stateStack[line] ?? INITIAL;
    let settled = false;
    let changedRangeIndex = this.#backgroundChangedRangeIndex;
    let currentChangedRangeEnd = changedLineRanges?.[changedRangeIndex]?.[1];
    for (; line < end; ) {
      this.#stateStack[line] = state;

      const previousNextState =
        currentChangedRangeEnd != null
          ? this.#getPreviousEndState(line + 1)
          : undefined;
      const result = this.#tokenizeLineAt(line, state);
      lines.set(line, result.resolvedTokens);
      state = result.state;

      this.#stateStack[line + 1] = state;
      settled =
        currentChangedRangeEnd != null &&
        line >= currentChangedRangeEnd &&
        previousNextState != null &&
        state.equals(previousNextState);
      line++;
      if (settled) {
        changedRangeIndex++;
        const nextRange = changedLineRanges?.[changedRangeIndex];
        if (nextRange == null) {
          break;
        }
        currentChangedRangeEnd = nextRange[1];
        if (this.#stateStack[nextRange[0]] == null) {
          settled = false;
        } else {
          line = nextRange[0];
          state = this.#stateStack[line] ?? state;
          settled = false;
          continue;
        }
      }

      if (budgetMs != null && performance.now() - startedAt > budgetMs) {
        break;
      }
    }

    const done = settled || line >= this.#textDocument.lineCount;
    this.#lastLine = line;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    return { lines, done };
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

// The ranges a job still has to color when it is at `line` in the range at
// `index`: the rest of that range, or `line` alone when the job is past its
// end and looking for the point where the states match again, and every
// range after it.
function remainingRanges(
  line: number,
  ranges: readonly [number, number][],
  index: number
): readonly [number, number][] {
  const end = ranges[index]?.[1] ?? line;
  return [[line, Math.max(line, end)], ...ranges.slice(index + 1)];
}

// The union of two sorted lists of line ranges, sorted, with touching and
// overlapping ranges joined.
function mergeLineRanges(
  first: readonly [number, number][],
  second: readonly [number, number][]
): readonly [number, number][] {
  if (second.length === 0) {
    return first;
  }
  const sorted = [...first, ...second].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last != null && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}
