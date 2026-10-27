import { colorUtils } from '@pierre/theming/color';

import { DEFAULT_THEMES } from '../constants';
import type { DiffsEditorTokenizer } from '../highlighter/DiffsEditorTokenizer';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  HighlightedToken,
  RenderRange,
} from '../types';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import type { TextDocument, TextDocumentChange } from './textDocument';
import { addEventListener } from './utils';

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

/** Applies editor theme CSS and delegates tokenization to the selected backend. */
export class EditorTokenizer {
  #highlighter: DiffsHighlighter;
  readonly #textDocument: TextDocument;
  #tokenizer: DiffsEditorTokenizer;
  #mediaQueryList: MediaQueryList;
  #themeType: 'light' | 'dark' = 'dark';
  #themeName = '';
  #setStyle: EditorTokenizerProps['setStyle'];
  #style = '';
  #onThemeChange: EditorTokenizerProps['onThemeChange'];
  #disposes?: (() => void)[];

  get themeType(): 'light' | 'dark' {
    return this.#themeType;
  }

  get highlighter(): DiffsHighlighter {
    return this.#highlighter;
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
    this.#setStyle = setStyle;
    this.#onThemeChange = onThemeChange;
    this.#setTheme(
      typeof theme === 'string' ? theme : theme[themeType],
      typeof theme === 'string' ? undefined : themeType
    );
    this.#textDocument = textDocument;
    this.#tokenizer = highlighter.createEditorTokenizer({
      textDocument,
      theme: this.#themeName,
      tokenizeMaxLineLength,
      matchBrackets,
      __debug,
      onDeferTokenize: (lines) => onDeferTokenize(lines, this.#themeType),
    });
  }

  // By default, diffs components support dual themes, but the tokenizer only renders
  // the preferred theme. When the theme type is changed, the tokenizer will re-tokenize the document.
  #emitThemeChange(themeName: string, themeType: 'light' | 'dark') {
    if (themeName === this.#themeName && themeType === this.#themeType) {
      return;
    }
    this.#setTheme(themeName, themeType);
    this.#tokenizer.setTheme(themeName);
    // The theme CSS is now applied, so overlay pieces that captured a resolved
    // theme color (e.g. rounded selection corner masks) can recompute against
    // the new colors instead of keeping the old light/dark value.
    this.#onThemeChange?.();
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
      const pinnedThemeType = this.#highlighter.getTheme(theme).type;
      if (theme === this.#themeName && pinnedThemeType === this.#themeType) {
        return;
      }
      this.#emitThemeChange(theme, pinnedThemeType);
      return;
    }
    const nextThemeType =
      themeType === 'system' ? this.#resolveSystemThemeType() : themeType;
    const nextThemeName = theme[nextThemeType];
    if (
      nextThemeType === this.#themeType &&
      nextThemeName === this.#themeName
    ) {
      return;
    }
    this.#emitThemeChange(nextThemeName, nextThemeType);
  }

  #setTheme(themeName: string, themeType?: 'light' | 'dark') {
    const theme = this.#highlighter.getTheme(themeName);
    const { colors = {} } = theme;
    const selectionBackground = colors['editor.selectionBackground'];
    const themeLineHighlightBackground =
      colors['editor.lineHighlightBackground'];
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
    const activeLineSourceMix =
      lineHighlightBackground == null ? '100%' : '85%';
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
    this.#style = `:host {
      --diffs-editor-selection-bg: ${selectionBackground ?? 'var(--diffs-line-bg)'};
      --diffs-editor-line-highlight-border: ${lineHighlightBorder};
      --diffs-editor-active-line-source-mix: ${activeLineSourceMix};
      --diffs-editor-match-bg: ${findMatchBackground ?? 'initial'};
      --diffs-editor-match-highlight-bg: ${findMatchHighlightBackground ?? 'initial'};
      --diffs-editor-bracket-match-bg: ${bracketMatchBackground ?? 'initial'};
      --diffs-editor-bracket-match-border: ${bracketMatchBorder ?? 'initial'};
      --diffs-editor-cursor-fg: ${cursorForeground ?? 'initial'};
      --diffs-editor-hint-fg: ${hintForeground ?? 'initial'};
      --diffs-editor-info-fg: ${infoForeground ?? 'initial'};
      --diffs-editor-warning-fg: ${warningForeground ?? 'initial'};
      --diffs-editor-error-fg: ${errorForeground ?? 'initial'};
    }`;
    this.#setStyle(this.#style);
    this.#themeName = themeName;
    this.#themeType = themeType ?? theme.type;
  }

  // Writes the theme style again, for a style element created after it.
  applyStyle(): void {
    this.#setStyle(this.#style);
  }

  cleanUp(): void {
    this.#tokenizer.dispose();
    this.#disposes?.forEach((dispose) => dispose());
    this.#disposes = undefined;
  }

  tokenize(
    change: TextDocumentChange,
    renderRange?: RenderRange
  ): Map<number, HighlightedToken[]> {
    return this.#tokenizer.tokenize(change, renderRange);
  }

  getStringCommentRegexpRangesInLine(
    lineIndex: number
  ): [number, number][] | null {
    return this.#tokenizer.getStringCommentRegexpRangesInLine(lineIndex);
  }

  // Remembers which lines were last tokenized on demand, and for which
  // version of the document. flush() tokenizes the whole visible range at
  // once, which is the right thing when the user scrolls to new lines or
  // types. It is the wrong thing when a render was triggered by the
  // background tokenizer handing over a finished batch: that render already
  // has its tokens, and tokenizing everything else right then would do all
  // the remaining background work in one blocking pass. So flush() skips the
  // work when the visible range and the document are the same as last time.
  #prepared?: { version: number; renderRange: RenderRange | undefined };

  prebuildStateStack(renderRange?: RenderRange, domCurrent = false): void {
    this.#prepared = { version: this.#textDocument.version, renderRange };
    this.#tokenizer.prebuildStateStack(renderRange, domCurrent);
  }

  flush(renderRange?: RenderRange): Map<number, HighlightedToken[]> {
    const version = this.#textDocument.version;
    const prepared = this.#prepared;
    if (
      prepared != null &&
      prepared.version === version &&
      areRenderRangesEqual(prepared.renderRange, renderRange)
    ) {
      return new Map();
    }
    this.#prepared = { version, renderRange };
    return this.#tokenizer.flush(renderRange);
  }

  pauseBackgroundTokenize(): void {
    this.#tokenizer.pauseBackgroundTokenize();
  }
  resumeBackgroundTokenize(): void {
    this.#tokenizer.resumeBackgroundTokenize();
  }
}
