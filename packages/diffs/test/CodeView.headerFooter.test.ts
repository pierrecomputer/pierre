import { describe, expect, test } from 'bun:test';

import { CodeView, type CodeViewOptions } from '../src/components/CodeView';
import {
  CODE_VIEW_FOOTER_ATTRIBUTE,
  CODE_VIEW_HEADER_ATTRIBUTE,
  DEFAULT_CODE_VIEW_LAYOUT,
} from '../src/constants';
import type { CodeViewItem } from '../src/types';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFileItem,
  renderItems,
  wait,
} from './domHarness';

const ROOT_HEIGHT = 800;
const { paddingTop, paddingBottom } = DEFAULT_CODE_VIEW_LAYOUT;

function makeItems(count = 12, lineCount = 20): CodeViewItem[] {
  return Array.from({ length: count }, (_, index) =>
    makeFileItem(`file:${index}`, lineCount)
  );
}

function headerOption(): CodeViewOptions<undefined> {
  return { renderCodeViewHeader: () => document.createElement('div') };
}

// Assert a host is mounted and narrow away the `undefined` so it can be compared
// against `Element | null` DOM accessors.
function mustGetHost(host: HTMLElement | undefined): HTMLElement {
  if (!(host instanceof HTMLElement)) {
    throw new Error('expected header/footer host element to be mounted');
  }
  return host;
}

// jsdom performs no layout and the harness ResizeObserver is a no-op, so drive a
// host's height by invoking the private resize handler directly with a synthetic
// entry — the same path the real ResizeObserver would trigger. Flushes the
// re-anchor + queued render so callers can assert synchronously.
function resizeHost(
  viewer: CodeView,
  host: HTMLElement | undefined,
  blockSize: number
): void {
  if (host == null) {
    throw new Error('resizeHost: host element is not mounted');
  }
  const entry = {
    target: host,
    borderBoxSize: [{ blockSize, inlineSize: 1000 }],
    contentBoxSize: [{ blockSize, inlineSize: 1000 }],
  } as unknown as ResizeObserverEntry;
  (
    viewer as unknown as {
      handleResize(entries: ResizeObserverEntry[]): void;
    }
  ).handleResize([entry]);
  viewer.render(true);
}

// jsdom returns a zero rect for unlaid-out elements; stub a host's rect so the
// synchronous inline measure (measureMountedHosts) reads a real height.
function stubRectHeight(element: HTMLElement, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      height,
      width: 1000,
      top: 0,
      left: 0,
      right: 1000,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

describe('CodeView header/footer', () => {
  test('mounts header/footer hosts as flanking siblings of the container', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      renderCodeViewHeader: () => document.createElement('div'),
      renderCodeViewFooter: () => document.createElement('div'),
    });
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());

      const header = mustGetHost(viewer.getHeaderElement());
      const footer = mustGetHost(viewer.getFooterElement());
      // root children are [header, container, footer].
      expect(root.children).toHaveLength(3);
      expect(root.firstElementChild).toBe(header);
      expect(root.lastElementChild).toBe(footer);
      expect(header.getAttribute(CODE_VIEW_HEADER_ATTRIBUTE)).toBe('');
      expect(footer.getAttribute(CODE_VIEW_FOOTER_ATTRIBUTE)).toBe('');
      // Block formatting context so caller margins can't collapse out.
      expect(header.style.display).toBe('flow-root');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('header height offsets an item absolute top by exactly the header height', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());

      const before = viewer.getTopForItem('file:5') ?? 0;
      resizeHost(viewer, viewer.getHeaderElement(), 140);
      const after = viewer.getTopForItem('file:5') ?? 0;

      expect(after - before).toBe(140);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('header + footer heights extend the max scroll range', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      renderCodeViewHeader: () => document.createElement('div'),
      renderCodeViewFooter: () => document.createElement('div'),
    });
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());

      resizeHost(viewer, viewer.getHeaderElement(), 150);
      resizeHost(viewer, viewer.getFooterElement(), 250);

      viewer.scrollTo({ type: 'position', position: 1e9, behavior: 'instant' });
      viewer.render(true);

      const expectedMax = Math.max(
        paddingTop +
          150 +
          viewer.getScrollHeight() +
          250 +
          paddingBottom -
          ROOT_HEIGHT,
        0
      );
      expect(viewer.getScrollTop()).toBe(expectedMax);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('scrolls to an item at its header-inclusive absolute top', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());
      resizeHost(viewer, viewer.getHeaderElement(), 120);

      viewer.scrollTo({
        type: 'item',
        id: 'file:6',
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);

      // align 'start' lands the item's absolute top (which includes the header
      // offset) at the viewport top.
      const targetTop = viewer.getTopForItem('file:6') ?? 0;
      expect(viewer.getScrollTop()).toBe(targetTop);
      expect(
        viewer.getRenderedItems().some((item) => item.id === 'file:6')
      ).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('reveals a header that grows while scrolled to the top (no anti-jump)', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());
      expect(viewer.getScrollTop()).toBe(0);

      resizeHost(viewer, viewer.getHeaderElement(), 300);

      // At the top there is nothing above the viewport to keep stable, so the
      // header reveals (content shifts down) instead of being anchored away.
      expect(viewer.getScrollTop()).toBe(0);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('re-anchors content when a header grows while scrolled into the list', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());

      root.scrollTop = 300;
      dispatchScroll(root);
      viewer.render(true);
      expect(viewer.getScrollTop()).toBe(300);

      resizeHost(viewer, viewer.getHeaderElement(), 120);

      // The anchored item's viewport offset is preserved: the whole list shifted
      // down by the header height, so scrollTop grows by the same amount.
      expect(viewer.getScrollTop()).toBe(420);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('measures the header height synchronously on mount', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());

      const before = viewer.getTopForItem('file:2') ?? 0;
      // Stub the host rect, then swap the callback to force a fresh inline
      // measure via measureMountedHosts (getBoundingClientRect), not the RO.
      const host = viewer.getHeaderElement();
      expect(host).toBeInstanceOf(HTMLElement);
      stubRectHeight(host as HTMLElement, 90);
      viewer.setOptions({
        renderCodeViewHeader: () => document.createElement('span'),
      });
      viewer.render(true);

      const after = viewer.getTopForItem('file:2') ?? 0;
      expect(after - before).toBe(90);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('removing the header callback tears down the host and zeroes the offset', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());
      resizeHost(viewer, viewer.getHeaderElement(), 150);

      const withHeader = viewer.getTopForItem('file:3') ?? 0;

      viewer.setOptions({});
      viewer.render(true);

      expect(viewer.getHeaderElement()).toBeUndefined();
      expect(root.querySelector(`[${CODE_VIEW_HEADER_ATTRIBUTE}]`)).toBeNull();

      const withoutHeader = viewer.getTopForItem('file:3') ?? 0;
      expect(withHeader - withoutHeader).toBe(150);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('mounts a header on an empty CodeView and stays within a valid scroll range', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView(headerOption());
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, []);

      expect(viewer.getHeaderElement()).toBeInstanceOf(HTMLElement);

      resizeHost(viewer, viewer.getHeaderElement(), 2000);
      viewer.scrollTo({ type: 'position', position: 1e9, behavior: 'instant' });
      viewer.render(true);

      const expectedMax = Math.max(
        paddingTop + 2000 + paddingBottom - ROOT_HEIGHT,
        0
      );
      expect(viewer.getScrollTop()).toBe(expectedMax);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleanUp removes the header/footer hosts', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      renderCodeViewHeader: () => document.createElement('div'),
      renderCodeViewFooter: () => document.createElement('div'),
    });
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems());
      expect(viewer.getHeaderElement()).toBeInstanceOf(HTMLElement);

      viewer.cleanUp();

      expect(viewer.getHeaderElement()).toBeUndefined();
      expect(viewer.getFooterElement()).toBeUndefined();
      expect(root.querySelector(`[${CODE_VIEW_HEADER_ATTRIBUTE}]`)).toBeNull();
      expect(root.querySelector(`[${CODE_VIEW_FOOTER_ATTRIBUTE}]`)).toBeNull();
    } finally {
      await wait(0);
      cleanup();
    }
  });
});
