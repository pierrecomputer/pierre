import {
  codeToTokens,
  type CodeToTokensOptions as HighlightsOptions,
  isSupportedLanguage,
  registerLanguages,
  type Theme,
} from '@pierre/highlights';

import type { ResolvedLanguage } from '../../worker';
import { DiffsHighlighter } from '../DiffsHighlighter';
import { HighlightsEditorTokenizer } from '../highlights-editor';
import { HighlightsStreamTokenizer } from '../highlights-stream';
import { RegisteredHighlightsLanguages } from '../languages/constants';
import { resolveHighlightsLanguages } from '../languages/resolveHighlightsLanguages';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { DiffsTheme } from '../themes/types';
import type {
  DiffsEditorTokenizerOptions,
  DiffsStreamTokenizer,
} from '../tokenizer-types';
import type { CodeToTokensOptions, TokensResult } from '../types';

/**
 * Highlights uses bundled lexers and lexers registered with the `'highlights'`
 * type. Other languages render as text, and stream and editor tokenizers use
 * bundled lexers only.
 */
export class HighlightsHighlighter extends DiffsHighlighter {
  // Independent instances need their themes after the shared cache is cleared.
  private readonly usedThemes = new Map<string, DiffsTheme>();
  private readonly attachedLanguages = new Set<string>();

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
    // Warning: use the library's shared Wasm instance. It replaces instances
    // above 8 MiB; a private instance keeps its peak memory.
    const resolved = this.resolveOptions(options);
    return codeToTokens(
      code,
      this.attachedLanguages.has(options.lang)
        ? { ...resolved, lang: options.lang }
        : resolved
    );
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

  async loadLanguages(languages: readonly string[]): Promise<void> {
    this.assertNotDisposed();
    this.attachLanguages(
      await resolveHighlightsLanguages(
        languages.filter((lang) => !this.attachedLanguages.has(lang))
      )
    );
  }

  hasLoadedLanguages(languages: readonly string[]): boolean {
    return (
      !this.disposed &&
      languages.every(
        (lang) =>
          this.attachedLanguages.has(lang) ||
          !RegisteredHighlightsLanguages.has(lang)
      )
    );
  }

  attachLanguages(languages: readonly ResolvedLanguage[]): void {
    this.assertNotDisposed();
    const names: string[] = [];
    const lexers = [];
    for (const { name, highlights } of languages) {
      if (highlights == null || this.attachedLanguages.has(name)) continue;
      const lower = name.toLowerCase();
      if (
        !Object.keys(highlights.aliases).some(
          (alias) => alias.toLowerCase() === lower
        )
      ) {
        throw new Error(
          `attachResolvedLanguages: The Highlights lexer "${highlights.name}" does not declare "${name}" as an alias.`
        );
      }
      names.push(name);
      lexers.push(highlights);
    }
    if (lexers.length === 0) return;
    // Registration is global, so every instance shares the lexers.
    registerLanguages(lexers);
    for (const name of names) this.attachedLanguages.add(name);
  }

  protected releaseResources(): void {
    this.usedThemes.clear();
    this.attachedLanguages.clear();
  }

  // Omit the unused theme key; callers may pass both keys with one undefined.
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
