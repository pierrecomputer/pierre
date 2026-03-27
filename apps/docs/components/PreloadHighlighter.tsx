'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

export function PreloadHighlighter() {
  useEffect(() => {
    void preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: ['zig', 'rust', 'typescript', 'tsx'],
      preferredHighlighter: 'shiki-wasm',
    });
  }, []);
  return null;
}
