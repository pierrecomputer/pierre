import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';
import { DEFAULT_CODE_VIEW_METRICS } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const ROOT_HEIGHT = 800;

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    Node: Reflect.get(globalThis, 'Node'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockResizeObserver {
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }

  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const timeout = frames.get(id);
      if (timeout != null) {
        clearTimeout(timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    document: dom.window.document,
    DocumentFragment: dom.window.DocumentFragment,
    Element: dom.window.Element,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    Node: dom.window.Node,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, timeout);
      return id;
    }) as typeof requestAnimationFrame,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  });

  return {
    cleanup() {
      for (const timeout of frames.values()) {
        clearTimeout(timeout);
      }
      frames.clear();

      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
  };
}

function createClampingRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
    root.scrollTop = Math.min(Math.max(top, 0), getRootMaxScrollTop(root));
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: ROOT_HEIGHT,
      height: ROOT_HEIGHT,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  document.body.appendChild(root);
  return root;
}

function getRootMaxScrollTop(root: HTMLElement): number {
  const container = root.firstElementChild;
  if (!(container instanceof HTMLElement)) {
    return 0;
  }

  const contentHeight = Number.parseFloat(
    container.style.height !== '' ? container.style.height : '0'
  );
  const marginTop = Number.parseFloat(
    container.style.marginTop !== '' ? container.style.marginTop : '0'
  );
  const marginBottom = Number.parseFloat(
    container.style.marginBottom !== '' ? container.style.marginBottom : '0'
  );
  return Math.max(contentHeight + marginTop + marginBottom - ROOT_HEIGHT, 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
}

function getScrollToTop(
  options?: ScrollToOptions | number,
  y?: number
): number {
  return typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
}

function makeFile(name: string, lineCount: number): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `line ${index + 1}`
    ).join('\n'),
  };
}

function makeFileItem(id: string, lineCount: number): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, lineCount),
  };
}

function makeReplacementDiffItem(
  id: string,
  lineCount: number
): CodeViewItem<undefined> {
  const oldFile = makeFile('src/replaced.ts', lineCount);
  const newFile: FileContents = {
    name: oldFile.name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `replacement ${index + 1}`
    ).join('\n'),
  };

  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
  };
}

async function renderItems(
  viewer: CodeView,
  items: readonly CodeViewItem[]
): Promise<void> {
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
}

describe('CodeView scroll anchoring', () => {
  test('keeps an item anchor fixed when split to unified grows past the old scroll range', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ diffStyle: 'split' });
    const root = createClampingRoot();
    const anchorItem: CodeViewItem = {
      id: 'file:anchor',
      type: 'file',
      file: makeFile('anchor.ts', 90),
    };
    const items = [makeReplacementDiffItem('diff:growing', 100), anchorItem];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      const splitAnchorTop =
        DEFAULT_CODE_VIEW_METRICS.paddingTop +
        (viewer.getTopForItem(anchorItem.id) ?? 0);
      const splitMaxScrollTop = getRootMaxScrollTop(root);
      expect(splitMaxScrollTop).toBeGreaterThan(splitAnchorTop);

      root.scrollTop = splitAnchorTop;
      dispatchScroll(root);
      viewer.render(true);

      viewer.setOptions({ diffStyle: 'unified' });
      viewer.render(true);

      const unifiedAnchorTop =
        DEFAULT_CODE_VIEW_METRICS.paddingTop +
        (viewer.getTopForItem(anchorItem.id) ?? 0);
      expect(unifiedAnchorTop).toBeGreaterThan(splitMaxScrollTop);
      expect(root.scrollTop).toBe(unifiedAnchorTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('rebases the DOM scroll position while preserving logical scroll progress', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      viewerMetrics: {
        ...DEFAULT_CODE_VIEW_METRICS,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const items = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`file:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      expect(viewer.getScrollHeight()).toBeGreaterThan(20_000_000);
      expect(getRootMaxScrollTop(root)).toBeLessThan(12_000_000);

      root.scrollTop = 11_100_000;
      dispatchScroll(root);
      viewer.render(true);

      expect(viewer.getScrollTop()).toBe(11_100_000);
      expect(root.scrollTop).toBe(2_000_000);

      root.scrollTop = 3_000_000;
      dispatchScroll(root);
      viewer.render(true);

      expect(viewer.getScrollTop()).toBe(12_100_000);

      viewer.scrollTo({
        type: 'item',
        id: 'file:39',
        align: 'start',
        behavior: 'instant',
      });
      viewer.render(true);

      const finalFileTop =
        DEFAULT_CODE_VIEW_METRICS.paddingTop +
        (viewer.getTopForItem('file:39') ?? 0);
      expect(viewer.getScrollTop()).toBeGreaterThan(finalFileTop - ROOT_HEIGHT);
      expect(viewer.getScrollTop()).toBeLessThanOrEqual(finalFileTop);
      expect(root.scrollTop).toBeLessThanOrEqual(getRootMaxScrollTop(root));
      expect(
        viewer.getRenderedItems().some((item) => item.id === 'file:39')
      ).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('restores the paged scroll height after clearing and reusing the viewer', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      viewerMetrics: {
        ...DEFAULT_CODE_VIEW_METRICS,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const firstItems = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`first:${index}`, 1)
    );
    const secondItems = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`second:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, firstItems);

      const container = root.firstElementChild;
      expect(container).toBeInstanceOf(HTMLElement);
      expect((container as HTMLElement).style.height).toBe('12000000px');

      viewer.setItems([]);
      expect((container as HTMLElement).style.height).toBe('');

      await renderItems(viewer, secondItems);

      expect(viewer.getScrollHeight()).toBeGreaterThan(20_000_000);
      expect((container as HTMLElement).style.height).toBe('12000000px');
      expect(getRootMaxScrollTop(root)).toBeGreaterThan(11_000_000);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('moves the physical spacer before applying a programmatic rebase jump', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      viewerMetrics: {
        ...DEFAULT_CODE_VIEW_METRICS,
        gap: 1_000_000,
      },
    });
    const root = createClampingRoot();
    const scrollWrites: { top: number; spacerHeight: number }[] = [];
    const originalScrollTo = root.scrollTo.bind(root);
    root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      const container = root.firstElementChild;
      const spacer = container?.firstElementChild;
      scrollWrites.push({
        top: getScrollToTop(options, y),
        spacerHeight:
          spacer instanceof HTMLElement
            ? Number.parseFloat(
                spacer.style.height !== '' ? spacer.style.height : '0'
              )
            : 0,
      });
      if (typeof options === 'number') {
        originalScrollTo(options, y ?? 0);
      } else {
        originalScrollTo(options);
      }
    };
    const items = Array.from({ length: 40 }, (_, index) =>
      makeFileItem(`file:${index}`, 1)
    );

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      viewer.scrollTo({
        type: 'position',
        position: 11_100_000,
        behavior: 'instant',
      });
      viewer.render(true);

      const rebaseWrite = scrollWrites.find((write) => write.top === 2_000_000);
      expect(rebaseWrite).toBeDefined();
      expect(rebaseWrite?.spacerHeight).toBeGreaterThan(1_900_000);
      expect(rebaseWrite?.spacerHeight).toBeLessThan(2_100_000);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
