'use client';

import {
  type CSSProperties,
  type ComponentType,
  useEffect,
  useRef,
} from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import type { PreloadedFileDiffResult } from './FileDiffServer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface LineAnnotation<TProps = any> {
  line: number;
  side: 'additions' | 'deletions';
  // For proper hydration, pass props instead of a render function
  Component: ComponentType<TProps>;
  props: TProps;
}

interface FileDiffSsrProps {
  preloadedFileDiff: PreloadedFileDiffResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  annotations?: LineAnnotation<any>[];
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

    // Render annotations as static HTML slots with props serialized for hydration
    const annotationSlots =
      annotations !== undefined && annotations.length > 0
        ? annotations
            .map(({ line, side, Component, props }) => {
              const slotName = `annotation-${side}-${line}`;
              // Serialize props for client-side hydration
              const propsJson = escapeHtml(JSON.stringify(props));
              // Render the component with React markers for proper hydration
              const content = renderToString(<Component {...props} />);
              return `<div slot="${slotName}" data-props="${propsJson}">${content}</div>`;
            })
            .join('')
        : '';

    const fullHTML = `<file-diff${classAttr}${styleAttr}>${preloadedFileDiff.dangerouslySetInnerHTML.__html}${annotationSlots}</file-diff>`;

    htmlObjectRef.current = { __html: fullHTML };
  }

  useEffect(() => {
    // After mount, hydrate the slots with React using serialized props
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
            const propsJson = slotElement.getAttribute('data-props');
            const props = propsJson ? JSON.parse(propsJson) : {};

            hydrateRoot(slotElement, <annotation.Component {...props} />);
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
