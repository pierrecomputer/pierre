'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

import { canUseWasm } from '@/lib/canUseWasm';
import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';

export function PreloadHighlighter() {
  useEffect(() => {
    if (!canUseWasm()) {
      return;
    }
    void preloadHighlighter({
      themes: [
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
