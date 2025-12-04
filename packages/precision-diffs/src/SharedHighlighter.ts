import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';

import {
  attachResolvedLanguages,
  cleanUpResolvedLanguages,
  getResolvedOrResolveLanguage,
} from './highlighter/languages';
import {
  attachResolvedThemes,
  cleanUpResolvedThemes,
  getResolvedOrResolveTheme,
} from './highlighter/themes';
import type {
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
  ThemeRegistrationResolved,
} from './types';
import type { ResolvedLanguage } from './worker';

type CachedOrLoadingHighlighterType =
  | Promise<PJSHighlighter>
  | PJSHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

interface HighlighterOptions {
  themes: PJSThemeNames[];
  langs: SupportedLanguages[];
}

export async function getSharedHighlighter({
  themes,
  langs,
}: HighlighterOptions): Promise<PJSHighlighter> {
  highlighter ??= createHighlighter({
    themes: [],
    langs: ['text'],
    engine: createJavaScriptRegexEngine(),
  }) as Promise<PJSHighlighter>;

  const instance = isHighlighterLoading(highlighter)
    ? await highlighter
    : highlighter;
  highlighter = instance;

  const languageLoaders: Promise<ResolvedLanguage>[] = [];
  for (const language of langs) {
    if (language === 'text') continue;
    const maybeResolvedLanguage = getResolvedOrResolveLanguage(language);
    if ('then' in maybeResolvedLanguage) {
      languageLoaders.push(maybeResolvedLanguage);
    } else {
      attachResolvedLanguages(maybeResolvedLanguage, instance);
    }
  }

  const themeLoaders: Promise<ThemeRegistrationResolved>[] = [];
  for (const themeName of themes) {
    const maybeResolvedTheme = getResolvedOrResolveTheme(themeName);
    if ('then' in maybeResolvedTheme) {
      themeLoaders.push(maybeResolvedTheme);
    } else {
      attachResolvedThemes(maybeResolvedTheme, highlighter);
    }
  }

  // If we need to load any languages or themes, lets do that now
  if (languageLoaders.length > 0 || themeLoaders.length > 0) {
    await Promise.all([
      Promise.all(languageLoaders).then((languages) => {
        attachResolvedLanguages(languages, instance);
      }),
      Promise.all(themeLoaders).then((themes) => {
        attachResolvedThemes(themes, instance);
      }),
    ]);
  }

  return instance;
}

export function isHighlighterLoaded(
  h: CachedOrLoadingHighlighterType = highlighter
): h is PJSHighlighter {
  return h != null && !('then' in h);
}

export function getHighlighterIfLoaded(): PJSHighlighter | undefined {
  if (highlighter != null && !('then' in highlighter)) {
    return highlighter;
  }
  return undefined;
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
  cleanUpResolvedLanguages();
  cleanUpResolvedThemes();
  highlighter = undefined;
}
