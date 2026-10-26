'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { getPreferredHighlighter } from '@/lib/preferredHighlighter';

export function PreloadHighlighter() {
  // Preloading here could conflict with the playground's selected backend.
  const isPlayground = usePathname().startsWith('/playground');
  useEffect(() => {
    if (isPlayground) return;
    void preloadHighlighter({
      preferredHighlighter: getPreferredHighlighter(),
      themes: [
        'pierre-dark',
        'pierre-dark-soft',
        'pierre-light',
        'pierre-light-soft',
      ],
      langs: ['zig', 'rust', 'typescript', 'tsx', 'bash'],
    }).catch((error: unknown) => console.error(error));
  }, [isPlayground]);
  return null;
}
