import {
  isSupportedLanguage,
  LiveTokenizer,
  type Theme,
} from '@pierre/highlights';
import { colorUtils } from '@pierre/theming/color';

import { DEFAULT_THEMES } from '../constants';
import { getHighlightsTheme } from '../highlighter/getHighlightsTheme';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  HighlightedToken,
  RenderRange,
} from '../types';
import type { TextDocument, TextDocumentChange } from './textDocument';
import { addEventListener, h } from './utils';

export interface EditorTokenizerProps {
  highlighter: DiffsHighlighter;
  textDocument: TextDocument;
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

/** Incremental syntax tokens and active theme state for one editor document. */
export class EditorTokenizer {
  #highlighter: DiffsHighlighter;
  #tokenizer?: LiveTokenizer;
  #documentRevision = -1;
  #codeOptions: BaseCodeOptions;
  #theme!: Theme;
  #renderRange?: RenderRange;
  #deferredLines?: Map<number, HighlightedToken[]>;
  #mediaQueryList: MediaQueryList;
  #themeType: 'light' | 'dark' = 'dark';
  #themeName = '';
  #textDocument: TextDocument;
  #tokenizeMaxLineLength = 1000;
  #setStyle: EditorTokenizerProps['setStyle'];
  #onDeferTokenize: EditorTokenizerProps['onDeferTokenize'];
  #onThemeChange: EditorTokenizerProps['onThemeChange'];
  #matchBrackets: boolean;
  #disposes?: (() => void)[];
  #isCleanedUp = false;

  get themeType(): 'light' | 'dark' {
    return this.#themeType;
  }

  constructor({
    codeOptions,
    highlighter,
    textDocument,
    matchBrackets,
    setStyle,
    onDeferTokenize,
    onThemeChange,
  }: EditorTokenizerProps) {
    this.#mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    this.#highlighter = highlighter;
    this.#codeOptions = codeOptions;
    this.#textDocument = textDocument;
    this.#setStyle = setStyle;
    this.#onDeferTokenize = onDeferTokenize;
    this.#onThemeChange = onThemeChange;
    this.#matchBrackets = matchBrackets !== false;
    this.syncTheme(codeOptions);
  }

  // Stage the document only when needed; Highlights owns the lexer state and
  // finishes lines beyond the initial viewport in background slices.
  #createTokenizer(
    renderRange: readonly [number, number] = [0, 0]
  ): LiveTokenizer {
    const language = this.#textDocument.languageId;
    this.#documentRevision = this.#textDocument.revision;
    this.#tokenizer = new LiveTokenizer({
      code: this.#textDocument.getText(),
      lang: isSupportedLanguage(language) ? language : 'text',
      theme: this.#theme,
      tokenizeMaxLineLength: this.#tokenizeMaxLineLength,
      renderRange,
      onDeferTokenize: (lines) => this.#queueDeferredLines(lines),
    });
    return this.#tokenizer;
  }

  // Native callbacks can run inside applyEdits. Deliver after the host has
  // realigned its rows, so post-edit line numbers cannot overwrite old rows.
  #queueDeferredLines(lines: Map<number, HighlightedToken[]>): void {
    if (this.#isCleanedUp || lines.size === 0) return;
    if (this.#deferredLines !== undefined) {
      for (const [line, tokens] of lines) this.#deferredLines.set(line, tokens);
      return;
    }
    this.#deferredLines = lines;
    queueMicrotask(() => {
      if (this.#deferredLines === lines) this.#deliverDeferredLines();
    });
  }

  #deliverDeferredLines(): void {
    const lines = this.#deferredLines;
    this.#deferredLines = undefined;
    if (lines !== undefined) this.#onDeferTokenize(lines, this.#themeType);
  }

  // Respect an explicit host color-scheme override. When the computed value
  // advertises support for both schemes, let the OS preference choose one.
  #resolveSystemThemeType(): 'light' | 'dark' {
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

  // Rebind system observers to the current options and rebuild native theme
  // state only when the selected theme or tokenization limit changes.
  syncTheme(codeOptions: BaseCodeOptions): void {
    if (this.#isCleanedUp) return;
    const {
      themeType = 'system',
      theme = DEFAULT_THEMES,
      tokenizeMaxLineLength = 1000,
    } = codeOptions;
    this.#codeOptions = codeOptions;
    const followsSystem = typeof theme !== 'string' && themeType === 'system';
    if (followsSystem && this.#disposes === undefined) {
      const observer = new MutationObserver((mutations) => {
        if (
          mutations.some(
            ({ attributeName }) =>
              attributeName === 'class' ||
              attributeName === 'style' ||
              attributeName?.startsWith('data-') === true
          )
        )
          this.syncTheme(this.#codeOptions);
      });
      observer.observe(document.documentElement, { attributes: true });
      observer.observe(document.body, { attributes: true });
      this.#disposes = [
        addEventListener(this.#mediaQueryList, 'change', () =>
          this.syncTheme(this.#codeOptions)
        ),
        () => observer.disconnect(),
      ];
    } else if (!followsSystem && this.#disposes !== undefined) {
      for (const dispose of this.#disposes) dispose();
      this.#disposes = undefined;
    }
    const mode =
      themeType === 'system' ? this.#resolveSystemThemeType() : themeType;
    const themeName = typeof theme === 'string' ? theme : theme[mode];
    const resolved = getHighlightsTheme(this.#highlighter.getTheme(themeName));
    const appearance =
      typeof theme === 'string'
        ? resolved.appearance === 'light'
          ? 'light'
          : 'dark'
        : mode;
    if (
      themeName === this.#themeName &&
      appearance === this.#themeType &&
      tokenizeMaxLineLength === this.#tokenizeMaxLineLength &&
      resolved === this.#theme
    )
      return;
    const initialized = this.#theme !== undefined;
    this.#tokenizer?.dispose();
    this.#tokenizer = undefined;
    this.#deferredLines = undefined;
    this.#theme = resolved;
    this.#themeName = themeName;
    this.#themeType = appearance;
    this.#tokenizeMaxLineLength = tokenizeMaxLineLength;
    const colors = this.#theme.style;
    const player = colors.players?.[0];
    const background = colors['editor.active_line.background'];
    const lineHighlightBackground =
      background != null &&
      background.trim() !== '' &&
      !colorUtils.isFullyTransparent(background)
        ? background
        : undefined;
    const lineHighlightBorder =
      typeof colors['editor.active_line.border'] === 'string'
        ? colors['editor.active_line.border']
        : lineHighlightBackground == null
          ? 'color-mix(in lab, var(--diffs-bg) 70%, var(--diffs-fg))'
          : 'transparent';
    this.#setStyle(`:host {
      --diffs-editor-selection-bg: ${player?.selection ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-border: ${lineHighlightBorder};
      --diffs-editor-active-line-source-mix: ${lineHighlightBackground == null ? '100%' : '85%'};
      --diffs-editor-match-bg: ${colors['search.match_background'] ?? 'initial'};
      --diffs-editor-match-highlight-bg: ${colors['search.match_background'] ?? 'initial'};
      --diffs-editor-bracket-match-bg: ${colors['editor.document_highlight.bracket_background'] ?? 'initial'};
      --diffs-editor-bracket-match-border: ${typeof colors['editor.document_highlight.bracket_border'] === 'string' ? colors['editor.document_highlight.bracket_border'] : 'initial'};
      --diffs-editor-cursor-fg: ${player?.cursor ?? 'initial'};
      --diffs-editor-hint-fg: ${colors.hint ?? 'initial'};
      --diffs-editor-info-fg: ${colors.info ?? 'initial'};
      --diffs-editor-warning-fg: ${colors.warning ?? 'initial'};
      --diffs-editor-error-fg: ${colors.error ?? 'initial'};
    }`);
    if (initialized) {
      this.prebuildTokens(this.#renderRange);
      if (this.#renderRange !== undefined) {
        const { startingLine, totalLines } = this.#renderRange;
        this.#queueDeferredLines(
          this.#readLines(
            0,
            Math.min(startingLine + totalLines, this.#textDocument.lineCount)
          )
        );
      }
      this.#onThemeChange?.();
    }
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    if (
      !this.#matchBrackets ||
      this.#isCleanedUp ||
      lineIndex < 0 ||
      lineIndex >= this.#textDocument.lineCount
    )
      return null;
    // Bracket matching needs the current lexer state, including deferred edits
    // before this line. Finish those edits before consulting the token ranges.
    const tokenizer = this.#tokenizer ?? this.#createTokenizer();
    if (tokenizer.pendingTokenization) tokenizer.flush();
    const { bracketIgnoredRanges } = tokenizer.getLineTokens(lineIndex);
    return bracketIgnoredRanges.length === 0 ? null : bracketIgnoredRanges;
  }

  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange,
    hostRealignsRows = false
  ): Map<number, Array<HighlightedToken>> {
    if (this.#isCleanedUp) return new Map();
    // A second edit in this turn starts with rows from the preceding edit.
    // Finish that delivery before moving the native document forward again.
    this.#deliverDeferredLines();
    this.#renderRange = renderRange;
    const { startingLine = 0, totalLines = Infinity } = renderRange ?? {};
    const endLine = Math.min(
      startingLine + totalLines,
      this.#textDocument.lineCount
    );
    const options = {
      renderRange: [startingLine, Math.max(startingLine, endLine)] as const,
    };
    let lines: Map<number, HighlightedToken[]>;
    if (this.#tokenizer === undefined) {
      this.#createTokenizer(options.renderRange);
      lines = this.#readLines(startingLine, endLine);
    } else if (this.#documentRevision === this.#textDocument.revision) {
      // A redraw reads retained tokens. The native API only exposes flush for
      // completing pending work without edits; it does not need a new document.
      if (this.#tokenizer.pendingTokenization) this.#tokenizer.flush();
      this.#tokenizer.resume();
      lines = this.#readLines(startingLine, endLine);
    } else {
      lines = (
        change.changes.length > 0 &&
        this.#textDocument.revision === this.#documentRevision + 1
          ? this.#tokenizer.applyEdits(
              change.changes.map(({ range, text }) => ({
                range,
                newText: text,
              })),
              options
            )
          : this.#tokenizer.reset(this.#textDocument.getText(), options)
      ).lines;
    }
    this.#documentRevision = this.#textDocument.revision;
    // Hosts that replace rows need every shifted visible line even when its
    // lexer state converges immediately. Virtualized hosts realign these rows.
    if (change.lineDelta !== 0 && !hostRealignsRows) {
      this.#readLines(Math.max(startingLine, change.startLine), endLine, lines);
    } else if (
      change.lineDelta === 0 &&
      change.changedLineChanges?.some(([, , delta]) => delta !== 0) === true
    ) {
      // Net-zero batches still move intermediate rows. Hosts do not realign
      // their caches for these batches, including rows outside the viewport.
      const moved = this.#readLines(change.startLine, change.endLine + 1);
      for (const [line, tokens] of moved) {
        if (line >= startingLine && line < endLine) {
          lines.set(line, tokens);
          moved.delete(line);
        }
      }
      this.#queueDeferredLines(moved);
    }
    return lines;
  }

  // Convert cached native tokens only for rows the host needs to paint.
  #readLines(
    start: number,
    end: number,
    lines = new Map<number, HighlightedToken[]>()
  ): Map<number, HighlightedToken[]> {
    for (let line = start; line < end; line++) {
      if (lines.has(line)) continue;
      const { tokens } = this.#tokenizer!.getLineTokens(line);
      lines.set(
        line,
        tokens.length > 0
          ? tokens.map(({ offset, color, content }) => [
              offset,
              color ?? '',
              content,
            ])
          : [[0, '', '']]
      );
    }
    return lines;
  }

  prebuildTokens(renderRange?: RenderRange): void {
    if (this.#isCleanedUp) return;
    this.#renderRange = renderRange;
    if (this.#tokenizer === undefined) {
      const { startingLine = 0, totalLines = 0 } = renderRange ?? {};
      const end = Math.min(
        startingLine + totalLines,
        this.#textDocument.lineCount
      );
      // Existing rows already carry highlighted markup. Seed their lexer state
      // without replaying those rows into the host's render cache.
      this.#createTokenizer([0, end]);
    }
    this.#tokenizer!.resume();
  }

  stopBackgroundTokenize(): void {
    this.#tokenizer?.pause();
  }

  pauseBackgroundTokenize(): void {
    this.#tokenizer?.pause();
  }

  resumeBackgroundTokenize(): void {
    if (!this.#isCleanedUp) this.#tokenizer?.resume();
  }

  cleanUp(): void {
    this.#isCleanedUp = true;
    this.#tokenizer?.dispose();
    this.#tokenizer = undefined;
    this.#deferredLines = undefined;
    this.#disposes?.forEach((dispose) => dispose());
    this.#disposes = undefined;
  }
}

export function renderLineTokens(
  tokens: Array<HighlightedToken>
): (HTMLElement | string)[] {
  return tokens.map(([char, fg, textContent]) => {
    if (textContent === '') return h('br');
    if (char === 0 && fg === '') {
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
