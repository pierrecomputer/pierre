import { hydrate, render } from 'preact';

import { Root } from '../components/Root';

export function preactRenderRoot(element: HTMLElement, props: any): void {
  render(<Root {...props} />, element);
}

export function preactHydrateRoot(element: HTMLElement, props: any): void {
  hydrate(<Root {...props} />, element);
}
