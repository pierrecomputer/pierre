'use client';

import { type DiffsThemeNames, getResolvedOrResolveTheme } from '@pierre/diffs';
import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import { useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/components/theme-provider';

// Defaults used while the user-selected Shiki theme is still resolving.
const LIGHT_SOFT_TREE_STYLES = themeToTreeStyles(lightSoftTheme);
const DARK_SOFT_TREE_STYLES = themeToTreeStyles(darkSoftTheme);

// Module-level cache so flipping back to a previously-selected Shiki theme
// is synchronous and renders without flashing the default pierre-soft
// palette in between.
const TREE_STYLES_CACHE = new Map<string, TreeThemeStyles>();
TREE_STYLES_CACHE.set('pierre-light-soft', LIGHT_SOFT_TREE_STYLES);
TREE_STYLES_CACHE.set('pierre-dark-soft', DARK_SOFT_TREE_STYLES);

// Resolves a Shiki theme name to TreeThemeStyles, hitting the cache when
// possible and falling back to the bundled pierre-*-soft defaults until the
// custom theme finishes loading on the main-thread highlighter.
function useTreeThemeStyles(
  themeName: DiffsThemeNames,
  fallback: TreeThemeStyles
): TreeThemeStyles {
  const cached = TREE_STYLES_CACHE.get(themeName);
  const [styles, setStyles] = useState<TreeThemeStyles>(cached ?? fallback);

  useEffect(() => {
    const existing = TREE_STYLES_CACHE.get(themeName);
    if (existing != null) {
      setStyles(existing);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const theme = await getResolvedOrResolveTheme(themeName);
        const next = themeToTreeStyles(theme);
        TREE_STYLES_CACHE.set(themeName, next);
        if (!cancelled) setStyles(next);
      } catch {
        // Resolution failures are surfaced by the diff side; the fallback
        // styles keep the sidebar usable in the meantime.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [themeName]);

  return styles;
}

// Returns the TreeThemeStyles that match the currently-active color mode
// (light or dark, derived from the global ThemeProvider) for the
// user-selected light/dark Shiki themes. Both themes are resolved eagerly
// so flipping between Auto/Light/Dark uses the cached value.
export function useResolvedTreeThemeStyles(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): TreeThemeStyles {
  const { resolvedTheme } = useTheme();
  const lightStyles = useTreeThemeStyles(lightTheme, LIGHT_SOFT_TREE_STYLES);
  const darkStyles = useTreeThemeStyles(darkTheme, DARK_SOFT_TREE_STYLES);
  return useMemo(
    () => (resolvedTheme === 'dark' ? darkStyles : lightStyles),
    [resolvedTheme, darkStyles, lightStyles]
  );
}
