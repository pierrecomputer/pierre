'use client';

import { preloadHighlighter } from '@pierre/precision-diffs';
import { memo, useEffect } from 'react';

export const ShikiPreloader = memo(function ShikiPreloader() {
  useEffect(() => {
    void preloadHighlighter({
      langs: ['zig', 'typescript', 'tsx', 'css', 'sh'],
      themes: ['pierre-dark', 'pierre-light'],
    });
  }, []);
  return null;
});
