'use client';

import { resolveThemes } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef, useState } from 'react';

import { useLatestValueRef } from './useLatestValueRef';
import { docsThemeCatalog } from '@/components/themeCatalog';
import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';
import type { DarkThemeName, LightThemeName } from '@/lib/themeNames';

// Theme switching intervals the stress test can step through, after "off".
export const THEME_CYCLE_DURATIONS_SECONDS = [3, 0.8, 0.4, 0.1] as const;

export type ThemeCycleDurationSeconds =
  (typeof THEME_CYCLE_DURATIONS_SECONDS)[number];

export interface ThemeCycleThemeState {
  lightThemeName: LightThemeName;
  darkThemeName: DarkThemeName;
  // Resolved light/dark for the surrounding ThemeProvider — undefined while
  // localStorage hydration is still pending. Cycling only steps through
  // themes of this scheme and waits for a resolved value before stepping.
  resolvedThemeMode: 'light' | 'dark' | undefined;
  setLightThemeName: (theme: LightThemeName) => void;
  setDarkThemeName: (theme: DarkThemeName) => void;
}

interface UseThemeCycleArgs extends ThemeCycleThemeState {
  running: boolean;
  stepSeconds: ThemeCycleDurationSeconds | null;
}

// Drives a sweep through the catalog themes that match the resolved color
// scheme — the user's Light/Dark pick, or the system appearance in Auto — so
// cycling never overrides the appearance. Each scheme keeps its own cursor,
// anchored on its active theme, and every tick advances whichever scheme is
// resolved at that moment, so an appearance change mid-cycle carries on
// through the other scheme's themes. The first time cycling runs, every theme
// is resolved up front so steps never wait on a theme load.
export function useThemeCycle({
  running,
  stepSeconds,
  lightThemeName,
  darkThemeName,
  resolvedThemeMode,
  setLightThemeName,
  setDarkThemeName,
}: UseThemeCycleArgs): void {
  const cycling = running && stepSeconds != null;
  const [themesPreloaded, setThemesPreloaded] = useState(false);
  const preloadStartedRef = useRef(false);
  const workerPool = useWorkerPool();

  // Capture the latest theme state in refs so the cycle effect doesn't
  // restart its interval (and re-anchor the cursors) every time the cycle
  // advances or the appearance changes. One ref per value, so each only
  // updates when its own value changes.
  const lightThemeNameRef = useLatestValueRef(lightThemeName);
  const darkThemeNameRef = useLatestValueRef(darkThemeName);
  const resolvedThemeModeRef = useLatestValueRef(resolvedThemeMode);

  useEffect(() => {
    if (!cycling || preloadStartedRef.current) return;
    preloadStartedRef.current = true;
    // Themes resolve into the same cache the active highlighter reads from,
    // whether that's highlights on the main thread or the worker pool. Both
    // schemes load because the appearance can change while cycling.
    resolveThemes(
      [...docsThemeCatalog.getThemeNames()],
      workerPool?.getPreferredHighlighter() ?? PREFERRED_HIGHLIGHTER
    )
      .catch((error: unknown) => {
        console.error('Failed to preload themes for cycling', error);
      })
      .finally(() => setThemesPreloaded(true));
  }, [cycling, workerPool]);

  useEffect(() => {
    if (!cycling || stepSeconds == null || !themesPreloaded) return undefined;
    const lightThemes = docsThemeCatalog.getThemeNames({
      colorScheme: 'light',
    });
    const darkThemes = docsThemeCatalog.getThemeNames({ colorScheme: 'dark' });
    // A theme missing from the catalog yields -1, so the first tick lands on
    // index 0.
    let lightIdx = lightThemes.indexOf(lightThemeNameRef.current);
    let darkIdx = darkThemes.indexOf(darkThemeNameRef.current);
    const tick = () => {
      // Skips ticks until hydration resolves the scheme.
      if (resolvedThemeModeRef.current === 'dark') {
        darkIdx = (darkIdx + 1) % darkThemes.length;
        setDarkThemeName(darkThemes[darkIdx]);
      } else if (resolvedThemeModeRef.current === 'light') {
        lightIdx = (lightIdx + 1) % lightThemes.length;
        setLightThemeName(lightThemes[lightIdx]);
      }
    };
    tick();
    const intervalId = window.setInterval(tick, stepSeconds * 1000);
    return () => window.clearInterval(intervalId);
  }, [
    lightThemeNameRef,
    darkThemeNameRef,
    resolvedThemeModeRef,
    cycling,
    themesPreloaded,
    stepSeconds,
    setLightThemeName,
    setDarkThemeName,
  ]);
}
