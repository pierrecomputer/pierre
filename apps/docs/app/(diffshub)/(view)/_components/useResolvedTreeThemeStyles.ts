'use client';

import { type DiffsThemeNames, getResolvedOrResolveTheme } from '@pierre/diffs';
import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

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
  // The color the theme assigns to the sidebar surface
  // (sideBar.foreground, falling back to editor.foreground then theme.fg).
  // Use this for primary text and icon chrome so they stay legible
  // against the tree's sideBar.background — picking editor.foreground
  // first breaks on themes like slack-ochin where the editor and sidebar
  // use opposite palettes (white editor, dark navy sidebar).
  primaryFg?: string;
  // descriptionForeground — VS Code's muted-text token. Many themes
  // don't define it; when missing, callers should fade `primaryFg`
  // themselves rather than reaching for another opaque token like
  // sideBarSectionHeader.foreground, which on some themes is brighter
  // than the primary text and inverts the muted/primary hierarchy.
  mutedFg?: string;
}

// Defaults used while the user-selected Shiki theme is still resolving.
function buildResolvedTheme(theme: ResolvedShikiTheme): ResolvedTreeTheme {
  const c = theme.colors ?? {};
  return {
    treeStyles: themeToTreeStyles(theme),
    primaryFg: c['sideBar.foreground'] ?? c['editor.foreground'] ?? theme.fg,
    mutedFg: c['descriptionForeground'],
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

// Builds the inline style we attach to any diffshub chrome surface (sidebar,
// header) so it sits on the active Shiki theme's `sideBar.background` and its
// text/icons/borders follow the same palette. We override the Tailwind v4
// `--color-*` aliases as well as the legacy `--*` names because globals.css
// bakes the aliases out to concrete values — overriding only `--foreground`
// would leave `text-foreground` utilities pinned to the pre-theme color.
//
// Beyond the chrome colors, we also derive surface tokens for "cards" that
// live on top of the sidebar bg (e.g. the comments list rows). Hardcoded
// `bg-card` / `bg-neutral-800` collide with mixed-palette themes like
// slack-ochin, which is classified `type: 'light'` but ships a dark navy
// sidebar — light text from the sidebar override on a white `bg-card` is
// unreadable. Mixing primaryFg into the sidebar bg keeps cards on-palette.
export function buildThemeChromeStyle(
  activeTheme: ResolvedTreeTheme
): CSSProperties | undefined {
  const bg =
    typeof activeTheme.treeStyles.backgroundColor === 'string' &&
    activeTheme.treeStyles.backgroundColor !== ''
      ? activeTheme.treeStyles.backgroundColor
      : undefined;
  const primaryFg =
    activeTheme.primaryFg ??
    (typeof activeTheme.treeStyles.color === 'string'
      ? activeTheme.treeStyles.color
      : undefined);
  if (bg == null && primaryFg == null) return undefined;
  const style: CSSProperties & Record<string, string> = {};
  if (bg != null) style.backgroundColor = bg;
  if (primaryFg != null) {
    style.color = primaryFg;
    style['--color-foreground'] = primaryFg;
    style['--foreground'] = primaryFg;
    const muted =
      activeTheme.mutedFg ??
      `color-mix(in srgb, ${primaryFg} 55%, transparent)`;
    style['--color-muted-foreground'] = muted;
    style['--muted-foreground'] = muted;
    const border = `color-mix(in srgb, ${primaryFg} 20%, transparent)`;
    style['--color-border'] = border;
    style['--border'] = border;
    const borderOpaque = `color-mix(in srgb, ${primaryFg} 15%, ${bg ?? 'transparent'})`;
    style['--color-border-opaque'] = borderOpaque;
    style['--border-opaque'] = borderOpaque;
    // Card surface tokens for chrome elements that sit on top of the
    // sidebar bg (e.g. comment rows). We layer the theme's foreground onto
    // its own background so cards remain legible regardless of whether the
    // theme is "light" or "dark" — the cards always sit a touch above the
    // surface they live on, and the same text color works on both.
    const cardSurfaceBase = bg ?? 'transparent';
    style['--diffshub-card-bg'] =
      `color-mix(in srgb, ${primaryFg} 6%, ${cardSurfaceBase})`;
    style['--diffshub-card-hover-bg'] =
      `color-mix(in srgb, ${primaryFg} 12%, ${cardSurfaceBase})`;
    style['--diffshub-card-border'] =
      `color-mix(in srgb, ${primaryFg} 12%, ${cardSurfaceBase})`;
    // Addition / deletion tints for comment line labels switch between
    // Tailwind's 700 and 400 shades based on whether the chrome surface is
    // dark or light. The global `dark:` variant keys off the app's color
    // mode, but mixed-palette themes like slack-ochin advertise as "light"
    // while rendering a dark sidebar — so emerald-700/rose-700 end up on
    // dark navy with poor contrast. Picking by perceived surface luminance
    // instead keeps the tints legible across every theme.
    const surfaceIsDark = isDarkSurface(bg, primaryFg);
    style['--diffshub-comment-add-fg'] = surfaceIsDark ? '#34d399' : '#047857';
    style['--diffshub-comment-del-fg'] = surfaceIsDark ? '#fb7185' : '#be123c';
  }
  return style as CSSProperties;
}

// Returns true when the chrome surface is perceptually dark. We prefer
// reading the surface's own luminance, but some themes lean on the global
// theme.bg fallback that doesn't survive into treeStyles — so when the bg
// hex isn't parseable we use the primaryFg as a hint (light fg → dark
// surface, the conventional pairing).
function isDarkSurface(bg: string | undefined, primaryFg: string): boolean {
  const fromBg = relativeLuminance(bg);
  if (fromBg != null) return fromBg < 0.4;
  const fromFg = relativeLuminance(primaryFg);
  return fromFg != null ? fromFg > 0.6 : false;
}

// Parse the leading `#rrggbb` / `#rgb` of a color string and return its
// WCAG-style relative luminance in [0, 1]. Returns null for non-hex inputs
// like `var(...)`, `color-mix(...)`, named colors etc. — those can still
// fall back through `isDarkSurface`'s primaryFg path.
function relativeLuminance(color: string | undefined): number | null {
  if (color == null) return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(color.trim());
  if (match == null) return null;
  const hex = match[1];
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const channel = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Hook form: resolve the active theme and memoize the chrome style. Used by
// both CodeViewSidebar and CodeViewHeader so the two surfaces stay in sync.
// `activeTheme` is itself memoized inside `useResolvedTreeTheme` (and the
// resolved-theme map caches entries by name), so a single dep is enough —
// the reference only changes when the user actually picks a new theme.
export function useThemeChromeStyle(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): CSSProperties | undefined {
  const activeTheme = useResolvedTreeTheme(lightTheme, darkTheme);
  return useMemo(() => buildThemeChromeStyle(activeTheme), [activeTheme]);
}
