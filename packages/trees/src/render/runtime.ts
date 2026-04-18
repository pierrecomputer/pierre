import { h, hydrate, render } from 'preact';

import type { FileTreeViewProps } from '../model/types';
import { FileTreeView } from './FileTreeView';

export const fileTreeRenderer: {
  hydrateRoot: (element: HTMLElement, props: FileTreeViewProps) => void;
  renderRoot: (element: HTMLElement, props: FileTreeViewProps) => void;
  unmountRoot: (element: HTMLElement) => void;
} = {
  hydrateRoot: (element, props) => {
    hydrate(h(FileTreeView, props), element);
  },
  renderRoot: (element, props) => {
    render(h(FileTreeView, props), element);
  },
  unmountRoot: (element) => {
    render(null, element);
  },
};

export function renderFileTreeRoot(
  element: HTMLElement,
  props: FileTreeViewProps
): void {
  fileTreeRenderer.renderRoot(element, props);
}

export function hydrateFileTreeRoot(
  element: HTMLElement,
  props: FileTreeViewProps
): void {
  fileTreeRenderer.hydrateRoot(element, props);
}

export function unmountFileTreeRoot(element: HTMLElement): void {
  fileTreeRenderer.unmountRoot(element);
}
