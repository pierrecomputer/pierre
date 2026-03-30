'use client';

import '@pierre/trees/web-components';
import { useCallback } from 'react';

interface PreviewItemState {
  label: string;
  attrs: Record<string, string>;
  forceHover?: boolean;
}

const ITEM_STATES: PreviewItemState[] = [
  { label: 'Default', attrs: {} },
  { label: 'Hover', attrs: {}, forceHover: true },
  { label: 'Focused', attrs: { 'data-item-focused': 'true' } },
  { label: 'Selected', attrs: { 'data-item-selected': 'true' } },
  {
    label: 'Selected + Focused',
    attrs: { 'data-item-selected': 'true', 'data-item-focused': 'true' },
  },
  { label: 'Search Match', attrs: { 'data-item-search-match': 'true' } },
];

function buildPreviewItemHtml(state: PreviewItemState): string {
  const attrs = Object.entries(state.attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const forceStyle =
    state.forceHover === true
      ? ' style="background-color: var(--trees-bg-muted)"'
      : '';
  return `<button data-type="item" data-item-type="file" ${attrs}${forceStyle} tabindex="-1">
    <div data-item-section="icon">
      <svg data-icon-name="file-tree-icon-file" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <use href="#file-tree-icon-file" />
      </svg>
    </div>
    <div data-item-section="content">${state.label}</div>
  </button>`;
}

const PREVIEW_SPRITE = `<svg data-icon-sprite aria-hidden="true" width="0" height="0" style="position:absolute">
  <symbol id="file-tree-icon-file" viewBox="0 0 16 16">
    <path fill="currentcolor" d="M10.75 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v9A2.75 2.75 0 0 1 12.25 16h-8.5A2.75 2.75 0 0 1 1 13.25V2.75A2.75 2.75 0 0 1 3.75 0zm-7 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5h-1.25A2.25 2.25 0 0 1 10 2.75V1.5z" />
  </symbol>
</svg>`;

function useItemStatePreviewRef(colorScheme: 'light' | 'dark') {
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;
      const container = node.querySelector('file-tree-container');
      if (!(container instanceof HTMLElement)) return;
      container.style.colorScheme = colorScheme;
      const shadowRoot =
        container.shadowRoot ?? container.attachShadow({ mode: 'open' });

      const itemsHtml = ITEM_STATES.map((s) => buildPreviewItemHtml(s)).join(
        ''
      );
      shadowRoot.innerHTML = `${PREVIEW_SPRITE}<div role="tree">${itemsHtml}</div>`;
    },
    [colorScheme]
  );
}

export function ItemStatePreview() {
  const lightRef = useItemStatePreviewRef('light');
  const darkRef = useItemStatePreviewRef('dark');

  return (
    <div
      className="mb-6 rounded-sm border p-4"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <h4 className="text-lg font-bold">Item States</h4>
      <p className="text-muted-foreground mb-3 text-xs">
        Static preview of every tree item visual state in light and dark mode
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div ref={lightRef}>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Light
          </p>
          <file-tree-container
            className="rounded-lg border p-3"
            style={{ '--trees-gap-override': '2px' } as React.CSSProperties}
          />
        </div>
        <div ref={darkRef}>
          <p className="text-muted-foreground mb-1 text-xs font-medium">Dark</p>
          <file-tree-container
            className="rounded-lg border p-3"
            style={{ '--trees-gap-override': '2px' } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
