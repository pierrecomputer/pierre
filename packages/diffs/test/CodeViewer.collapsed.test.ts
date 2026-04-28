import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeViewer } from '../src/components/CodeViewer';
import type { CodeViewerItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

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

function createRoot(): HTMLDivElement {
  const root = document.createElement('div');
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: 800,
      height: 800,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeFile(name: string, lineCount = 20): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `line ${index + 1}`
    ).join('\n'),
  };
}

function makeDiffItem(
  id: string,
  collapsed?: boolean
): CodeViewerItem<undefined> {
  const item: CodeViewerItem<undefined> = {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      {
        name: 'src/example.txt',
        contents: 'one\ntwo\nthree\n',
      },
      {
        name: 'src/example.txt',
        contents: 'one\ntwo changed\nthree\n',
      }
    ),
  };
  if (collapsed !== undefined) {
    item.collapsed = collapsed;
  }
  return item;
}

function hasRenderedCode(item: { element: HTMLElement }): boolean {
  return item.element.shadowRoot?.querySelector('pre') != null;
}

async function renderItems(
  viewer: CodeViewer,
  items: readonly CodeViewerItem[]
): Promise<void> {
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
}

describe('CodeViewer item collapsed state', () => {
  test('mounts mixed initially collapsed and expanded items', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeViewer();
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        {
          id: 'file:collapsed.txt',
          type: 'file',
          file: makeFile('collapsed.txt'),
          collapsed: true,
        },
        makeDiffItem('diff:expanded.txt'),
      ]);

      const renderedItems = viewer.getRenderedItems();
      const collapsedFile = renderedItems.find(
        (item) => item.id === 'file:collapsed.txt'
      );
      const expandedDiff = renderedItems.find(
        (item) => item.id === 'diff:expanded.txt'
      );

      expect(collapsedFile).toBeDefined();
      expect(expandedDiff).toBeDefined();
      expect(hasRenderedCode(collapsedFile!)).toBe(false);
      expect(hasRenderedCode(expandedDiff!)).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('collapses an item when its versioned snapshot changes', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeViewer();
    const item: CodeViewerItem = {
      id: 'file:example.txt',
      type: 'file',
      file: makeFile('example.txt'),
      version: 0,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      const expandedItem = viewer.getRenderedItems()[0];
      expect(expandedItem).toBeDefined();
      expect(hasRenderedCode(expandedItem)).toBe(true);
      const expandedHeight = expandedItem.instance.getVirtualizedHeight();

      await renderItems(viewer, [{ ...item, collapsed: true, version: 1 }]);

      const collapsedItem = viewer.getRenderedItems()[0];
      expect(collapsedItem).toBeDefined();
      expect(hasRenderedCode(collapsedItem)).toBe(false);
      expect(collapsedItem.instance.getVirtualizedHeight()).toBeLessThan(
        expandedHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('ignores same-version collapsed changes', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeViewer();
    const item: CodeViewerItem = {
      id: 'file:example.txt',
      type: 'file',
      file: makeFile('example.txt'),
      version: 0,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      await renderItems(viewer, [{ ...item, collapsed: true }]);

      const renderedItem = viewer.getRenderedItems()[0];
      expect(renderedItem).toBeDefined();
      expect(hasRenderedCode(renderedItem)).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
