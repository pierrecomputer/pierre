'use client';

import { canUseWASM, resolveThemes, type ThemesType } from '@pierre/diffs';
import { type CSSProperties, useEffect, useState } from 'react';

import {
  HIGHLIGHT_THEMES,
  highlightThemeStyle,
} from '@/lib/theme/highlightTheme';

export function useHighlightTheme(theme: ThemesType): {
  theme: ThemesType;
  style: CSSProperties | undefined;
} {
  // Only highlights renders the css-variables theme; the shiki-js fallback
  // pool used without WebAssembly keeps the real theme pair.
  const enabled = canUseWASM();
  const [style, setStyle] = useState<CSSProperties>();
  const { light, dark } = theme;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const [lightTheme, darkTheme] = await resolveThemes(
          [light, dark],
          'highlights'
        );
        if (cancelled) return;
        const lightStyle = highlightThemeStyle(lightTheme);
        const darkStyle = highlightThemeStyle(darkTheme);
        const next: Record<string, string> = {};
        for (const key of Object.keys(lightStyle)) {
          next[key] = `light-dark(${lightStyle[key]}, ${darkStyle[key]})`;
        }
        setStyle(next);
      } catch (error) {
        console.error('Failed to load highlight palette', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, light, dark]);
  return {
    theme: enabled ? HIGHLIGHT_THEMES : theme,
    style: enabled ? style : undefined,
  };
}
