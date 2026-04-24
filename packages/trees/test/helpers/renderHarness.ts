import { JSDOM } from 'jsdom';

import { type FileTreeVisibleRow } from '../../src/index';
import { computeFileTreeLayout } from '../../src/model/layout';
import {
  FILE_TREE_DEFAULT_ITEM_HEIGHT,
  FILE_TREE_DEFAULT_OVERSCAN,
} from '../../src/model/virtualization';

export function createResizeObserverEntry(
  borderBoxSize: unknown,
  contentRectHeight: number
): ResizeObserverEntry {
  return {
    borderBoxSize,
    contentRect: { height: contentRectHeight },
  } as unknown as ResizeObserverEntry;
}

export function getFocusedTreeElement(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLElement | null {
  const activeElement = shadowRoot?.activeElement ?? null;
  return activeElement instanceof dom.window.HTMLElement ? activeElement : null;
}

export function getItemButton(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot?.querySelector(
    `[data-item-path="${path}"]:not([data-file-tree-sticky-row="true"])`
  );
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing button for ${path}`);
  }

  return button;
}

export function getTreeRoot(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const root = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-root="true"]'
  );
  if (!(root instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing tree root');
  }

  return root;
}

export function getUnsafeCssStyle(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLStyleElement | null {
  const style = shadowRoot?.querySelector('style[data-file-tree-unsafe-css]');
  return style instanceof dom.window.HTMLStyleElement ? style : null;
}

export function getVirtualList(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const list = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-list="true"]'
  );
  if (!(list instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized list');
  }

  return list;
}

export function getVirtualStickyOffset(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const offset = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-sticky-offset="true"]'
  );
  if (!(offset instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized sticky offset');
  }

  return offset;
}

export function getVirtualStickyWindow(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const windowElement = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-sticky="true"]'
  );
  if (!(windowElement instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing virtualized sticky window');
  }

  return windowElement;
}

export function getPixelStyleValue(
  element: HTMLElement,
  property: 'bottom' | 'height' | 'top'
): number {
  const value = element.style.getPropertyValue(property);
  return Number.parseFloat(value === '' ? '0' : value);
}

export function getTranslateYStyleValue(element: HTMLElement): number {
  const match = element.style.transform.match(
    /translateY\((-?\d+(?:\.\d+)?)px\)/
  );
  return Number.parseFloat(match?.[1] ?? '0');
}
export function clickItem(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string,
  init: MouseEventInit = {}
): void {
  const buttonElement = getItemButton(shadowRoot, dom, path);
  buttonElement.dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true, ...init })
  );
}

export function pressKey(
  target: HTMLElement,
  dom: JSDOM,
  key: string,
  init: KeyboardEventInit = {}
): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      key,
      ...init,
    })
  );
}

export function getSelectedItemPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  return Array.from(
    shadowRoot?.querySelectorAll(
      '[data-item-selected="true"]:not([data-file-tree-sticky-row="true"])'
    ) ?? []
  )
    .filter(
      (element): element is HTMLButtonElement =>
        element instanceof dom.window.HTMLButtonElement
    )
    .filter((button) => button.dataset.itemParked !== 'true')
    .map((button) => button.dataset.itemPath)
    .filter((path): path is string => path != null);
}

export function getFocusedItemPath(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string | null {
  const button = shadowRoot?.querySelector(
    'button[data-type="item"][tabindex="0"]:not([data-file-tree-sticky-row="true"])'
  );
  return button instanceof dom.window.HTMLButtonElement
    ? (button.dataset.itemPath ?? null)
    : null;
}

export function getRowSectionOrder(button: HTMLButtonElement): string[] {
  return Array.from(button.children)
    .map((child) => child.getAttribute('data-item-section'))
    .filter((section): section is string => section != null);
}

export function getNormalizedText(element: Element | null | undefined): string {
  return element?.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '';
}

export function getStickyRowPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  // The overlay's rows are pre-populated into the DOM even at scrollTop=0 so
  // the first scroll paint doesn't have to wait on React to mount them; CSS
  // hides that preview when `data-scroll-at-top` is set AND `data-overlay-
  // reveal` is absent. Mirror that selector exactly so these tests catch a
  // regression where the preview leaks through at the top (e.g. if the reveal
  // flag gets stuck set, or the hide rule breaks).
  const root = shadowRoot?.querySelector<HTMLElement>(
    '[data-file-tree-virtualized-root="true"]'
  );
  const previewHidden =
    root instanceof dom.window.HTMLElement &&
    root.dataset.scrollAtTop === 'true' &&
    root.dataset.overlayReveal == null;
  if (previewHidden) {
    return [];
  }
  return Array.from(
    shadowRoot?.querySelectorAll('[data-file-tree-sticky-path]') ?? []
  )
    .filter(
      (element): element is HTMLElement =>
        element instanceof dom.window.HTMLElement
    )
    .map((element) => element.dataset.fileTreeStickyPath)
    .filter((path): path is string => path != null);
}

export function getStickyRowButton(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot?.querySelector(
    `[data-file-tree-sticky-path="${path}"]`
  );
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing sticky row for ${path}`);
  }

  return button;
}

export function getStickyRowZIndex(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): number {
  const zIndex = getStickyRowButton(shadowRoot, dom, path).style.zIndex;
  return Number.parseInt(zIndex === '' ? '0' : zIndex, 10);
}
export function getMountedItemPaths(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): string[] {
  return Array.from(
    shadowRoot?.querySelectorAll(
      '[data-type="item"]:not([data-file-tree-sticky-row="true"])'
    ) ?? []
  )
    .filter(
      (element): element is HTMLButtonElement =>
        element instanceof dom.window.HTMLButtonElement
    )
    .filter((button) => button.dataset.itemParked !== 'true')
    .map((button) => button.dataset.itemPath)
    .filter((path): path is string => path != null);
}

export function getVisibleRowPath(row: FileTreeVisibleRow): string {
  return row.isFlattened
    ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ??
        row.path)
    : row.path;
}

export function getVisibleIndexForPath(
  controller: {
    getVisibleCount(): number;
    getVisibleRows(start: number, end: number): readonly FileTreeVisibleRow[];
  },
  path: string
): number {
  const visibleCount = controller.getVisibleCount();
  if (visibleCount <= 0) {
    return -1;
  }

  return controller
    .getVisibleRows(0, visibleCount - 1)
    .findIndex((row) => getVisibleRowPath(row) === path);
}

export function computeExpectedRenderedWindow(
  controller: {
    getVisibleCount(): number;
    getVisibleRows(start: number, end: number): readonly FileTreeVisibleRow[];
  },
  scrollTop: number,
  viewportHeight: number
) {
  const visibleCount = controller.getVisibleCount();
  const rows =
    visibleCount <= 0 ? [] : controller.getVisibleRows(0, visibleCount - 1);
  const layout = computeFileTreeLayout(rows, {
    itemHeight: FILE_TREE_DEFAULT_ITEM_HEIGHT,
    overscan: FILE_TREE_DEFAULT_OVERSCAN,
    scrollTop,
    viewportHeight,
  });
  const stickyPathSet = new Set(
    layout.sticky.rows.map((entry) => getVisibleRowPath(entry.row))
  );
  const mountedPaths =
    layout.window.startIndex < 0 ||
    layout.window.endIndex < layout.window.startIndex
      ? []
      : rows
          .slice(layout.window.startIndex, layout.window.endIndex + 1)
          .map((row) => getVisibleRowPath(row))
          .filter((path) => !stickyPathSet.has(path));

  return {
    layout,
    mountedPaths,
  };
}

export function clickStickyRow(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string,
  init: MouseEventInit = {}
): void {
  const button = shadowRoot?.querySelector(
    `[data-file-tree-sticky-path="${path}"]`
  );
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing sticky row for ${path}`);
  }

  button.dispatchEvent(
    new dom.window.MouseEvent('click', { bubbles: true, ...init })
  );
}
