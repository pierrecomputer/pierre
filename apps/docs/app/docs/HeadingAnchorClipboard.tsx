'use client';

import { useEffect } from 'react';

/**
 * Adds clipboard copy functionality to heading anchors created by rehype-autolink-headings
 */
export function HeadingAnchorClipboard() {
  useEffect(() => {
    const handleAnchorClick = (e: Event) => {
      const target = e.currentTarget as HTMLAnchorElement;
      const url = `${window.location.origin}${window.location.pathname}${target.hash}`;

      void navigator.clipboard.writeText(url).catch((err) => {
        console.warn('Failed to copy to clipboard:', err);
      });
    };

    const timeoutId = setTimeout(() => {
      const anchors = document.querySelectorAll('a.heading-anchor');
      for (const anchor of anchors) {
        anchor.addEventListener('click', handleAnchorClick);
      }
    }, 150);

    return () => {
      clearTimeout(timeoutId);
      const anchors = document.querySelectorAll('a.heading-anchor');
      for (const anchor of anchors) {
        anchor.removeEventListener('click', handleAnchorClick);
      }
    };
  }, []);

  return null;
}
