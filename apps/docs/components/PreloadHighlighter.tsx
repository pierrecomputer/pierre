'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

export function PreloadHighlighter() {
  useEffect(() => {
    void preloadHighlighter({
      themes: [
        'pierre-dark',
        'pierre-dark-soft',
        'pierre-light',
        'pierre-light-soft',
      ],
    });
  }, []);
  return null;
}
