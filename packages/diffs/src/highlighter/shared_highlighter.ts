import {
  createHighlighter,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
} from 'shiki';

import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemeRegistrationResolved,
} from '../types';
import type { ResolvedLanguage } from '../worker/types';
import { attachResolvedLanguages } from './languages/attachResolvedLanguages';
import { cleanUpResolvedLanguages } from './languages/cleanUpResolvedLanguages';
import { getResolvedOrResolveLanguage } from './languages/getResolvedOrResolveLanguage';
import { attachResolvedThemes } from './themes/attachResolvedThemes';
import { cleanUpResolvedThemes } from './themes/cleanUpResolvedThemes';
import { getResolvedOrResolveTheme } from './themes/getResolvedOrResolveTheme';
import { registerCustomTheme } from './themes/registerCustomTheme';

type CachedOrLoadingHighlighterType =
  | Promise<DiffsHighlighter>
  | DiffsHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferredHighlighter = 'shiki-js',
}: HighlighterOptions): Promise<DiffsHighlighter> {
  highlighter ??= createHighlighter({
    themes: [],
    langs: ['text'],
    engine:
      preferredHighlighter === 'shiki-wasm'
        ? createOnigurumaEngine(import('shiki/wasm'))
        : createJavaScriptRegexEngine(),
  }) as Promise<DiffsHighlighter>;

  const instance = isHighlighterLoading(highlighter)
    ? await highlighter
    : highlighter;
  highlighter = instance;

  const languageLoaders: Promise<ResolvedLanguage>[] = [];
  for (const language of langs) {
    if (language === 'text' || language === 'ansi') continue;
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
): h is DiffsHighlighter {
  return h != null && !('then' in h);
}

export function getHighlighterIfLoaded(): DiffsHighlighter | undefined {
  if (highlighter != null && !('then' in highlighter)) {
    return highlighter;
  }
  return undefined;
}

export function isHighlighterLoading(
  h: CachedOrLoadingHighlighterType = highlighter
): h is Promise<DiffsHighlighter> {
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

registerCustomTheme('pierre-dark', () => {
  return import('../themes/pierre-dark.json') as unknown as Promise<ThemeRegistrationResolved>;
});

registerCustomTheme('pierre-light', () => {
  return import('../themes/pierre-light.json') as unknown as Promise<ThemeRegistrationResolved>;
});
