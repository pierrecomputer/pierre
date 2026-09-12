import { DuplicateThemeError, type ThemeLoader } from '@pierre/theming';

import type {
  DiffsHighlighter,
  DiffsThemeNames,
  RawTheme,
  ThemesType,
} from '../types';
import { getThemes } from '../utils/getThemes';
import { createDiffsHighlighter } from './createDiffsHighlighter';

export type CustomThemeLoader = ThemeLoader<RawTheme>;
const customThemeLoaders = new Map<string, CustomThemeLoader>();
let highlighter: DiffsHighlighter | undefined;

interface HighlighterOptions {
  themes: DiffsThemeNames[];
}

export async function getSharedHighlighter({
  themes,
}: HighlighterOptions): Promise<DiffsHighlighter> {
  if (highlighter === undefined) {
    highlighter = createDiffsHighlighter(customThemeLoaders);
    for (const [name, loader] of customThemeLoaders) {
      highlighter.themeResolver.registerTheme(name, loader);
    }
  }
  const instance = highlighter;
  await instance.themeResolver.resolveThemes(themes);
  return instance;
}

/** Register a loader on the shared Highlights backend, including future instances. */
export function registerCustomTheme(
  name: string,
  loader: CustomThemeLoader
): void {
  try {
    if (customThemeLoaders.has(name)) throw new DuplicateThemeError(name);
    highlighter?.themeResolver.registerTheme(name, loader);
    customThemeLoaders.set(name, loader);
  } catch (error) {
    if (!(error instanceof DuplicateThemeError)) throw error;
    console.error('registerCustomTheme: theme name already registered', name);
  }
}

export function getHighlighterIfLoaded(settings?: {
  theme: DiffsThemeNames | ThemesType;
}): DiffsHighlighter | undefined {
  if (
    settings != null &&
    highlighter?.themeResolver.hasResolvedThemes(getThemes(settings.theme)) !==
      true
  )
    return;
  return highlighter;
}

type CachedOrLoadingHighlighter =
  | DiffsHighlighter
  | Promise<DiffsHighlighter>
  | undefined;

export function isHighlighterLoaded(
  h: CachedOrLoadingHighlighter = highlighter
): h is DiffsHighlighter {
  return h != null && !('then' in h);
}
export function isHighlighterLoading(
  h: CachedOrLoadingHighlighter = highlighter
): h is Promise<DiffsHighlighter> {
  return h != null && 'then' in h;
}
export function isHighlighterNull(
  h: CachedOrLoadingHighlighter = highlighter
): h is undefined {
  return h == null;
}
export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}
export function disposeHighlighter(): Promise<void> {
  highlighter = undefined;
  return Promise.resolve();
}
