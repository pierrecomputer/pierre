'use client';

import { type CSSProperties, useEffect, useRef } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import type { PreloadedFileDiffResult } from './FileDiffServer';

export interface LineAnnotation {
  line: number;
  side: 'additions' | 'deletions';
  render: () => React.ReactElement;
}

/**
 * Helper to extract annotation positions for preloadFileDiff.
 * This allows you to define annotations once with render functions,
 * then extract just the positions for SSR.
 */
export function getAnnotationPositions(
  annotations: LineAnnotation[]
): Array<{ lineNumber: number; side: 'additions' | 'deletions' }> {
  return annotations.map(({ line, side }) => ({
    lineNumber: line,
    side,
  }));
}

interface FileDiffSsrProps {
  preloadedFileDiff: PreloadedFileDiffResult;
  annotations?: LineAnnotation[];
  className?: string;
  style?: CSSProperties;
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function serializeStyle(style: CSSProperties): string {
  return Object.entries(style)
    .map(([key, value]) => {
      // Convert camelCase to kebab-case
      const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      // Escape the value for safety
      return `${kebabKey}:${escapeHtml(String(value))}`;
    })
    .join(';');
}

export function FileDiffSsr({
  preloadedFileDiff,
  annotations,
  className,
  style,
}: FileDiffSsrProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hydratedRef = useRef(false);

  // Store the HTML object in a ref so it has a stable reference
  // This prevents React from trying to update innerHTML on every render
  const htmlObjectRef = useRef<{ __html: string } | null>(null);

  if (htmlObjectRef.current === null) {
    // Build the full HTML string with the custom element and DSD
    const classAttr =
      className !== undefined ? ` class="${escapeHtml(className)}"` : '';
    const styleAttr =
      style !== undefined ? ` style="${serializeStyle(style)}"` : '';

    // Render annotations as static HTML slots for SSR
    const annotationSlots =
      annotations !== undefined && annotations.length > 0
        ? annotations
            .map(({ line, side, render }) => {
              const slotName = `annotation-${side}-${line}`;
              // Render the component with React markers for proper hydration
              const content = renderToString(render());
              return `<div slot="${slotName}">${content}</div>`;
            })
            .join('')
        : '';

    const fullHTML = `<file-diff${classAttr}${styleAttr}>${preloadedFileDiff.dangerouslySetInnerHTML.__html}${annotationSlots}</file-diff>`;

    htmlObjectRef.current = { __html: fullHTML };
  }

  useEffect(() => {
    // After mount, hydrate the slots with React using render functions
    if (
      wrapperRef.current !== null &&
      annotations !== undefined &&
      !hydratedRef.current
    ) {
      const fileElement = wrapperRef.current.querySelector('file-diff');

      if (fileElement !== null) {
        Array.from(fileElement.children).forEach((slotElement) => {
          if (!(slotElement instanceof HTMLElement)) return;

          const slotName = slotElement.getAttribute('slot');
          if (slotName === null) return;

          // Find the matching annotation
          const annotation = annotations.find(({ line, side }) => {
            return slotName === `annotation-${side}-${line}`;
          });

          if (annotation !== undefined) {
            hydrateRoot(slotElement, annotation.render());
          }
        });

        hydratedRef.current = true;
      }
    }
  }, [annotations]);

  return (
    <div
      ref={wrapperRef}
      dangerouslySetInnerHTML={htmlObjectRef.current}
      suppressHydrationWarning
    />
  );
}
