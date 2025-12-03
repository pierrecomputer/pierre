import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';
import type { LanguageRegistration } from 'shiki';

import pierreDarkTheme from './themes/pierre-dark.json';
import pierreLightTheme from './themes/pierre-light.json';
import type {
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
  ThemeRegistrationResolved,
} from './types';
import { resolveLanguage } from './utils/resolveLanguages';

type CachedOrLoadingHighlighterType =
  | Promise<PJSHighlighter>
  | PJSHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

const loadedThemes = new Map<string, true | Promise<void>>();
const resolvedLanguagesMap = new Map<
  SupportedLanguages,
  LanguageRegistration[] | Promise<LanguageRegistration[]>
>();

interface HighlighterOptions {
  themes: PJSThemeNames[];
  langs: SupportedLanguages[];
}

export async function getSharedHighlighter({
  themes,
  langs,
}: HighlighterOptions): Promise<PJSHighlighter> {
  if (isHighlighterNull(highlighter)) {
    // NOTE(amadeus): We should probably build in some logic for rejection
    // handling...
    highlighter = new Promise((resolve) => {
      void (async () => {
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
        // Mark languages as resolved (they'll be loaded with the highlighter)
        for (const language of langs) {
          // Store empty array to mark as "will be loaded by createHighlighter"
          resolvedLanguagesMap.set(language, []);
        }
        resolvedLanguagesMap.set('text', []);
        const instance = (await createHighlighter({
          themes: themesToLoad,
          langs: [...langs, 'text'],
          engine: createJavaScriptRegexEngine(),
        })) as PJSHighlighter;
        highlighter = instance;
        resolve(instance);
      })();
    });
    return highlighter;
  }
  const instance = isHighlighterLoading(highlighter)
    ? await highlighter
    : highlighter;
  const loaders: Promise<void>[] = [];
  for (const language of langs) {
    const resolvedOrResolving = resolvedLanguagesMap.get(language);

    if (resolvedOrResolving == null) {
      // Language not yet resolved, resolve it now
      const promise = (async (): Promise<LanguageRegistration[]> => {
        const langData = await resolveLanguage(language);
        if (langData != null) {
          // Store the resolved data
          resolvedLanguagesMap.set(language, langData);
          // Load into highlighter
          for (const langReg of langData) {
            await instance.loadLanguage(langReg);
          }
          return langData;
        }
        // Return empty array for languages that couldn't be resolved
        return [];
      })();
      resolvedLanguagesMap.set(language, promise);
      loaders.push(promise.then(() => void 0));
    } else if ('then' in resolvedOrResolving) {
      // Currently resolving, wait for it
      loaders.push(
        resolvedOrResolving.then(async (langData) => {
          if (langData != null) {
            for (const langReg of langData) {
              await instance.loadLanguage(langReg);
            }
          }
        })
      );
    } else if (resolvedOrResolving.length > 0) {
      // Already resolved, just load into highlighter
      const loadPromise = (async () => {
        for (const langReg of resolvedOrResolving) {
          await instance.loadLanguage(langReg);
        }
      })();
      loaders.push(loadPromise);
    }
    // else: empty array means already loaded by createHighlighter
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
  const resolved = resolvedLanguagesMap.get(lang);
  return resolved != null && !('then' in resolved);
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
  resolvedLanguagesMap.clear();
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

export function isCustomTheme(themeName: string): boolean {
  return CustomThemes.has(themeName);
}

export async function resolveCustomTheme(
  themeName: string
): Promise<ThemeRegistrationResolved | undefined> {
  const loader = CustomThemes.get(themeName);
  if (loader == null) {
    return undefined;
  }
  const result = await loader();
  // Handle dynamic imports that return a module with default export
  if ('default' in result) {
    return result.default as ThemeRegistrationResolved;
  }
  return result;
}

export function registerResolvedTheme(
  themeName: string,
  themeData: ThemeRegistrationResolved
): void {
  if (CustomThemes.has(themeName)) {
    return;
  }
  CustomThemes.set(themeName, () => Promise.resolve(themeData));
}

export async function loadResolvedLanguageOnMainThread(
  langName: string,
  langData: LanguageRegistration[]
): Promise<void> {
  // Store resolved language data in the Map
  resolvedLanguagesMap.set(langName as SupportedLanguages, langData);

  // Only load if main thread highlighter exists
  if (!isHighlighterLoaded(highlighter)) {
    return;
  }

  const instance = highlighter;

  // Load each language registration into highlighter
  for (const langReg of langData) {
    await instance.loadLanguage(langReg);
  }
}

export async function loadResolvedLanguagesAndUpdateMap(
  resolvedLanguages: Array<{
    name: string;
    data: LanguageRegistration[] | undefined;
  }>
): Promise<void> {
  // First, store all resolved languages in the Map
  for (const { name, data } of resolvedLanguages) {
    if (data != null) {
      resolvedLanguagesMap.set(name as SupportedLanguages, data);
    }
  }

  // Get or wait for the highlighter instance
  const instance = isHighlighterLoading(highlighter)
    ? await highlighter
    : highlighter;

  if (instance == null) {
    console.warn(
      'loadResolvedLanguagesAndUpdateMap: highlighter not initialized'
    );
    return;
  }

  // Load each resolved language into the highlighter
  for (const { data } of resolvedLanguages) {
    if (data != null) {
      for (const langReg of data) {
        await instance.loadLanguage(langReg);
      }
    }
  }
}

registerCustomTheme('pierre-dark', () =>
  Promise.resolve(pierreDarkTheme as unknown as ThemeRegistrationResolved)
);

registerCustomTheme('pierre-light', () =>
  Promise.resolve(pierreLightTheme as unknown as ThemeRegistrationResolved)
);
