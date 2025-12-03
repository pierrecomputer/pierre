'use client';

import { IconHash } from '@/components/icons';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Adds permalink anchors to all headings with IDs.
 * Shows a clickable hash symbol on hover that updates the URL.
 */
export function HeadingAnchors() {
  useEffect(() => {
    const roots: ReturnType<typeof createRoot>[] = [];

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

        const root = createRoot(anchor);
        root.render(<IconHash size="1em" />);
        roots.push(root);

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
      for (const root of roots) {
        root.unmount();
      }
    };
  }, []);

  return null;
}
