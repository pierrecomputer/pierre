'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';

export function PreloadHighlighter() {
  useEffect(() => {
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
