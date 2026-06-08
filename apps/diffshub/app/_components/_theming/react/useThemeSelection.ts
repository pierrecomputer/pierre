'use client';

import type {
  ColorMode,
  ThemeController,
  ThemeControllerState,
} from '@pierre/theming';
import { createThemeResolver } from '@pierre/theming';
import { useThemeController } from '@pierre/theming/react';
import { useContext, useMemo } from 'react';

import { ThemeControllerContext } from './useThemeSource';
import { docsThemeCatalog } from '@/components/themeCatalog';

export interface ThemeSelectionResult {
  // Current selection.
  colorMode: ColorMode;
  darkThemeName: string;
  lightThemeName: string;
  // Catalog.
  darkThemeNames: readonly string[];
  lightThemeNames: readonly string[];
  // Setters (no-op when there is no controller, e.g. under an override provider).
  setColorMode(mode: ColorMode): void;
  setDarkThemeName(name: string): void;
  setLightThemeName(name: string): void;
}

const NOOP = () => {};
const EMPTY_THEMES: readonly string[] = [];

// A stable empty state for the fallback controller. useThemeController wraps
// useSyncExternalStore, which compares snapshot identity — so getState MUST
// return the same reference on every call or it would loop. Hence a module-level
// singleton rather than a fresh object literal.
const FALLBACK_STATE: ThemeControllerState = {
  darkThemeName: '',
  lightThemeName: '',
  mode: 'system',
  resolvedColorScheme: 'light',
};

// A no-op controller used when no ThemeControllerContext is present (an
// override-only provider). It never notifies and always reports FALLBACK_STATE,
// so useThemeController can be called unconditionally — the hook count stays
// constant whether or not a controller exists, with no rules-of-hooks hazard if
// a consumer's controller presence ever changes across renders.
const FALLBACK_CONTROLLER: ThemeController = {
  resolver: createThemeResolver(),
  subscribe: () => () => {},
  getState: () => FALLBACK_STATE,
  setColorMode: () => {},
  setThemeNameForScheme: () => {},
  destroy: () => {},
};

// Reads the controller behind the provider: the current mode + theme
// names, the catalogs, and setters. Under an override-only provider (no
// controller) it returns empty catalogs and no-op setters so consumers stay safe.
export function useThemeSelection(): ThemeSelectionResult {
  const controller = useContext(ThemeControllerContext);
  // Always read through a controller (a stable no-op one when none is present)
  // so the hook count never changes between renders.
  const state = useThemeController(controller ?? FALLBACK_CONTROLLER);
  return useMemo<ThemeSelectionResult>(() => {
    if (controller == null) {
      return {
        colorMode: 'system',
        darkThemeName: '',
        lightThemeName: '',
        darkThemeNames: EMPTY_THEMES,
        lightThemeNames: EMPTY_THEMES,
        setColorMode: NOOP,
        setDarkThemeName: NOOP,
        setLightThemeName: NOOP,
      };
    }
    return {
      colorMode: state.mode,
      darkThemeName: state.darkThemeName,
      lightThemeName: state.lightThemeName,
      darkThemeNames: docsThemeCatalog.getThemeNames({ colorScheme: 'dark' }),
      lightThemeNames: docsThemeCatalog.getThemeNames({ colorScheme: 'light' }),
      setColorMode: (mode: ColorMode) => controller.setColorMode(mode),
      setDarkThemeName: (name: string) =>
        controller.setThemeNameForScheme('dark', name),
      setLightThemeName: (name: string) =>
        controller.setThemeNameForScheme('light', name),
    };
  }, [controller, state.mode, state.darkThemeName, state.lightThemeName]);
}
