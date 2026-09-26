import {
  createCssVariablesTheme,
  createHighlighterCore,
  type CodeToTokensOptions as ShikiCodeToTokensOptions,
} from 'shiki/core';

import { tokensToHtml } from '../../utils/tokensToHtml';
import { attachResolvedLanguages } from '../languages/attachResolvedLanguages';
import { RegisteredCustomLanguages } from '../languages/constants';
import { resolveLanguages } from '../languages/resolveLanguages';
import { ShikiLiveTokenizer } from '../shiki-live';
import { ShikiStreamTokenizer } from '../shiki-stream';
import { createDiffsThemeResolver } from '../themes/themeResolver';
import type { DiffsTheme } from '../themes/types';
import type { CodeToTokensOptions, DiffsHighlighter } from '../types';

/** Adapt Shiki while keeping its engines, grammars and tokenizers lazy. */
export async function createShikiHighlighter(
  name: 'shiki-js' | 'shiki-wasm'
): Promise<DiffsHighlighter> {
  const engine =
    name === 'shiki-wasm'
      ? (await import('shiki/engine/oniguruma')).createOnigurumaEngine(
          import('shiki/wasm')
        )
      : (await import('shiki/engine/javascript')).createJavaScriptRegexEngine();
  const raw = await createHighlighterCore({
    themes: [],
    langs: [],
    engine,
  });
  const themeResolver = createDiffsThemeResolver(name);
  // Track theme objects so clearing or replacing a resolved theme reloads its
  // token colors without querying Shiki's allocated list of loaded names. The
  // same map keeps a theme usable after disposeHighlighter() clears the
  // shared resolver cache underneath a retained instance.
  const loadedThemes = new Map<string, DiffsTheme>();
  // Names and aliases attached through this instance. Shiki's own registry
  // allocates a fresh list per query, so membership is answered from here.
  const attachedLanguages = new Set(['text', 'ansi']);
  let disposed = false;
  const highlighter: DiffsHighlighter = {
    name,
    themeResolver,
    getTheme(themeName) {
      if (disposed) throw new Error('Highlighter is disposed');
      const loaded = loadedThemes.get(themeName);
      const theme = themeResolver.getResolvedTheme(themeName) ?? loaded;
      if (theme == null)
        throw new Error(`Theme "${themeName}" has not been resolved`);
      if (loaded !== theme) {
        const textmate =
          theme.textmate ??
          (theme.cssVariables != null
            ? createCssVariablesTheme(theme.cssVariables)
            : undefined);
        if (textmate == null)
          throw new Error(`Theme "${themeName}" does not support Shiki`);
        // Passing the object also refreshes Shiki's active theme when its name
        // is unchanged; loading the name alone leaves its token color map stale.
        raw.setTheme(textmate);
        loadedThemes.set(themeName, theme);
      }
      return theme;
    },
    codeToTokens(code, options) {
      return raw.codeToTokens(code, resolveOptions(options));
    },
    codeToHtml(code, options) {
      return tokensToHtml(
        code,
        highlighter.codeToTokens(code, options),
        options
      );
    },
    createLiveTokenizer(options) {
      return new ShikiLiveTokenizer(raw, options, highlighter);
    },
    createStreamTokenizer(options) {
      return new ShikiStreamTokenizer(raw, resolveOptions(options));
    },
    async loadLanguages(languages) {
      if (disposed) throw new Error('Highlighter is disposed');
      const missing = languages.filter(
        (language) => !attachedLanguages.has(language)
      );
      attachResolvedLanguages(await resolveLanguages(missing), highlighter);
    },
    hasLoadedLanguages(languages) {
      if (disposed) return false;
      // Custom registrations count only when attached here; bundled grammars
      // loaded on the raw instance by other code are found in Shiki's list.
      let loaded: string[] | undefined;
      return languages.every((lang) => {
        if (attachedLanguages.has(lang)) return true;
        if (RegisteredCustomLanguages.has(lang)) return false;
        loaded ??= raw.getLoadedLanguages();
        return loaded.includes(lang);
      });
    },
    attachLanguages(languages) {
      if (disposed) throw new Error('Highlighter is disposed');
      for (const lang of languages) {
        if (attachedLanguages.has(lang.name)) continue;
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
        raw.loadLanguageSync(lang.data);
        // Shiki skips a grammar whose name is already loaded, which silently
        // drops a new alias; make sure the requested name resolves.
        try {
          raw.getLanguage(lang.name);
        } catch {
          throw new Error(
            `attachResolvedLanguages: "${grammar.name}" is already loaded without alias "${lang.name}". Load the alias first or give the grammar a unique name.`
          );
        }
        attachedLanguages.add(lang.name);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      loadedThemes.clear();
      attachedLanguages.clear();
      raw.dispose();
    },
  };
  return highlighter;

  // Synchronize pre-resolved worker themes before synchronous tokenization and
  // keep only the selected theme key. Callers may pass both keys with one set
  // to undefined; Shiki checks for a `themes` key before `theme` and would
  // then read entries from undefined.
  function resolveOptions({
    theme,
    themes,
    ...options
  }: CodeToTokensOptions): ShikiCodeToTokensOptions {
    if (disposed) throw new Error('Highlighter is disposed');
    if (theme != null) {
      highlighter.getTheme(theme);
      return { ...options, theme };
    }
    if (themes == null) throw new Error('A theme or themes option is required');
    for (const name of Object.values(themes)) highlighter.getTheme(name);
    return { ...options, themes };
  }
}
