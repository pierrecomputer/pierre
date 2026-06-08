'use client';

import { type ColorMode } from '@pierre/theme-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DarkThemeName, LightThemeName } from './themeNames';
import { docsThemeCatalog } from '@/components/themeCatalog';

// Step durations available on the System Monitor's theme-cycle button.
// Plain-clicking the button advances through these in order; the
// shift-click gesture starts/stops the actual rotation.
export const THEME_CYCLE_DURATIONS_SECONDS = [3, 0.8, 0.4, 0.1] as const;

export type ThemeCycleDurationSeconds =
  (typeof THEME_CYCLE_DURATIONS_SECONDS)[number];

export interface ThemeCycleControls {
  cycling: boolean;
  stepSeconds: ThemeCycleDurationSeconds;
  bumpDuration(): void;
  toggleCycle(): void;
}

interface UseThemeCycleArgs {
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

// Drives a sweep through every available Shiki theme — all the light
// themes, then all the dark themes, then back around — so users can
// preview the full catalog without manually picking each one. The
// rotation order is built once when cycling kicks off, anchored on
// whichever theme is currently active so the visible state doesn't jump,
// and the sweep walks the rest of that phase, the opposite phase, and
// then loops back to where it started.
export function useThemeCycle({
  lightThemeName,
  darkThemeName,
  resolvedThemeMode,
  setLightThemeName,
  setDarkThemeName,
  setColorMode,
}: UseThemeCycleArgs): ThemeCycleControls {
  const [stepSeconds, setStepSeconds] = useState<ThemeCycleDurationSeconds>(3);
  const [cycling, setCycling] = useState(false);

  // Capture the latest theme state in refs so the cycle effect doesn't
  // restart its interval (and re-anchor the rotation order) every time
  // the cycle advances. Each tick reads the same captured sequence.
  const lightThemeNameRef = useRef(lightThemeName);
  const darkThemeNameRef = useRef(darkThemeName);
  const resolvedModeRef = useRef(resolvedThemeMode);
  lightThemeNameRef.current = lightThemeName;
  darkThemeNameRef.current = darkThemeName;
  resolvedModeRef.current = resolvedThemeMode;

  const bumpDuration = useCallback(() => {
    setStepSeconds((prev) => {
      const idx = THEME_CYCLE_DURATIONS_SECONDS.indexOf(prev);
      return THEME_CYCLE_DURATIONS_SECONDS[
        (idx + 1) % THEME_CYCLE_DURATIONS_SECONDS.length
      ];
    });
  }, []);

  const toggleCycle = useCallback(() => {
    setCycling((c) => !c);
  }, []);

  useEffect(() => {
    if (!cycling) return undefined;
    const startMode = resolvedModeRef.current ?? 'light';
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
    const lightSequence: Step[] = lightThemes.map((theme) => ({
      mode: 'light',
      theme,
    }));
    const darkSequence: Step[] = darkThemes.map((theme) => ({
      mode: 'dark',
      theme,
    }));
    const order: Step[] =
      startMode === 'dark'
        ? [
            ...darkSequence.slice(darkStartIdx),
            ...lightSequence,
            ...darkSequence.slice(0, darkStartIdx),
          ]
        : [
            ...lightSequence.slice(lightStartIdx),
            ...darkSequence,
            ...lightSequence.slice(0, lightStartIdx),
          ];
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
  }, [cycling, stepSeconds, setLightThemeName, setDarkThemeName, setColorMode]);

  return useMemo(
    () => ({ cycling, stepSeconds, bumpDuration, toggleCycle }),
    [cycling, stepSeconds, bumpDuration, toggleCycle]
  );
}
