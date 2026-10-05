import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type CodeToTokensOptions as ShikiCodeToTokensOptions,
} from 'shiki/core';

import type { ResolvedLanguage } from '../../worker/types';
import { DiffsHighlighter } from '../DiffsHighlighter';
import { attachResolvedLanguages } from '../languages/attachResolvedLanguages';
import { RegisteredCustomLanguages } from '../languages/constants';
import { resolveLanguages } from '../languages/resolveLanguages';
import { ShikiEditorTokenizer } from '../shiki-editor';
import { ShikiStreamTokenizer } from '../shiki-stream';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { DiffsTheme } from '../themes/types';
import type {
  DiffsEditorTokenizerOptions,
  DiffsStreamTokenizer,
} from '../tokenizer-types';
import type { CodeToTokensOptions, TokensResult } from '../types';

type ShikiHighlighterTypes = 'shiki-js' | 'shiki-wasm';

export class ShikiHighlighter extends DiffsHighlighter {
  // Compare theme objects to detect replacements, and retain them when the
  // shared cache is cleared.
  private readonly loadedThemes = new Map<string, DiffsTheme>();
  // Shiki allocates a new language list on each lookup.
  private readonly attachedLanguages = new Set(['text', 'ansi']);

  static async create(name: ShikiHighlighterTypes): Promise<ShikiHighlighter> {
    const engine =
      name === 'shiki-wasm'
        ? (await import('shiki/engine/oniguruma')).createOnigurumaEngine(
            import('shiki/wasm')
          )
        : (
            await import('shiki/engine/javascript')
          ).createJavaScriptRegexEngine();
    const raw = await createHighlighterCore({ themes: [], langs: [], engine });
    return new ShikiHighlighter(name, raw);
  }

  private constructor(
    name: ShikiHighlighterTypes,
    private readonly raw: HighlighterCore
  ) {
    super(name, createDiffsThemeResolver(name));
  }

  getTheme(themeName: string): DiffsTheme {
    this.assertNotDisposed();
    const loaded = this.loadedThemes.get(themeName);
    const theme = this.themeResolver.getResolvedTheme(themeName) ?? loaded;
    if (theme == null) {
      throw new Error(`Theme "${themeName}" has not been resolved`);
    }
    if (loaded !== theme) {
      const textmate =
        theme.textmate ??
        (theme.cssVariables != null
          ? createCssVariablesTheme(theme.cssVariables)
          : undefined);
      if (textmate == null) {
        throw new Error(`Theme "${themeName}" does not support Shiki`);
      }
      // Pass the object to refresh colors, using the name tokenization looks up.
      this.raw.setTheme({ ...textmate, name: themeName });
      this.loadedThemes.set(themeName, theme);
    }
    return theme;
  }

  codeToTokens(code: string, options: CodeToTokensOptions): TokensResult {
    return this.raw.codeToTokens(code, this.resolveOptions(options));
  }

  createEditorTokenizer(
    options: DiffsEditorTokenizerOptions
  ): ShikiEditorTokenizer {
    return new ShikiEditorTokenizer(this.raw, options, this);
  }

  createStreamTokenizer(options: CodeToTokensOptions): DiffsStreamTokenizer {
    return new ShikiStreamTokenizer(this.raw, this.resolveOptions(options));
  }

  async loadLanguages(languages: readonly string[]): Promise<void> {
    this.assertNotDisposed();
    const missing = languages.filter(
      (language) => !this.attachedLanguages.has(language)
    );
    attachResolvedLanguages(await resolveLanguages(missing), this);
  }

  hasLoadedLanguages(languages: readonly string[]): boolean {
    if (this.disposed) {
      return false;
    }
    // Custom registrations count only when attached here; bundled grammars
    // loaded on the raw instance by other code are found in Shiki's list.
    let loaded: string[] | undefined;
    return languages.every((lang) => {
      if (this.attachedLanguages.has(lang)) {
        return true;
      }
      if (RegisteredCustomLanguages.has(lang)) {
        return false;
      }
      loaded ??= this.raw.getLoadedLanguages();
      return loaded.includes(lang);
    });
  }

  attachLanguages(languages: readonly ResolvedLanguage[]): void {
    this.assertNotDisposed();
    for (const lang of languages) {
      if (this.attachedLanguages.has(lang.name)) {
        continue;
      }
      const grammar = lang.data.find(
        (grammar) =>
          grammar.name === lang.name ||
          grammar.aliases?.includes(lang.name) === true
      );
      if (grammar == null) {
        throw new Error(
          `attachResolvedLanguages: No returned grammar declares "${lang.name}" as its name or an alias.`
        );
      }
      this.raw.loadLanguageSync(lang.data);
      // Shiki skips loaded grammars, which can leave new aliases unregistered.
      try {
        this.raw.getLanguage(lang.name);
      } catch {
        throw new Error(
          `attachResolvedLanguages: "${grammar.name}" is already loaded without alias "${lang.name}". Load the alias first or give the grammar a unique name.`
        );
      }
      this.attachedLanguages.add(lang.name);
    }
  }

  protected releaseResources(): void {
    this.loadedThemes.clear();
    this.attachedLanguages.clear();
    this.raw.dispose();
  }

  // Attach resolved themes before tokenizing. Omit the unused key because
  // Shiki treats `themes: undefined` as a request for multiple themes.
  private resolveOptions({
    theme,
    themes,
    ...options
  }: CodeToTokensOptions): ShikiCodeToTokensOptions {
    this.assertNotDisposed();
    if (theme != null) {
      this.getTheme(theme);
      return { ...options, theme };
    }
    if (themes == null) {
      throw new Error('A theme or themes option is required');
    }
    for (const name of Object.values(themes)) {
      this.getTheme(name);
    }
    return { ...options, themes };
  }
}
