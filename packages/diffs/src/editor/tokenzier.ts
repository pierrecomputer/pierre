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

export interface EditorTokenizerProps {
  highlighter: DiffsHighlighter;
  textDocument: TextDocument<unknown>;
  codeOptions: BaseCodeOptions;
  setStyle: (style: string) => void;
  onDeferTokenize: (
    lines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light'
  ) => void;
  __debug?: boolean;
}

/** Stoppable code tokenizer for the editor */
export class EditorTokenizer {
  static TOKENIZE_TIME_LIMIT = 500;

  #highlighter: DiffsHighlighter;
  #grammar: IGrammar | undefined;
  #mediaQueryList: MediaQueryList;
  #themeType: 'light' | 'dark';
  #colorMap: string[];
  #textDocument: TextDocument<unknown>;
  #tokenizeMaxLineLength: number;
  #setStyle: EditorTokenizerProps['setStyle'];
  #onDeferTokenize: EditorTokenizerProps['onDeferTokenize'];
  #debug: boolean;
  #disposes?: (() => void)[];

  // state
  #stateStack: StateStack[] = [INITIAL]; // cached state stack by line index
  #lastLine: number = -1;
  #isStopped: boolean = true;
  #isPaused: boolean = false;
  #backgroundJobId: number = 0;
  #backgroundChangedLineRanges: readonly [number, number][] | undefined;
  #backgroundChangedRangeIndex: number = 0;
  #isMessageListenerAttached: boolean = false;

  #prebuildStateStack = debounce(async (renderRange?: RenderRange) => {
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
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
      );
    }
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

  constructor({
    codeOptions,
    highlighter,
    textDocument,
    setStyle,
    onDeferTokenize,
    __debug,
  }: EditorTokenizerProps) {
    const {
      themeType = 'system',
      theme = DEFAULT_THEMES,
      tokenizeMaxLineLength = 1000,
    } = codeOptions;
    this.#mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    if (themeType === 'system') {
      this.#themeType = this.#mediaQueryList.matches ? 'dark' : 'light';
    } else {
      this.#themeType = themeType;
    }
    if (typeof theme !== 'string') {
      const observer = new MutationObserver((mutations) => {
        for (const { type, attributeName } of mutations) {
          if (
            type === 'attributes' &&
            attributeName !== null &&
            (attributeName === 'class' || attributeName.startsWith('data-'))
          ) {
            const themeType =
              getComputedStyle(document.body).colorScheme === 'dark'
                ? 'dark'
                : 'light';
            this.#emitThemeChange(theme[themeType], themeType);
            break;
          }
        }
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });
      this.#disposes = [
        addEventListener(this.#mediaQueryList, 'change', (e) => {
          const themeType = e.matches ? 'dark' : 'light';
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
    this.#debug = __debug ?? false;
    if (
      !isGrammarlessLanguage(textDocument.languageId) &&
      highlighter.getLoadedLanguages().includes(textDocument.languageId)
    ) {
      this.#grammar = highlighter.getLanguage(textDocument.languageId);
    }
    this.#colorMap = [];
    this.#setTheme(typeof theme === 'string' ? theme : theme[this.#themeType]);
  }

  // By default, diffs components support dual themes, but the tokenizer only renders
  // the preferred theme. When the theme type is changed, the tokenizer will re-tokenize the document.
  #emitThemeChange(themeName: string, themeType: 'light' | 'dark') {
    this.#themeType = themeType;
    this.#setTheme(themeName);
    this.stopBackgroundTokenize();
    this.#stateStack = [INITIAL];
    if (this.#grammar !== undefined && this.#textDocument.lineCount > 0) {
      this.#scheduleBackgroundTokenize(0);
    }
  }

  #setTheme(themeName: string) {
    this.#colorMap = this.#highlighter.setTheme(themeName).colorMap;
    const { colors = {} } = this.#highlighter.getTheme(themeName);
    const selectionBackground = colors['editor.selectionBackground'];
    const lineHighlightBackground = colors['editor.lineHighlightBackground'];
    const gutterForeground = colors['editorLineNumber.foreground'];
    const gutterActiveForeground = colors['editorLineNumber.activeForeground'];
    const cursorForeground = colors['editorCursor.foreground'];
    const findMatchBackground = colors['editor.findMatchBackground'];
    const findMatchHighlightBackground =
      colors['editor.findMatchHighlightBackground'];
    const hintForeground = colors['editorHint.foreground'];
    const infoForeground = colors['editorInfo.foreground'];
    const warningForeground = colors['editorWarning.foreground'];
    const errorForeground = colors['editorError.foreground'];
    this.#setStyle(`:host {
      --diffs-editor-selection-bg: ${selectionBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-bg: ${lineHighlightBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-number-fg: ${gutterForeground ?? 'var(--diffs-fg-number)'};
      --diffs-editor-line-number-active-bg: ${lineHighlightBackground ?? 'var(--diffs-line-bg, var(--diffs-bg))'};
      --diffs-editor-line-number-active-fg: ${gutterActiveForeground ?? 'var(--diffs-selection-number-fg)'};
      --diffs-editor-match-bg: ${findMatchBackground ?? 'unset'};
      --diffs-editor-match-highlight-bg: ${findMatchHighlightBackground ?? 'unset'};
      --diffs-editor-cursor-fg: ${cursorForeground ?? 'unset'};
      --diffs-editor-hint-fg: ${hintForeground ?? 'unset'};
      --diffs-editor-info-fg: ${infoForeground ?? 'unset'};
      --diffs-editor-warning-fg: ${warningForeground ?? 'unset'};
      --diffs-editor-error-fg: ${errorForeground ?? 'unset'};
    }`);
  }

  cleanUp(): void {
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
    if (
      this.#grammar === undefined &&
      !isGrammarlessLanguage(this.#textDocument.languageId)
    ) {
      throw new Error('Grammar not loaded');
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
    const changedLineRanges: readonly [number, number][] = canReuseCachedStates
      ? (change.changedLineRanges ?? [[dirtyStart, change.endLine]])
      : [[dirtyStart, change.endLine]];
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
      this.#stateStack.length = Math.min(
        this.#stateStack.length,
        dirtyStart + 1
      );
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
    let state = this.#stateStack[line] ?? INITIAL;
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
        if (canCacheTokenizedStates) {
          this.#stateStack[offscreenEnd] = offscreenState;
        }
      }
    }
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
        canReuseCachedStates ? changedLineRanges : undefined,
        changedRangeIndex
      );
    }

    return dirtyLines;
  }

  prebuildStateStack(renderRange?: RenderRange): void {
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
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    if (
      this.#grammar === undefined ||
      lineText === '' ||
      lineText.trim() === ''
    ) {
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    const result = tokenizeLine(
      this.#grammar,
      this.#colorMap,
      lineText,
      state,
      EditorTokenizer.TOKENIZE_TIME_LIMIT
    );
    return {
      resolvedTokens: result.resolvedTokens,
      state: result.ruleStack,
    };
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
        state = this.#grammar.tokenizeLine2(
          lineText,
          state,
          EditorTokenizer.TOKENIZE_TIME_LIMIT
        ).ruleStack;
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
          ? this.#stateStack[line + 1]
          : undefined;
      const lineText = this.#textDocument.getLineText(line);
      if (lineText.length > this.#tokenizeMaxLineLength) {
        console.warn(
          `[diffs] Line(${line}) too long to tokenize: ${lineText.length}`
        );
        lines.set(line, [[0, '', lineText]]);
      } else if (lineText === '' || lineText.trim() === '') {
        lines.set(line, [[0, '', lineText]]);
      } else {
        const ret = tokenizeLine(
          this.#grammar,
          this.#colorMap,
          lineText,
          state,
          EditorTokenizer.TOKENIZE_TIME_LIMIT
        );
        lines.set(line, ret.resolvedTokens);
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

export function tokenizeLine(
  grammar: IGrammar,
  colorMap: string[],
  lineText: string,
  stateStack: StateStack,
  timeLimit?: number
): {
  ruleStack: StateStack;
  resolvedTokens: Array<HighlightedToken>;
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
  for (let j = 0; j < tokensLength; j++) {
    const offset = rawTokens[2 * j];
    const nextOffset =
      j + 1 < tokensLength ? rawTokens[2 * j + 2] : lineText.length;
    if (offset === nextOffset) {
      // should never reach here, skip if happens anyway
      continue;
    }
    const metadata = rawTokens[2 * j + 1];
    const bg = EncodedTokenMetadata.getForeground(metadata);
    const fg = colorMap[bg];
    const tokenText = lineText.slice(offset, nextOffset);
    resolvedTokens.push([offset, fg, tokenText]);
  }
  return {
    ruleStack: result.ruleStack,
    resolvedTokens,
  };
}

export function renderLineTokens(
  tokens: Array<HighlightedToken>,
  themeType: 'light' | 'dark'
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
      style: `--diffs-token-${themeType}:${fg};`,
      textContent: textContent,
    });
  });
}

// Shiki special-cases `text` and `ansi` in codeToHast but does not expose grammars.
function isGrammarlessLanguage(languageId: string): boolean {
  return languageId === 'text' || languageId === 'ansi';
}
