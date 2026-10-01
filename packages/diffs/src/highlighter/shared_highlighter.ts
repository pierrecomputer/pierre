import type {
  DiffsHighlighter,
  DiffsThemeNames,
  HighlighterTypes,
  SupportedLanguages,
  ThemesType,
} from '../types';
import {
  acquireHighlighterType,
  assertHighlighterType,
  releaseHighlighterType,
  resolveHighlighterType,
} from './highlighterType';
import { cleanUpResolvedLanguages } from './languages/cleanUpResolvedLanguages';
import { areThemesAttached } from './themes/areThemesAttached';
import { cleanUpResolvedThemes } from './themes/cleanUpResolvedThemes';

export { getHighlighterType } from './highlighterType';

type CachedOrLoadingHighlighterType =
  | Promise<DiffsHighlighter>
  | DiffsHighlighter
  | undefined;

let highlighter: CachedOrLoadingHighlighterType;

export interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

/**
 * Create an independently disposable highlighter, loading only its backend.
 * The type defaults to the one already in use, else `DEFAULT_HIGHLIGHTER`;
 * requesting a different type than the one in use rejects.
 */
export async function createHighlighter(
  type?: HighlighterTypes
): Promise<DiffsHighlighter> {
  const resolvedType = resolveHighlighterType(type);
  // Hold the type before importing so a concurrent request for another type
  // rejects before its backend loads. The new instance holds it from then on.
  acquireHighlighterType(resolvedType);
  try {
    if (resolvedType === 'highlights') {
      const { HighlightsHighlighter } = await import('./backends/highlights');
      return new HighlightsHighlighter();
    }
    const { ShikiHighlighter } = await import('./backends/shiki');
    return await ShikiHighlighter.create(resolvedType);
  } finally {
    releaseHighlighterType();
  }
}

export async function getSharedHighlighter({
  themes,
  langs,
  preferredHighlighter,
}: HighlighterOptions): Promise<DiffsHighlighter> {
  if (preferredHighlighter != null) {
    assertHighlighterType(preferredHighlighter);
  }
  const cached = (highlighter ??= createHighlighter(preferredHighlighter));
  let instance: DiffsHighlighter;
  try {
    instance = await cached;
  } catch (error) {
    // Let a later request retry, unless the cache has moved on already.
    if (highlighter === cached) {
      highlighter = undefined;
    }
    throw error;
  }
  if (highlighter === cached) {
    highlighter = instance;
  }
  await Promise.all([
    instance.themeResolver.resolveThemes(themes),
    instance.loadLanguages(langs),
  ]);
  return instance;
}

export function isHighlighterLoaded(): boolean {
  return highlighter != null && !('then' in highlighter);
}

interface GetHighlighterIfLoadedProps {
  theme?: DiffsThemeNames | ThemesType;
  lang?: SupportedLanguages;
  preferredHighlighter?: HighlighterTypes;
}

/**
 * The shared instance when it is loaded and ready for the given theme and
 * language. An instance of a type other than `preferredHighlighter` is not
 * returned, so loading the requested type reports the conflict.
 */
export function getHighlighterIfLoaded({
  theme,
  lang,
  preferredHighlighter,
}: GetHighlighterIfLoadedProps = {}): DiffsHighlighter | undefined {
  const instance = highlighter;
  if (
    instance == null ||
    'then' in instance ||
    (preferredHighlighter != null && instance.name !== preferredHighlighter) ||
    (theme != null && !areThemesAttached(theme, instance)) ||
    (lang != null && !instance.hasLoadedLanguages([lang]))
  ) {
    return undefined;
  }
  return instance;
}

export function isHighlighterLoading(): boolean {
  return highlighter != null && 'then' in highlighter;
}

export function isHighlighterNull(): boolean {
  return highlighter == null;
}

export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}

/**
 * Dispose the shared instance and clear the shared theme and language caches.
 * A loaded instance is disposed synchronously, so its highlighter type is
 * released before this returns. Instances from createHighlighter() are not
 * disposed; their type stays in use until they are.
 */
export async function disposeHighlighter(): Promise<void> {
  const cached = highlighter;
  highlighter = undefined;
  cleanUpResolvedLanguages();
  cleanUpResolvedThemes();
  if (cached != null && 'then' in cached) {
    // A failed initialization has nothing to dispose.
    (await cached.catch(() => undefined))?.dispose();
  } else {
    cached?.dispose();
  }
}
