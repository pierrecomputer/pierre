// The layout element of each layout object that a `Root` renders, so that a
// hook such as `useCover` takes the layout object of the app.
import type { CoreLayoutStore } from '../store';

const elements = new WeakMap<CoreLayoutStore, HTMLElement>();

/** Register the layout element of a layout object, or remove it with null. */
export function registerLayoutElement(
  layout: CoreLayoutStore,
  element: HTMLElement | null
): void {
  if (element === null) elements.delete(layout);
  else elements.set(layout, element);
}

/** The layout element of a layout object, or null before its `Root` mounts. */
export const layoutElementOf = (layout: CoreLayoutStore): HTMLElement | null =>
  elements.get(layout) ?? null;
