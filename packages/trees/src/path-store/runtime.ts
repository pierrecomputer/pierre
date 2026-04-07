import { h, hydrate, render } from 'preact';

import type { PathStoreTreesViewProps } from './types';
import { PathStoreTreesView } from './view';

export const pathStoreTreesRenderer: {
  hydrateRoot: (element: HTMLElement, props: PathStoreTreesViewProps) => void;
  renderRoot: (element: HTMLElement, props: PathStoreTreesViewProps) => void;
  unmountRoot: (element: HTMLElement) => void;
} = {
  hydrateRoot: (element, props) => {
    hydrate(h(PathStoreTreesView, props), element);
  },
  renderRoot: (element, props) => {
    render(h(PathStoreTreesView, props), element);
  },
  unmountRoot: (element) => {
    render(null, element);
  },
};

export function renderPathStoreTreesRoot(
  element: HTMLElement,
  props: PathStoreTreesViewProps
): void {
  pathStoreTreesRenderer.renderRoot(element, props);
}

export function hydratePathStoreTreesRoot(
  element: HTMLElement,
  props: PathStoreTreesViewProps
): void {
  pathStoreTreesRenderer.hydrateRoot(element, props);
}

export function unmountPathStoreTreesRoot(element: HTMLElement): void {
  pathStoreTreesRenderer.unmountRoot(element);
}
