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

/** Adapt Shiki while keeping its engines, grammars and tokenizers lazy. */
export class ShikiHighlighter extends DiffsHighlighter {
  // Track theme objects so clearing or replacing a resolved theme reloads its
  // token colors without querying Shiki's allocated list of loaded names. The
  // same map keeps a theme usable after disposeHighlighter() clears the
  // shared resolver cache underneath a retained instance.
  private readonly loadedThemes = new Map<string, DiffsTheme>();
  // Names and aliases attached through this instance. Shiki's own registry
  // allocates a fresh list per query, so membership is answered from here.
  private readonly attachedLanguages = new Set(['text', 'ansi']);

  /** Load the selected regex engine, then create the Shiki instance. */
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
      // Passing the object also refreshes Shiki's active theme when its name
      // is unchanged; loading the name alone leaves its token color map stale.
      this.raw.setTheme(textmate);
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
      // Shiki skips a grammar whose name is already loaded, which silently
      // drops a new alias; make sure the requested name resolves.
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

  // Synchronize pre-resolved worker themes before synchronous tokenization and
  // keep only the selected theme key. Callers may pass both keys with one set
  // to undefined; Shiki checks for a `themes` key before `theme` and would
  // then read entries from undefined.
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
