'use client';

import { useEffect } from 'react';

// SVG markup for the hash icon
const HASH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentcolor" viewBox="0 0 16 16" width="1em" height="1em" class="pi"><path d="M11.78 2.544a.75.75 0 1 1 1.44.412L12.78 4.5h.97a.75.75 0 0 1 0 1.5h-1.4l-1 3.5h1.4a.75.75 0 0 1 0 1.5h-1.827l-.702 2.456a.75.75 0 1 1-1.442-.412L9.363 11h-4.44l-.702 2.456a.75.75 0 1 1-1.442-.412L3.363 11H2.5a.75.75 0 0 1 0-1.5h1.292l1-3.5H3.75a.75.75 0 0 1 0-1.5h1.47l.56-1.956a.75.75 0 1 1 1.44.412L6.78 4.5h4.44zM5.35 9.5h4.442l1-3.5H6.351z" /></svg>`;

/**
 * Adds permalink anchors to all headings with IDs.
 * Shows a clickable hash symbol on hover that updates the URL.
 */
export function HeadingAnchors() {
  useEffect(() => {
    // Wait for DocsSidebar to set IDs on headings
    const timeoutId = setTimeout(() => {
      const headings = document.querySelectorAll('h2[id], h3[id], h4[id]');

      for (const heading of headings) {
        if (!(heading instanceof HTMLElement)) continue;

        if (heading.querySelector('.heading-anchor') != null) continue;

        // Create anchor element
        const anchor = document.createElement('a');
        anchor.href = `#${heading.id}`;
        anchor.className = 'heading-anchor';
        anchor.ariaLabel = 'Link to this section';
        anchor.innerHTML = HASH_ICON_SVG;

        anchor.addEventListener('click', () => {
          const url = `${window.location.origin}${window.location.pathname}#${heading.id}`;

          void navigator.clipboard.writeText(url).catch((err) => {
            console.warn('Failed to copy to clipboard:', err);
          });
        });

        heading.appendChild(anchor);
      }
    }, 150);

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  return null;
}
