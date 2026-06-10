import { normalizeTheme } from 'shiki/core';

import type { ThemeDescriptor } from './createThemeCollection';
import type { ThemeLoader } from './createThemeResolver';
import type { ThemeLike } from './types';
import { unwrapDefault } from './unwrapDefault';

export interface CreateThemeOptions {
  name: string;
  load: ThemeLoader;
  colorScheme?: 'light' | 'dark';
  collection?: string;
  displayName?: string;
}

// Wraps a caller-provided loader so raw VS Code/Shiki themes become the
// resolved ThemeLike shape expected by diffs, trees, and app chrome.
export function createTheme<TTheme extends ThemeLike = ThemeLike>({
  name,
  load,
  colorScheme,
  collection,
  displayName,
}: CreateThemeOptions): ThemeDescriptor<TTheme> {
  return {
    name,
    colorScheme,
    collection,
    displayName,
    load: normalizingLoader(load),
  };
}

function normalizingLoader<TTheme extends ThemeLike>(
  loader: ThemeLoader
): ThemeLoader<TTheme> {
  return async () => {
    const raw = await loader();
    const theme = unwrapDefault(raw);
    return normalizeTheme(
      theme as Parameters<typeof normalizeTheme>[0]
    ) as unknown as TTheme;
  };
}
