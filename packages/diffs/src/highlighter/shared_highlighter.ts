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

let highlighter: DiffsHighlighter | Promise<DiffsHighlighter> | undefined;

export interface HighlighterOptions {
  themes: DiffsThemeNames[];
  langs: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

/**
 * Creates an instance the caller must dispose. Defaults to the active type
 * or DEFAULT_HIGHLIGHTER; rejects if a different type is already active.
 */
export async function createHighlighter(
  type?: HighlighterTypes
): Promise<DiffsHighlighter> {
  const resolvedType = resolveHighlighterType(type);
  // Reserve the type before importing to prevent concurrent backend loads.
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
  dropDisposedHighlighter();
  const cached = (highlighter ??= createHighlighter(preferredHighlighter));
  let instance: DiffsHighlighter;
  try {
    instance = await cached;
  } catch (error) {
    // Allow retries without clearing a newer request.
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
  // disposeHighlighter() may run while themes and languages load.
  if (instance.isDisposed) {
    throw new Error('Highlighter is disposed');
  }
  return instance;
}

// Direct dispose() calls leave the shared reference pointing to a dead instance.
function dropDisposedHighlighter(): void {
  if (
    highlighter != null &&
    !('then' in highlighter) &&
    highlighter.isDisposed
  ) {
    highlighter = undefined;
  }
}

export function isHighlighterLoaded(): boolean {
  dropDisposedHighlighter();
  return highlighter != null && !('then' in highlighter);
}

interface GetHighlighterIfLoadedProps {
  theme?: DiffsThemeNames | ThemesType;
  lang?: SupportedLanguages;
  preferredHighlighter?: HighlighterTypes;
}

/**
 * Returns undefined if the type differs or the theme or language is not loaded.
 */
export function getHighlighterIfLoaded({
  theme,
  lang,
  preferredHighlighter,
}: GetHighlighterIfLoadedProps = {}): DiffsHighlighter | undefined {
  dropDisposedHighlighter();
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
  dropDisposedHighlighter();
  return highlighter == null;
}

export async function preloadHighlighter(
  options: HighlighterOptions
): Promise<void> {
  await getSharedHighlighter(options);
}

/**
 * Disposes an already loaded shared instance synchronously and clears caches.
 * Instances from createHighlighter() must be disposed separately before
 * switching types.
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
