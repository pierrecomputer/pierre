import {
  createHighlighter,
  type Highlighter,
  type CodeToTokensOptions as HighlightsOptions,
  isSupportedLanguage,
  type Theme,
} from '@pierre/highlights';

import { DiffsHighlighter } from '../DiffsHighlighter';
import { HighlightsEditorTokenizer } from '../highlights-editor';
import { HighlightsStreamTokenizer } from '../highlights-stream';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { DiffsTheme } from '../themes/types';
import type {
  DiffsEditorTokenizerOptions,
  DiffsStreamTokenizer,
} from '../tokenizer-types';
import type { CodeToTokensOptions, TokensResult } from '../types';

/**
 * Highlights bundles its lexers, so there are no grammars to load or attach;
 * unsupported languages, including custom ones, render as text.
 */
export class HighlightsHighlighter extends DiffsHighlighter {
  private readonly raw: Highlighter = createHighlighter();
  // Themes this instance has used stay usable after disposeHighlighter()
  // clears the shared resolver cache underneath a retained instance.
  private readonly usedThemes = new Map<string, DiffsTheme>();

  constructor() {
    super('highlights', createDiffsThemeResolver('highlights'));
  }

  getTheme(name: string): DiffsTheme {
    this.assertNotDisposed();
    const theme =
      this.themeResolver.getResolvedTheme(name) ?? this.usedThemes.get(name);
    if (theme == null) {
      throw new Error(`Theme "${name}" has not been resolved`);
    }
    this.usedThemes.set(name, theme);
    return theme;
  }

  codeToTokens(code: string, options: CodeToTokensOptions): TokensResult {
    this.assertNotDisposed();
    return this.raw.codeToTokens(code, this.resolveOptions(options));
  }

  createEditorTokenizer(
    options: DiffsEditorTokenizerOptions
  ): HighlightsEditorTokenizer {
    this.assertNotDisposed();
    return new HighlightsEditorTokenizer(options, (tokenizerOptions) =>
      this.resolveOptions(tokenizerOptions)
    );
  }

  createStreamTokenizer(options: CodeToTokensOptions): DiffsStreamTokenizer {
    return new HighlightsStreamTokenizer(this.resolveOptions(options));
  }

  loadLanguages(): Promise<void> {
    this.assertNotDisposed();
    return Promise.resolve();
  }

  hasLoadedLanguages(): boolean {
    return !this.disposed;
  }

  attachLanguages(): void {
    this.assertNotDisposed();
  }

  protected releaseResources(): void {
    this.usedThemes.clear();
  }

  // Resolve backend-neutral names to the native Zed theme objects, keeping
  // only the selected theme key so callers may pass both with one undefined.
  private resolveOptions({
    theme,
    themes,
    ...options
  }: CodeToTokensOptions): HighlightsOptions {
    const lang = isSupportedLanguage(options.lang) ? options.lang : 'text';
    if (theme != null) {
      return { ...options, lang, theme: this.getZedTheme(theme) };
    }
    if (themes == null) {
      throw new Error('A theme or themes option is required');
    }
    const resolved: Record<string, Theme> = {};
    for (const [key, name] of Object.entries(themes)) {
      resolved[key] = this.getZedTheme(name);
    }
    return { ...options, lang, themes: resolved };
  }

  private getZedTheme(name: string): Theme {
    const theme = this.getTheme(name);
    if (theme.zed == null) {
      throw new Error(`Theme "${name}" does not support Highlights`);
    }
    return theme.zed;
  }
}
