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
  ThemesType,
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
  #editorEventDisposes?: (() => void)[];

  // state
  #stateStackCache: StateStack[] = [INITIAL];
  #lastLine: number = -1;
  #isStopped: boolean = true;
  #backgroundJobId: number = 0;
  #backgroundChangedLineRanges: readonly [number, number][] | undefined;
  #backgroundChangedRangeIndex: number = 0;

  #prebuildStateStackMap = debounce(async (renderRange?: RenderRange) => {
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const endLine = Math.min(
      totalLines === Infinity ? Infinity : startingLine + totalLines,
      this.#textDocument.lineCount
    );
    if (this.#grammar === undefined) {
      await this.#highlighter.loadLanguage(this.#textDocument.languageId);
      this.#grammar = this.#highlighter.getLanguage(
        this.#textDocument.languageId
      );
    }
    this.#buildStateStackMap(endLine);
  }, 500);

  #onMessage = ({
    data,
  }: MessageEvent<{ type: 'tokenize'; jobId: number }>) => {
    if (data.type === 'tokenize' && data.jobId === this.#backgroundJobId) {
      this.#backgroundTokenize(data.jobId);
    }
  };

  // By default, diffs components support dual themes, but the tokenizer only renders
  // the preferred theme. When the theme type is changed, the tokenizer will re-tokenize the document.
  #onThemeChange = (themeName: string, themeType: 'light' | 'dark') => {
    this.#themeType = themeType;
    this.#setTheme(themeName);
    this.stopBackgroundTokenize();
    this.#stateStackCache = [INITIAL];
    if (this.#grammar !== undefined && this.#textDocument.lineCount > 0) {
      this.#scheduleBackgroundTokenize(0);
    }
  };

  #setTheme = (themeName: string): void => {
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
    this.#setStyle(`:host {
      --diffs-editor-selection-bg: ${selectionBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-bg: ${lineHighlightBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-number-fg: ${gutterForeground ?? 'var(--diffs-fg-number)'};
      --diffs-editor-line-number-active-bg: ${lineHighlightBackground ?? 'var(--diffs-line-bg, var(--diffs-bg))'};
      --diffs-editor-line-number-active-fg: ${gutterActiveForeground ?? 'var(--diffs-selection-number-fg)'};
      ${cursorForeground !== undefined ? '--diffs-editor-cursor-fg: ' + cursorForeground : ''};
      ${findMatchBackground !== undefined ? '--diffs-editor-find-match-bg: ' + findMatchBackground : ''};
      ${findMatchHighlightBackground !== undefined ? '--diffs-editor-find-match-highlight-bg: ' + findMatchHighlightBackground : ''};
    }`);
  };

  #watchColorScheme = (theme: ThemesType) => {
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
          this.#onThemeChange(theme[themeType], themeType);
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    this.#editorEventDisposes = [
      addEventListener(this.#mediaQueryList, 'change', (e) => {
        const themeType = e.matches ? 'dark' : 'light';
        this.#onThemeChange(theme[themeType], themeType);
      }),
      () => observer.disconnect(),
    ];
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
      this.#watchColorScheme(theme);
    }
    this.#highlighter = highlighter;
    this.#textDocument = textDocument;
    this.#tokenizeMaxLineLength = tokenizeMaxLineLength;
    this.#setStyle = setStyle;
    this.#onDeferTokenize = onDeferTokenize;
    if (highlighter.getLoadedLanguages().includes(textDocument.languageId)) {
      this.#grammar = highlighter.getLanguage(textDocument.languageId);
    }
    this.#colorMap = [];
    this.#setTheme(typeof theme === 'string' ? theme : theme[this.#themeType]);
  }

  cleanUp(): void {
    this.stopBackgroundTokenize();
    this.#editorEventDisposes?.forEach((dispose) => dispose());
    this.#editorEventDisposes = undefined;
  }

  // to use `tokenize`, call `prebuildStateStackMap` first to prebuild
  // the state stack map for the given render range.
  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, Array<HighlightedToken>> {
    if (this.#grammar === undefined) {
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
      this.#buildStateStackMap(dirtyStart);
    } else {
      this.#stateStackCache.length = Math.min(
        this.#stateStackCache.length,
        dirtyStart + 1
      );
      if (renderRange === undefined || dirtyStart >= viewStart) {
        this.#buildStateStackMap(viewStart);
      }
    }

    let changedRangeIndex = 0;
    let currentChangedRangeEnd = changedLineRanges[changedRangeIndex][1];
    let backgroundStartLine: number | undefined;
    let backgroundChangedRangeIndex = 0;
    let line = canReuseCachedStates
      ? changedLineRanges[changedRangeIndex][0]
      : viewStart;
    let state = this.#stateStackCache[line] ?? INITIAL;
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
        this.#buildStateStackMap(offscreenEnd);
        let offscreenLine = dirtyStart;
        let offscreenState = this.#stateStackCache[offscreenLine] ?? INITIAL;
        for (; offscreenLine < offscreenEnd; offscreenLine++) {
          const resolved = this.#tokenizeLineAt(offscreenLine, offscreenState);
          offscreenState = resolved.state;
          offscreenDirtyLines.set(offscreenLine, resolved.resolvedTokens);
        }
        if (canCacheTokenizedStates) {
          this.#stateStackCache[offscreenEnd] = offscreenState;
        }
      }
    }
    for (; line < renderRangeEndLine; ) {
      const previousNextState = canReuseCachedStates
        ? this.#stateStackCache[line + 1]
        : undefined;
      if (canCacheTokenizedStates) {
        this.#stateStackCache[line] = state;
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
        this.#stateStackCache[line + 1] = state;
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
        if (this.#stateStackCache[nextRange[0]] === undefined) {
          currentChangedRangeEnd = nextRange[1];
          line++;
        } else {
          line = nextRange[0];
          state = this.#stateStackCache[line] ?? state;
          currentChangedRangeEnd = nextRange[1];
        }
        settled = false;
        continue;
      }
      line++;
    }

    if (canCacheTokenizedStates) {
      if (line < renderRangeEndLine) {
        this.#stateStackCache[line + 1] = state;
      } else {
        this.#stateStackCache[line] = state;
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

  prebuildStateStackMap(renderRange?: RenderRange): void {
    this.#prebuildStateStackMap(renderRange);
  }

  stopBackgroundTokenize(): void {
    removeEventListener('message', this.#onMessage);
    this.#isStopped = true;
    this.#lastLine = -1;
    this.#backgroundChangedLineRanges = undefined;
    this.#backgroundChangedRangeIndex = 0;
  }

  #scheduleBackgroundTokenize(
    startLine: number,
    changedLineRanges?: readonly [number, number][],
    changedRangeIndex = 0
  ): void {
    const jobId = ++this.#backgroundJobId;

    this.#isStopped = false;
    this.#lastLine = startLine;
    this.#backgroundChangedLineRanges = changedLineRanges;
    this.#backgroundChangedRangeIndex = changedRangeIndex;

    globalThis.addEventListener('message', this.#onMessage);
    this.#postBackgroundTokenizeMessage(jobId);
  }

  #postBackgroundTokenizeMessage(jobId: number): void {
    // use `postMessage` instead of `setTimeout(fn, 0)` to avoid 4ms delay
    globalThis.postMessage({ type: 'tokenize', jobId });
  }

  #tokenizeLineAt(
    line: number,
    state: StateStack
  ): { resolvedTokens: Array<HighlightedToken>; state: StateStack } {
    if (this.#grammar === undefined) {
      throw new Error('Grammar not loaded');
    }
    const lineText = this.#textDocument.getLineText(line);
    if (lineText.length > this.#tokenizeMaxLineLength) {
      console.warn(
        `[diffs] Line(${line}) too long to tokenize: ${lineText.length}`
      );
      return { resolvedTokens: [[0, '', lineText]], state };
    }
    if (lineText === '' || lineText.trim() === '') {
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

  #buildStateStackMap(endAt: number) {
    const boundedEndAt = Math.min(
      Math.max(0, endAt),
      this.#textDocument.lineCount
    );
    if (
      this.#stateStackCache.length > boundedEndAt ||
      this.#grammar === undefined
    ) {
      return;
    }
    let line = this.#stateStackCache.length - 1;
    let state = this.#stateStackCache[line] ?? INITIAL;
    for (; line < boundedEndAt; line++) {
      this.#stateStackCache[line] = state;
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
    this.#stateStackCache[line] = state;
  }

  #backgroundTokenize(jobId: number) {
    if (
      this.#isStopped ||
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
    let state = this.#stateStackCache[line] ?? INITIAL;
    let settled = false;
    let changedRangeIndex = this.#backgroundChangedRangeIndex;
    let currentChangedRangeEnd = changedLineRanges?.[changedRangeIndex]?.[1];
    for (; line < totalLines; ) {
      this.#stateStackCache[line] = state;

      const previousNextState =
        currentChangedRangeEnd !== undefined
          ? this.#stateStackCache[line + 1]
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

      this.#stateStackCache[line + 1] = state;
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
        if (this.#stateStackCache[nextRange[0]] === undefined) {
          settled = false;
        } else {
          line = nextRange[0];
          state = this.#stateStackCache[line] ?? state;
          settled = false;
          continue;
        }
      }

      // limit the time of partial tokenize to 2ms
      if (performance.now() - t > 2) {
        break;
      }
    }

    this.#onDeferTokenize(lines, this.#themeType);
    if (this.#isStopped || jobId !== this.#backgroundJobId) {
      return;
    }

    if (settled || line >= totalLines) {
      this.stopBackgroundTokenize();
      return;
    }

    this.#lastLine = line;
    this.#backgroundChangedRangeIndex = changedRangeIndex;
    this.#postBackgroundTokenizeMessage(jobId);
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
