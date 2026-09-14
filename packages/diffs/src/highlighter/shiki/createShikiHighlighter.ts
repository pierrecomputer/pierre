import { createThemeResolver, type ThemeLoader } from '@pierre/theming';
import {
  createHighlighterCore,
  type DynamicImportLanguageRegistration,
  isSpecialLang,
  type RegexEngine,
} from 'shiki/core';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

import type { DiffsHighlighter, DiffsTheme } from '../../types';
import { getShikiOptions } from './getShikiOptions';
import { ShikiLiveTokenizer } from './ShikiLiveTokenizer';
import { ShikiStreamTokenizer } from './ShikiStreamTokenizer';

const pierreThemes: Record<string, ThemeLoader<DiffsTheme>> = {
  'pierre-dark': () => import('@pierre/theme/pierre-dark'),
  'pierre-dark-soft': () => import('@pierre/theme/pierre-dark-soft'),
  'pierre-dark-vibrant': () => import('@pierre/theme/pierre-dark-vibrant'),
  'pierre-dark-protanopia-deuteranopia': () =>
    import('@pierre/theme/pierre-dark-protanopia-deuteranopia'),
  'pierre-dark-tritanopia': () =>
    import('@pierre/theme/pierre-dark-tritanopia'),
  'pierre-light': () => import('@pierre/theme/pierre-light'),
  'pierre-light-soft': () => import('@pierre/theme/pierre-light-soft'),
  'pierre-light-vibrant': () => import('@pierre/theme/pierre-light-vibrant'),
  'pierre-light-protanopia-deuteranopia': () =>
    import('@pierre/theme/pierre-light-protanopia-deuteranopia'),
  'pierre-light-tritanopia': () =>
    import('@pierre/theme/pierre-light-tritanopia'),
};

/** Share theme resolution and lazy grammar loading between Shiki's engines. */
export async function createShikiHighlighter(
  name: 'shiki-wasm' | 'shiki-js',
  engine: RegexEngine | Promise<RegexEngine>,
  customThemeLoaders?: ReadonlyMap<string, ThemeLoader<DiffsTheme>>,
  customLanguageLoaders?: ReadonlyMap<string, DynamicImportLanguageRegistration>
): Promise<DiffsHighlighter> {
  const highlighter = await createHighlighterCore({
    engine,
    themes: [],
    langs: [],
  });
  const languageLoaders = bundledLanguages as Record<
    string,
    (typeof bundledLanguages)['typescript']
  >;
  const themeLoaders = bundledThemes as Record<string, ThemeLoader<DiffsTheme>>;
  const loadingLanguages = new Map<string, Promise<void>>();
  const loadedCustomLanguages = new Set<string>();
  let loadedLanguages = new Set<string>();
  const themeResolver = createThemeResolver<DiffsTheme>({
    fallbackLoader: (themeName) =>
      customThemeLoaders?.get(themeName) ??
      (Object.hasOwn(pierreThemes, themeName)
        ? pierreThemes[themeName]
        : Object.hasOwn(themeLoaders, themeName)
          ? themeLoaders[themeName]
          : undefined),
    normalizeTheme(theme, themeName) {
      if ('appearance' in theme && 'style' in theme) {
        throw new Error('Theme "' + themeName + '" is not a Shiki theme');
      }
      highlighter.loadThemeSync({ ...theme, name: themeName });
      return highlighter.getTheme(themeName);
    },
  });
  return {
    name,
    themeResolver,
    createLiveTokenizer(options) {
      return new ShikiLiveTokenizer(highlighter, options);
    },
    createStreamTokenizer(options) {
      return new ShikiStreamTokenizer(highlighter, options);
    },
    async loadLanguages(languages) {
      await Promise.all(
        languages.map((lang) => {
          const customLoader = customLanguageLoaders?.get(lang);
          const loader =
            customLoader ??
            (Object.hasOwn(languageLoaders, lang)
              ? languageLoaders[lang]
              : undefined);
          if (
            isSpecialLang(lang) ||
            (customLoader != null
              ? loadedCustomLanguages
              : loadedLanguages
            ).has(lang) ||
            loader == null
          )
            return Promise.resolve();
          let loading = loadingLanguages.get(lang);
          if (loading === undefined) {
            loading = loader()
              .then(({ default: data }) => {
                highlighter.loadLanguageSync(data);
                loadedLanguages = new Set(highlighter.getLoadedLanguages());
                if (!loadedLanguages.has(lang)) {
                  throw new Error(
                    `loadLanguages: "${lang}" was not loaded. If its grammar is already loaded, load the alias first or give the grammar a unique name.`
                  );
                }
                if (customLoader != null) loadedCustomLanguages.add(lang);
              })
              .finally(() => {
                loadingLanguages.delete(lang);
              });
            loadingLanguages.set(lang, loading);
          }
          return loading;
        })
      );
    },
    hasLoadedLanguages(languages) {
      return languages.every(
        (lang) =>
          isSpecialLang(lang) ||
          (customLanguageLoaders?.has(lang) === true
            ? loadedCustomLanguages.has(lang)
            : loadedLanguages.has(lang) ||
              !Object.hasOwn(languageLoaders, lang))
      );
    },
    codeToTokens(code, options) {
      const result = highlighter.codeToTokens(
        code.replace(/\r(?!\n)/g, '\n'),
        getShikiOptions(options, highlighter)
      );
      return {
        ...result,
        rootStyle: result.rootStyle === false ? undefined : result.rootStyle,
      };
    },
    getTheme(themeName) {
      const theme = themeResolver.getResolvedTheme(themeName);
      if (theme == null)
        throw new Error('Theme "' + themeName + '" is not loaded');
      return theme;
    },
  };
}
