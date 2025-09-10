import {
  type BundledLanguage,
  type BundledTheme,
  createHighlighter,
  createOnigurumaEngine,
  type HighlighterGeneric,
  loadWasm,
} from 'shiki';

let highlighter:
  | Promise<HighlighterGeneric<BundledLanguage, BundledTheme>>
  | undefined;

const loadedThemes = new Set<BundledTheme>();
const loadedLanguages = new Set<BundledLanguage>();

interface HighlighterOptions {
  themes: BundledTheme[];
  langs: BundledLanguage[];
}

export async function getSharedHighlighter(options: HighlighterOptions) {
  if (highlighter == null) {
    highlighter = new Promise((resolve) => {
      loadWasm(import('shiki/wasm'))
        .then(() =>
          createHighlighter({
            ...options,
            engine: createOnigurumaEngine(),
          })
        )
        .then((instance) => {
          for (const theme of options.themes) {
            loadedThemes.add(theme);
          }
          for (const language of options.langs) {
            loadedLanguages.add(language);
          }
          resolve(instance);
        });
    });
    return highlighter;
  }
  const { themes, langs } = options;
  const loaders: Promise<void>[] = [];
  for (const language of langs) {
    if (!loadedLanguages.has(language)) {
      loadedLanguages.add(language);
      loaders.push(highlighter.then((h) => h.loadLanguage(language)));
    }
  }
  for (const theme of themes) {
    if (!loadedThemes.has(theme)) {
      loadedThemes.add(theme);
      loaders.push(highlighter.then((h) => h.loadTheme(theme)));
    }
  }
  return (await Promise.all([highlighter, ...loaders] as const))[0];
}

export async function disposeHighlighter() {
  if (highlighter == null) return;
  (await highlighter).dispose();
  highlighter = undefined;
}
