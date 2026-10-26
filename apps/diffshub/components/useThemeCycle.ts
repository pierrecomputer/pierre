'use client';

import { resolveThemes } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { type ColorMode } from '@pierre/theming';
import { useEffect, useRef, useState } from 'react';

import { useLatestValueRef } from './useLatestValueRef';
import { docsThemeCatalog } from '@/components/themeCatalog';
import { getPreferredHighlighter } from '@/lib/preferredHighlighter';
import type { DarkThemeName, LightThemeName } from '@/lib/themeNames';

// Theme switching intervals the stress test can step through, after "off".
export const THEME_CYCLE_DURATIONS_SECONDS = [3, 0.8, 0.4, 0.1] as const;

export type ThemeCycleDurationSeconds =
  (typeof THEME_CYCLE_DURATIONS_SECONDS)[number];

export interface ThemeCycleThemeState {
  lightThemeName: LightThemeName;
  darkThemeName: DarkThemeName;
  // Resolved light/dark for the surrounding ThemeProvider — undefined while
  // localStorage hydration is still pending. Cycling waits for a resolved
  // value before starting so the first step doesn't anchor on the wrong
  // phase.
  resolvedThemeMode: 'light' | 'dark' | undefined;
  setLightThemeName: (theme: LightThemeName) => void;
  setDarkThemeName: (theme: DarkThemeName) => void;
  setColorMode: (mode: ColorMode) => void;
}

interface UseThemeCycleArgs extends ThemeCycleThemeState {
  running: boolean;
  stepSeconds: ThemeCycleDurationSeconds | null;
}

// Drives a sweep through every catalog theme, alternating light and dark on
// each step so every tick flips the color scheme. The rotation is anchored on
// the currently active theme so the visible state doesn't jump. The first
// time cycling runs, every theme is resolved up front so steps never wait on a
// theme load.
export function useThemeCycle({
  running,
  stepSeconds,
  lightThemeName,
  darkThemeName,
  resolvedThemeMode,
  setLightThemeName,
  setDarkThemeName,
  setColorMode,
}: UseThemeCycleArgs): void {
  const cycling = running && stepSeconds != null;
  const [themesPreloaded, setThemesPreloaded] = useState(false);
  const preloadStartedRef = useRef(false);
  const workerPool = useWorkerPool();

  // Capture the latest theme state in refs so the cycle effect doesn't
  // restart its interval (and re-anchor the rotation order) every time
  // the cycle advances. Each tick reads the same captured sequence. One ref
  // per value, so each only updates when its own value changes.
  const lightThemeNameRef = useLatestValueRef(lightThemeName);
  const darkThemeNameRef = useLatestValueRef(darkThemeName);
  const resolvedThemeModeRef = useLatestValueRef(resolvedThemeMode);

  useEffect(() => {
    if (!cycling || preloadStartedRef.current) return;
    preloadStartedRef.current = true;
    // Themes resolve into the same cache the active highlighter reads from,
    // whether that's highlights on the main thread or the worker pool.
    resolveThemes(
      [...docsThemeCatalog.getThemeNames()],
      workerPool?.getPreferredHighlighter() ?? getPreferredHighlighter()
    )
      .catch((error: unknown) => {
        console.error('Failed to preload themes for cycling', error);
      })
      .finally(() => setThemesPreloaded(true));
  }, [cycling, workerPool]);

  useEffect(() => {
    if (!cycling || stepSeconds == null || !themesPreloaded) return undefined;
    const startMode = resolvedThemeModeRef.current ?? 'light';
    // Snapshot the catalog once per cycle start; each tick reads the same
    // captured sequence.
    const lightThemes = docsThemeCatalog.getThemeNames({
      colorScheme: 'light',
    });
    const darkThemes = docsThemeCatalog.getThemeNames({ colorScheme: 'dark' });
    const lightStartIdx = Math.max(
      0,
      lightThemes.indexOf(lightThemeNameRef.current)
    );
    const darkStartIdx = Math.max(
      0,
      darkThemes.indexOf(darkThemeNameRef.current)
    );
    type Step =
      | { mode: 'light'; theme: LightThemeName }
      | { mode: 'dark'; theme: DarkThemeName };
    const lightStep = (i: number): Step => ({
      mode: 'light',
      theme: lightThemes[(lightStartIdx + i) % lightThemes.length],
    });
    const darkStep = (i: number): Step => ({
      mode: 'dark',
      theme: darkThemes[(darkStartIdx + i) % darkThemes.length],
    });
    // Interleave the two schemes, starting with the active one. The shorter
    // list wraps so every theme in the longer list still gets a turn.
    const order: Step[] = [];
    for (let i = 0; i < Math.max(lightThemes.length, darkThemes.length); i++) {
      if (startMode === 'dark') {
        order.push(darkStep(i), lightStep(i));
      } else {
        order.push(lightStep(i), darkStep(i));
      }
    }
    // Tick 0 is the already-active theme — start advancing from the next
    // entry so the first interval fires onto something new.
    let idx = 1;
    const tick = () => {
      const step = order[idx % order.length];
      if (step.mode === 'light') {
        setLightThemeName(step.theme);
        setColorMode('light');
      } else {
        setDarkThemeName(step.theme);
        setColorMode('dark');
      }
      idx++;
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
    setColorMode,
  ]);
}
