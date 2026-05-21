'use client';

import { type DiffsThemeNames, getResolvedOrResolveTheme } from '@pierre/diffs';
import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import { useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/components/theme-provider';

// Resolved Shiki/VS Code-style theme shape (the minimum bits diffshub
// needs); kept loose so it accepts both the typed `@pierre/theme` bundles
// and `getResolvedOrResolveTheme`'s `ThemeRegistrationResolved`.
interface ResolvedShikiTheme {
  type?: 'light' | 'dark';
  bg?: string;
  fg?: string;
  colors?: Record<string, string>;
}

// Per-theme bundle: the tree styles for FileTree consumers, plus the raw
// resolved colors that the sidebar chrome needs to mirror the theme
// without going through TreeThemeStyles' tree-specific naming.
export interface ResolvedTreeTheme {
  treeStyles: TreeThemeStyles;
  // editor.foreground (or theme.fg) — the highest-contrast text color in
  // the theme. Use this for the sidebar's primary text so labels read
  // clearly against the sideBar.background surface.
  editorFg?: string;
  // editor.background (or theme.bg) — useful when mixing colors that
  // need to sit opaquely on the sidebar surface.
  editorBg?: string;
  // sideBar.foreground (or descriptionForeground) — typically a muted
  // shade in the theme. Use this for secondary/muted sidebar text so it
  // stays in the theme's palette instead of being a fade-to-transparent
  // version of the primary text.
  mutedFg?: string;
}

// Defaults used while the user-selected Shiki theme is still resolving.
function buildResolvedTheme(theme: ResolvedShikiTheme): ResolvedTreeTheme {
  const c = theme.colors ?? {};
  return {
    treeStyles: themeToTreeStyles(theme),
    editorFg: c['editor.foreground'] ?? theme.fg,
    editorBg: c['editor.background'] ?? theme.bg,
    mutedFg:
      c['sideBar.foreground'] ??
      c['descriptionForeground'] ??
      c['sideBarSectionHeader.foreground'] ??
      c['editor.foreground'] ??
      theme.fg,
  };
}

const LIGHT_SOFT_THEME = buildResolvedTheme(lightSoftTheme);
const DARK_SOFT_THEME = buildResolvedTheme(darkSoftTheme);

// Module-level cache so flipping back to a previously-selected Shiki theme
// is synchronous and renders without flashing the default pierre-soft
// palette in between.
const RESOLVED_THEME_CACHE = new Map<string, ResolvedTreeTheme>();
RESOLVED_THEME_CACHE.set('pierre-light-soft', LIGHT_SOFT_THEME);
RESOLVED_THEME_CACHE.set('pierre-dark-soft', DARK_SOFT_THEME);

function useResolvedThemeByName(
  themeName: DiffsThemeNames,
  fallback: ResolvedTreeTheme
): ResolvedTreeTheme {
  const cached = RESOLVED_THEME_CACHE.get(themeName);
  const [resolved, setResolved] = useState<ResolvedTreeTheme>(
    cached ?? fallback
  );

  useEffect(() => {
    const existing = RESOLVED_THEME_CACHE.get(themeName);
    if (existing != null) {
      setResolved(existing);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const theme = await getResolvedOrResolveTheme(themeName);
        const next = buildResolvedTheme(theme);
        RESOLVED_THEME_CACHE.set(themeName, next);
        if (!cancelled) setResolved(next);
      } catch {
        // Resolution failures are surfaced by the diff side; the fallback
        // keeps the sidebar usable in the meantime.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [themeName]);

  return resolved;
}

// Returns the resolved Shiki theme bundle (tree styles + raw colors) for
// whichever color mode is currently active in the global ThemeProvider.
export function useResolvedTreeTheme(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): ResolvedTreeTheme {
  const { resolvedTheme } = useTheme();
  const light = useResolvedThemeByName(lightTheme, LIGHT_SOFT_THEME);
  const dark = useResolvedThemeByName(darkTheme, DARK_SOFT_THEME);
  return useMemo(
    () => (resolvedTheme === 'dark' ? dark : light),
    [resolvedTheme, dark, light]
  );
}

// Back-compat alias returning just the TreeThemeStyles slice. Callers that
// only need the file-tree CSS variables stay simple.
export function useResolvedTreeThemeStyles(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): TreeThemeStyles {
  return useResolvedTreeTheme(lightTheme, darkTheme).treeStyles;
}
