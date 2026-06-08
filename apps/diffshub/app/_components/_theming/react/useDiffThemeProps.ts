'use client';

import type { ThemesType, ThemeTypes } from '@pierre/diffs';
import { useMemo } from 'react';

import {
  type DiffThemeInput,
  diffThemeProps,
  diffThemeSelectionFromInput,
} from '../js/diffThemeProps';
import { hasThemeNameSelection } from '../js/ThemeSource';
import { useThemeSelection } from './useThemeSelection';
import { useThemeSource } from './useThemeSource';

// Names-now diffs hook. Reads the selection (names + scheme) — for the provider
// path it comes from the controller; for an override `theme` prop the names are
// taken from the override. Returns the spreadable { theme, themeType } pair that
// drives both the worker pool render options and (future) a CodeView object prop.
//
// In this prototype the override `theme` is only used for the documented preview
// case (a single fixed theme or a { light, dark } pair); when given, its names
// replace the provider selection.
export function useDiffThemeProps(theme?: DiffThemeInput): {
  theme: ThemesType;
  themeType: ThemeTypes;
} {
  const selection = useThemeSelection();
  const { activeTheme, source } = useThemeSource();
  return useMemo(() => {
    if (theme != null) {
      return diffThemeProps(
        diffThemeSelectionFromInput(theme, activeTheme.colorScheme)
      );
    }
    const sourceSelection = hasThemeNameSelection(source)
      ? source.getThemeNameSelection()
      : undefined;
    if (sourceSelection != null) {
      return diffThemeProps(sourceSelection);
    }
    return diffThemeProps({
      lightThemeName: selection.lightThemeName,
      darkThemeName: selection.darkThemeName,
      colorScheme: activeTheme.colorScheme,
    });
  }, [
    theme,
    selection.lightThemeName,
    selection.darkThemeName,
    source,
    activeTheme.colorScheme,
  ]);
}
