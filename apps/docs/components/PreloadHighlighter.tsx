'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function PreloadHighlighter() {
  // The playground loads the backend its visitor selects, and a page can load
  // only one highlighter type, so preload again once it is left.
  const isPlayground = usePathname().startsWith('/playground');
  useEffect(() => {
    if (isPlayground) return;
    void preloadHighlighter({
      themes: [
        'pierre-dark',
        'pierre-dark-soft',
        'pierre-light',
        'pierre-light-soft',
      ],
      langs: ['zig', 'rust', 'typescript', 'tsx', 'bash'],
      preferredHighlighter: 'shiki-wasm',
    }).catch((error: unknown) => console.error(error));
  }, [isPlayground]);
  return null;
}
