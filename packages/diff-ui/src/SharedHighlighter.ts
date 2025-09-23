import {
  type BundledLanguage,
  type BundledTheme,
  createHighlighter,
  createOnigurumaEngine,
  createJavaScriptRegexEngine,
  type HighlighterGeneric,
  loadWasm,
} from 'shiki';

type PierreHighlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

type CachedOrLoadingHighlighterType =
  | Promise<PierreHighlighter>
  | PierreHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

const loadedThemes = new Map<BundledTheme, true | Promise<void>>();
const loadedLanguages = new Map<BundledLanguage, true | Promise<void>>();

interface HighlighterOptions {
  themes: BundledTheme[];
  langs: BundledLanguage[];
  preferWasmHighlighter?: boolean;
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferWasmHighlighter = false,
}: HighlighterOptions) {
  if (isHighlighterNull(highlighter)) {
    // NOTE(amadeus): We should probably build in some logic for rejection
    // handling...
    highlighter = new Promise((resolve) => {
      (preferWasmHighlighter
        ? loadWasm(import('shiki/wasm'))
        : Promise.resolve()
      )
        .then(() => {
          // Since we are loading the languages and themes along with the
          // highlighter, we can just go ahead and mark them as loaded since
          // they'll be ready when the highlighter is ready which any calls to
          // getSharedHighlighter will resolve automatically for us
          for (const theme of themes) {
            loadedThemes.set(theme, true);
          }
          for (const language of langs) {
            loadedLanguages.set(language, true);
          }
          return createHighlighter({
            themes,
            langs,
            engine: preferWasmHighlighter
              ? createOnigurumaEngine()
              : createJavaScriptRegexEngine(),
          });
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
  for (const theme of themes) {
    const loadedOrLoading = loadedThemes.get(theme);
    // We haven't loaded this theme yet, so lets queue it up
    if (loadedOrLoading == null) {
      const promise = instance
        .loadTheme(theme)
        .then(() => void loadedThemes.set(theme, true));
      loadedThemes.set(theme, promise);
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

export function isHighlighterLoaded(
  h: CachedOrLoadingHighlighterType = highlighter
): h is PierreHighlighter {
  return h != null && !('then' in h);
}

export function isHighlighterLoading(
  h: CachedOrLoadingHighlighterType = highlighter
): h is Promise<PierreHighlighter> {
  return h != null && 'then' in h;
}

export function isHighlighterNull(
  h: CachedOrLoadingHighlighterType = highlighter
): h is undefined {
  return h == null;
}

export async function preloadHighlighter(options: HighlighterOptions) {
  return void (await getSharedHighlighter(options));
}

export async function disposeHighlighter() {
  if (highlighter == null) return;
  (await highlighter).dispose();
  loadedThemes.clear();
  loadedLanguages.clear();
  highlighter = undefined;
}
