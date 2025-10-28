'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import type { DiffLineAnnotation } from '../types';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';

interface FileDiffSsrProps<LAnnotation> {
  prerenderedHTML: string;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
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

export function FileDiffSsr<LAnnotation>({
  prerenderedHTML,
  annotations,
  className,
  style,
  renderAnnotation,
}: FileDiffSsrProps<LAnnotation>): React.JSX.Element {
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
      annotations !== undefined &&
      annotations.length > 0 &&
      renderAnnotation != null
        ? annotations
            .map((annotation) => {
              const slotName = getLineAnnotationName(annotation);
              // Render the component with React markers for proper hydration
              const content = renderToString(renderAnnotation(annotation));
              return `<div slot="${slotName}">${content}</div>`;
            })
            .join('')
        : '';

    const fullHTML = `<file-diff${classAttr}${styleAttr}><template shadowrootmode="open">${prerenderedHTML}</template>${annotationSlots}</file-diff>`;

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
          const annotation = annotations.find((annotation) => {
            return slotName === getLineAnnotationName(annotation);
          });

          if (annotation !== undefined && renderAnnotation != null) {
            hydrateRoot(slotElement, renderAnnotation(annotation));
          }
        });

        hydratedRef.current = true;
      }
    }
  }, [annotations, renderAnnotation]);

  return (
    <div
      ref={wrapperRef}
      dangerouslySetInnerHTML={htmlObjectRef.current}
      suppressHydrationWarning
    />
  );
}
