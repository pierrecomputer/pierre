import {
  createHighlighter,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
  loadWasm,
} from 'shiki';

import type {
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
  ThemeRegistrationResolved,
} from './types';

type CachedOrLoadingHighlighterType =
  | Promise<PJSHighlighter>
  | PJSHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

const loadedThemes = new Map<string, true | Promise<void>>();
const loadedLanguages = new Map<SupportedLanguages, true | Promise<void>>();

interface HighlighterOptions {
  themes: PJSThemeNames[];
  langs: SupportedLanguages[];
  preferWasmHighlighter?: boolean;
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferWasmHighlighter = false,
}: HighlighterOptions): Promise<PJSHighlighter> {
  if (isHighlighterNull(highlighter)) {
    // NOTE(amadeus): We should probably build in some logic for rejection
    // handling...
    highlighter = new Promise((resolve) => {
      void (
        preferWasmHighlighter
          ? loadWasm(import('shiki/wasm'))
          : Promise.resolve()
      )
        .then(() => {
          // Since we are loading the languages and themes along with the
          // highlighter, we can just go ahead and mark them as loaded since
          // they'll be ready when the highlighter is ready which any calls to
          // getSharedHighlighter will resolve automatically for us
          const themesToLoad: (
            | PJSThemeNames
            | Promise<ThemeRegistrationResolved>
          )[] = [];
          for (const theme of themes) {
            loadedThemes.set(theme, true);
            const customTheme = CustomThemes.get(theme);
            if (customTheme != null) {
              themesToLoad.push(customTheme());
            } else {
              themesToLoad.push(theme);
            }
          }
          for (const language of langs) {
            loadedLanguages.set(language, true);
          }
          loadedLanguages.set('text', true);
          return createHighlighter({
            themes: themesToLoad,
            langs: [...langs, 'text'],
            engine: preferWasmHighlighter
              ? createOnigurumaEngine()
              : createJavaScriptRegexEngine(),
          }) as Promise<PJSHighlighter>;
        })
        .then((instance) => {
          highlighter = instance;
          resolve(instance);
        });
    });
    return highlighter;
  }
  const instance = isHighlighterLoading(highlighter)
    ? await highlighter
    : highlighter;
  const loaders: Promise<void>[] = [];
  for (const language of langs) {
    const loadedOrLoading = loadedLanguages.get(language);
    // We haven't loaded this language yet, so lets queue it up
    if (loadedOrLoading == null) {
      const promise = instance
        .loadLanguage(language)
        .then(() => void loadedLanguages.set(language, true));
      loadedLanguages.set(language, promise);
      loaders.push(promise);
    }
    // We are currently loading the language,
    // so lets queue the existing promise
    else if (loadedOrLoading !== true) {
      loaders.push(loadedOrLoading);
    }
  }
  for (const themeName of themes) {
    const loadedOrLoading = loadedThemes.get(themeName);
    // We haven't loaded this theme yet, so lets queue it up
    if (loadedOrLoading == null) {
      const customTheme = CustomThemes.get(themeName);
      const promise = instance
        .loadTheme(customTheme != null ? customTheme() : themeName)
        .then(() => void loadedThemes.set(themeName, true));
      loadedThemes.set(themeName, promise);
      loaders.push(promise);
    }
    // We are currently loading the theme,
    // so lets queue the existing promise
    else if (loadedOrLoading !== true) {
      loaders.push(loadedOrLoading);
    }
  }
  if (loaders.length > 0) {
    await Promise.all(loaders);
  }
  return instance;
}

export function hasLoadedThemes(themes: PJSThemeNames[]): boolean {
  for (const theme of themes) {
    if (loadedThemes.get(theme) === true) {
      continue;
    }
    return false;
  }
  return true;
}

export function hasLoadedLanguage(lang: SupportedLanguages): boolean {
  return loadedLanguages.get(lang) === true;
}

export function isHighlighterLoaded(
  h: CachedOrLoadingHighlighterType = highlighter
): h is PJSHighlighter {
  return h != null && !('then' in h);
}

export function isHighlighterLoading(
  h: CachedOrLoadingHighlighterType = highlighter
): h is Promise<PJSHighlighter> {
  return h != null && 'then' in h;
}

export function isHighlighterNull(
  h: CachedOrLoadingHighlighterType = highlighter
): h is undefined {
  return h == null;
}

export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  return void (await getSharedHighlighter(options));
}

export async function disposeHighlighter(): Promise<void> {
  if (highlighter == null) return;
  (await highlighter).dispose();
  loadedThemes.clear();
  loadedLanguages.clear();
  highlighter = undefined;
}

const CustomThemes = new Map<
  string,
  () => Promise<ThemeRegistrationResolved>
>();

export function registerCustomTheme(
  themeName: string,
  loader: () => Promise<ThemeRegistrationResolved>
): void {
  if (CustomThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  CustomThemes.set(themeName, loader);
}

registerCustomTheme(
  'pierre-dark',
  () =>
    import(
      './themes/pierre-dark.json'
    ) as unknown as Promise<ThemeRegistrationResolved>
);

registerCustomTheme(
  'pierre-light',
  () =>
    import(
      './themes/pierre-light.json'
    ) as unknown as Promise<ThemeRegistrationResolved>
);
