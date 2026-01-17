import { hydrate, render } from 'preact';

import type { FileTreeRootProps } from '../components/Root';
import { Root } from '../components/Root';

export function preactRenderRoot(
  element: HTMLElement,
  props: FileTreeRootProps
): void {
  render(<Root {...props} />, element);
}

export function preactHydrateRoot(
  element: HTMLElement,
  props: FileTreeRootProps
): void {
  hydrate(<Root {...props} />, element);
}

export function preactUnmountRoot(element: HTMLElement): void {
  render(null, element);
}
