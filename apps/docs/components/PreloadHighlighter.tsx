'use client';
import { canUseWASM, preloadHighlighter } from '@pierre/diffs';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function PreloadHighlighter() {
  // Preloading here could conflict with the playground's selected backend, or
  // with the shiki-js worker pool used when WebAssembly is unavailable.
  const isPlayground = usePathname().startsWith('/playground');
  useEffect(() => {
    if (isPlayground || !canUseWASM()) return;
    void preloadHighlighter({
      preferredHighlighter: 'highlights',
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
