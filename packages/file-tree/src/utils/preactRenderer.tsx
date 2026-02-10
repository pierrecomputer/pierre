import { hydrate, render } from 'preact';

import type { FileTreeRootProps } from '../components/Root';
import { Root } from '../components/Root';

/**
 * Mutable renderer implementation so tests can stub Preact rendering/hydration
 * in jsdom (Preact 11 beta can crash there).
 */
export const preactRenderer: {
  renderRoot: (element: HTMLElement, props: FileTreeRootProps) => void;
  hydrateRoot: (element: HTMLElement, props: FileTreeRootProps) => void;
  unmountRoot: (element: HTMLElement) => void;
} = {
  renderRoot: (element, props) => {
    render(<Root {...props} />, element);
  },
  hydrateRoot: (element, props) => {
    hydrate(<Root {...props} />, element);
  },
  unmountRoot: (element) => {
    render(null, element);
  },
};

export function preactRenderRoot(
  element: HTMLElement,
  props: FileTreeRootProps
): void {
  preactRenderer.renderRoot(element, props);
}

export function preactHydrateRoot(
  element: HTMLElement,
  props: FileTreeRootProps
): void {
  preactRenderer.hydrateRoot(element, props);
}

export function preactUnmountRoot(element: HTMLElement): void {
  preactRenderer.unmountRoot(element);
}
