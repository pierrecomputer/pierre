'use client';

import {
  DEFAULT_CODE_VIEW_FILE_METRICS,
  dequeueRender,
  queueRender,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  THEME_CYCLE_DURATIONS_SECONDS,
  type ThemeCycleDurationSeconds,
  type ThemeCycleThemeState,
  useThemeCycle,
} from './useThemeCycle';
import type { CommentMetadata } from '@/lib/types';

export interface StressTestState {
  playing: boolean;
  // Play is only available when at least one stress is enabled.
  canPlay: boolean;
  scrollEnabled: boolean;
  // null means theme switching is off.
  themeStepSeconds: ThemeCycleDurationSeconds | null;
  togglePlaying(): void;
  toggleScroll(): void;
  bumpThemeInterval(): void;
}

interface UseStressTestArgs extends ThemeCycleThemeState {
  viewerRef: RefObject<CodeViewHandle<CommentMetadata, undefined> | null>;
}

// Owns the stress test: play/pause runs whichever stresses are enabled —
// autoscrolling the CodeView at two viewports per frame and/or cycling themes
// at the selected interval. Turning off the last enabled stress stops the run.
export function useStressTest({
  viewerRef,
  ...themeState
}: UseStressTestArgs): StressTestState {
  const [playing, setPlaying] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [themeStepSeconds, setThemeStepSeconds] =
    useState<ThemeCycleDurationSeconds | null>(null);
  const canPlay = scrollEnabled || themeStepSeconds != null;

  const togglePlaying = useCallback(() => {
    setPlaying((current) => !current && canPlay);
  }, [canPlay]);

  const toggleScroll = useCallback(() => {
    setScrollEnabled(!scrollEnabled);
    if (scrollEnabled && themeStepSeconds == null) {
      setPlaying(false);
    }
  }, [scrollEnabled, themeStepSeconds]);

  // Steps off → each interval → off.
  const bumpThemeInterval = useCallback(() => {
    const idx =
      themeStepSeconds == null
        ? -1
        : THEME_CYCLE_DURATIONS_SECONDS.indexOf(themeStepSeconds);
    const next = THEME_CYCLE_DURATIONS_SECONDS[idx + 1] ?? null;
    setThemeStepSeconds(next);
    if (next == null && !scrollEnabled) {
      setPlaying(false);
    }
  }, [scrollEnabled, themeStepSeconds]);

  useThemeCycle({
    ...themeState,
    running: playing,
    stepSeconds: themeStepSeconds,
  });

  // Scrolls two viewports per frame, bouncing off the top and bottom.
  useEffect(() => {
    if (!playing || !scrollEnabled) return undefined;
    let direction = 1;
    const render = () => {
      const { current: viewerHandle } = viewerRef;
      const viewer = viewerHandle?.getInstance();
      if (viewerHandle != null && viewer != null) {
        const scrollTop = viewer.getScrollTop();
        const clientHeight = viewer.getHeight();
        const maxScrollTop = viewer.getScrollHeight() - clientHeight;
        if (direction > 0 && scrollTop >= maxScrollTop) {
          direction = -1;
        } else if (direction < 0 && scrollTop <= 0) {
          direction = 1;
        }
        viewerHandle.scrollTo({
          type: 'position',
          position:
            scrollTop +
            clientHeight * 2 * direction +
            Math.random() * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight,
        });
      }
      queueRender(render);
    };
    queueRender(render);
    return () => dequeueRender(render);
  }, [playing, scrollEnabled, viewerRef]);

  return useMemo(
    () => ({
      playing,
      canPlay,
      scrollEnabled,
      themeStepSeconds,
      togglePlaying,
      toggleScroll,
      bumpThemeInterval,
    }),
    [
      playing,
      canPlay,
      scrollEnabled,
      themeStepSeconds,
      togglePlaying,
      toggleScroll,
      bumpThemeInterval,
    ]
  );
}
