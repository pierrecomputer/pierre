'use client';
import { canUseWASM, preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';
import { HIGHLIGHT_THEME_NAME } from '@/lib/theme/highlightTheme';

export function PreloadHighlighter() {
  useEffect(() => {
    if (!canUseWASM()) {
      return;
    }
    void preloadHighlighter({
      themes: [
        HIGHLIGHT_THEME_NAME,
        'pierre-dark',
        'pierre-dark-soft',
        'pierre-light',
        'pierre-light-soft',
      ],
      langs: ['zig', 'rust', 'typescript', 'tsx', 'bash'],
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
    });
  }, []);
  return null;
}
