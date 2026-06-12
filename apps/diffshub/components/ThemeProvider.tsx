'use client';

import type { ColorMode, ColorScheme } from '@pierre/theming';
import { useThemeController } from '@pierre/theming/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { themeController } from './themeController';

interface ThemeProviderProps {
  attribute?: 'class' | `data-${string}` | Array<'class' | `data-${string}`>;
  children: ReactNode;
  enableColorScheme?: boolean;
  value?: Partial<Record<ColorScheme, string>>;
}

interface ThemeContextValue {
  colorMode?: ColorMode;
  colorModes: ColorMode[];
  resolvedColorScheme?: ColorScheme;
  setColorMode: (mode: ColorMode) => void;
}

const COLOR_MODES: ColorMode[] = ['light', 'dark', 'system'];
const COLOR_SCHEMES: ColorScheme[] = ['light', 'dark'];

// Navbar tint (iOS Safari's <meta name="theme-color">) for each resolved color
// scheme. These match the global body `--background` (oklch(1)/oklch(0.145))
// that iOS samples at the top of the page, so the navbar blends with the page
// instead of contrasting it. Kept in sync with the same literals hardcoded in
// the layout's pre-paint bootstrap script (which can't import this module).
const SCHEME_THEME_COLOR: Record<ColorScheme, string> = {
  light: '#ffffff',
  dark: '#0a0a0a',
};

// Points the document's theme-color meta at `color` (the iOS Safari navbar
// tint), creating the meta if it isn't there yet. The meta is intentionally
// not authored in JSX: React 19 hoists head tags and would leave a duplicate
// next to the one it manages. Creating it imperatively keeps exactly one,
// owned entirely by this code.
function setThemeColorMeta(color: string) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta == null) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Applies the already-resolved color scheme to <html>: the class/data-attribute
// contract, the native color-scheme, and the iOS navbar tint. The resolved
// 'light'/'dark' comes straight from the theme controller, so this never
// re-derives it from a raw mode + system preference.
function applyColorScheme({
  attribute,
  enableColorScheme,
  resolvedColorScheme,
  value,
}: {
  attribute: ThemeProviderProps['attribute'];
  enableColorScheme: boolean;
  resolvedColorScheme: ColorScheme;
  value: Partial<Record<ColorScheme, string>> | undefined;
}) {
  const root = document.documentElement;
  const resolvedValue = value?.[resolvedColorScheme] ?? resolvedColorScheme;
  const attributes = Array.isArray(attribute) ? attribute : [attribute];
  const classValues = COLOR_SCHEMES.map((scheme) => value?.[scheme] ?? scheme);

  for (const currentAttribute of attributes) {
    if (currentAttribute === 'class') {
      root.classList.remove(...classValues);
      root.classList.add(resolvedValue);
      continue;
    }
    if (currentAttribute != null) {
      root.setAttribute(currentAttribute, resolvedValue);
    }
  }

  if (enableColorScheme) {
    root.style.colorScheme = resolvedColorScheme;
  }

  // Keep the iOS navbar tint in step with the resolved color scheme.
  setThemeColorMeta(SCHEME_THEME_COLOR[resolvedColorScheme]);
}

// Thin React binding over the @pierre/theming controller (the single owner of
// theming state). useThemeController subscribes to the controller for color
// mode + resolvedColorScheme; this component applies the resolved scheme to the
// DOM and exposes the useTheme() API the app depends on. Selection and
// persistence live in the controller — this holds no theming state of its own.
export function ThemeProvider({
  attribute = 'data-theme',
  children,
  enableColorScheme = true,
  value,
}: ThemeProviderProps) {
  const state = useThemeController(themeController);

  // The controller reads persisted state synchronously on module load, so on
  // the client useThemeController would surface the stored mode on the very
  // first render — but the server rendered the defaults. Expose the resolved
  // values to consumers only after mount, so render output derived from
  // useTheme() matches the SSR markup first, then flips. The DOM application
  // below still uses the real resolved scheme (the pre-paint bootstrap script
  // already painted it), so this gate is invisible.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const colorMode = mounted ? state.mode : undefined;
  const resolvedColorScheme = mounted ? state.resolvedColorScheme : undefined;

  useEffect(() => {
    applyColorScheme({
      attribute,
      enableColorScheme,
      resolvedColorScheme: state.resolvedColorScheme,
      value,
    });
  }, [attribute, enableColorScheme, state.resolvedColorScheme, value]);

  const setColorMode = useCallback((next: ColorMode) => {
    themeController.setColorMode(next);
  }, []);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      colorMode,
      colorModes: COLOR_MODES,
      resolvedColorScheme,
      setColorMode,
    }),
    [colorMode, resolvedColorScheme, setColorMode]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      colorModes: [],
      setColorMode: () => {},
    }
  );
}
