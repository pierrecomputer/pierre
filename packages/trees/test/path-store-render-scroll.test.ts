import { describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

import {
  computeStickyWindowLayout,
  computeWindowRange,
  PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
  PATH_STORE_TREES_DEFAULT_OVERSCAN,
  PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
} from '../src/path-store';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    HTMLTemplateElement: Reflect.get(globalThis, 'HTMLTemplateElement'),
    MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
    navigator: Reflect.get(globalThis, 'navigator'),
    Node: Reflect.get(globalThis, 'Node'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    ShadowRoot: Reflect.get(globalThis, 'ShadowRoot'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockStyleSheet {
    replaceSync(_value: string): void {}
  }

  class MockResizeObserver {
    observe(_target: Element): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    CSSStyleSheet: MockStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    ShadowRoot: dom.window.ShadowRoot,
    window: dom.window,
  });

  return {
    dom,
    cleanup() {
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

function clickItem(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): void {
  const button = shadowRoot?.querySelector(`button[aria-label="${path}"]`);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing button for ${path}`);
  }

  const buttonElement = button as HTMLButtonElement;
  buttonElement.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
}

describe('path-store render + scroll', () => {
  test('controller exposes path-first visible rows without leaking numeric ids', async () => {
    const { PathStoreTreesController } = await import('../src/path-store');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['z.ts', 'a.ts'],
    });

    const [firstRow] = controller.getVisibleRows(0, 0);

    expect(firstRow?.path).toBe('a.ts');
    expect(Reflect.has(firstRow ?? {}, 'id')).toBe(false);

    controller.destroy();
  });

  test('controller getItem returns minimal file/directory handles and null on miss', async () => {
    const { PathStoreTreesController } = await import('../src/path-store');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 1,
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const fileItem = controller.getItem('README.md');
    const directoryItem = controller.getItem('src');

    expect(fileItem?.getPath()).toBe('README.md');
    expect(fileItem?.isDirectory()).toBe(false);
    expect('expand' in (fileItem ?? {})).toBe(false);

    expect(directoryItem?.getPath()).toBe('src/');
    expect(directoryItem?.isDirectory()).toBe(true);
    if (
      directoryItem == null ||
      directoryItem.isDirectory() !== true ||
      !('isExpanded' in directoryItem)
    ) {
      throw new Error('expected directory item');
    }

    expect(directoryItem.isExpanded()).toBe(true);
    expect(controller.getItem('missing.ts')).toBeNull();

    controller.destroy();
  });

  test('deep initialExpandedPaths expands ancestor directories in handle state and visible rows', async () => {
    const { PathStoreTreesController } = await import('../src/path-store');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/lib'],
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const srcItem = controller.getItem('src');
    const libItem = controller.getItem('src/lib');

    if (
      srcItem == null ||
      srcItem.isDirectory() !== true ||
      !('isExpanded' in srcItem)
    ) {
      throw new Error('expected src directory item');
    }
    if (
      libItem == null ||
      libItem.isDirectory() !== true ||
      !('isExpanded' in libItem)
    ) {
      throw new Error('expected src/lib directory item');
    }

    expect(srcItem.isExpanded()).toBe(true);
    expect(libItem.isExpanded()).toBe(true);
    expect(controller.getVisibleRows(0, 10).map((row) => row.path)).toEqual([
      'src/',
      'src/lib/',
      'src/lib/util.ts',
      'src/index.ts',
      'README.md',
    ]);

    controller.destroy();
  });

  test('directory row collapses on the first click when initialExpandedPaths uses bare directory paths', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(shadowRoot?.innerHTML).toContain('src/index.ts');
      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('computes a stable window range and sticky layout', () => {
    const initialRange = computeWindowRange({
      itemCount: 200,
      itemHeight: PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
      overscan: PATH_STORE_TREES_DEFAULT_OVERSCAN,
      scrollTop: 0,
      viewportHeight: PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
    });
    const scrolledRange = computeWindowRange(
      {
        itemCount: 200,
        itemHeight: PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
        overscan: PATH_STORE_TREES_DEFAULT_OVERSCAN,
        scrollTop: 1800,
        viewportHeight: PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
      },
      initialRange
    );
    const layout = computeStickyWindowLayout({
      itemCount: 200,
      itemHeight: PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT,
      range: scrolledRange,
      viewportHeight: PATH_STORE_TREES_DEFAULT_VIEWPORT_HEIGHT,
    });

    expect(initialRange.start).toBe(0);
    expect(scrolledRange.start).toBeGreaterThan(0);
    expect(scrolledRange.end).toBeGreaterThan(scrolledRange.start);
    expect(layout.totalHeight).toBe(200 * PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT);
    expect(layout.offsetHeight).toBe(
      scrolledRange.start * PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT
    );
  });

  test('preloadPathStoreFileTree returns SSR-safe initial html', async () => {
    const { preloadPathStoreFileTree } = await import('../src/path-store');

    const payload = preloadPathStoreFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      viewportHeight: 120,
    });

    expect(payload.html).toContain('<file-tree-container');
    expect(payload.shadowHtml).toContain(
      'data-file-tree-virtualized-root="true"'
    );
    expect(payload.shadowHtml).toContain('README.md');
  });

  test('PathStoreFileTree renders and updates the visible window on scroll', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const paths = Array.from(
        { length: 120 },
        (_, index) => `item${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        paths,
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      expect(host).toBeDefined();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const root = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      expect(root).toBeDefined();
      expect(shadowRoot?.innerHTML).toContain('item000.ts');

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement as HTMLElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('item040.ts');
      expect(shadowRoot?.innerHTML).not.toContain('item000.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('directory row clicks toggle expansion while file clicks stay inert', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'README.md');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).toContain('src/index.ts');

      clickItem(shadowRoot, dom, 'src/');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot?.innerHTML).not.toContain('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows toggle the terminal directory', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: true,
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      clickItem(shadowRoot, dom, 'src/lib/');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('util.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapse preserves a coherent virtualized window when affected rows move above and below the fold', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const topFiles = Array.from(
        { length: 50 },
        (_, index) => `a${String(index).padStart(3, '0')}.ts`
      );
      const sourceFiles = Array.from(
        { length: 80 },
        (_, index) => `src/file${String(index).padStart(3, '0')}.ts`
      );
      const bottomFiles = Array.from(
        { length: 50 },
        (_, index) => `z${String(index).padStart(3, '0')}.ts`
      );
      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/'],
        paths: [...topFiles, ...sourceFiles, ...bottomFiles],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement as HTMLElement;
      viewport.scrollTop = (topFiles.length + 11) * 30;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).toContain('src/file050.ts');

      const sourceDirectory = fileTree.getItem('src/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot?.innerHTML).not.toContain('src/file050.ts');
      expect(shadowRoot?.innerHTML).toContain('z010.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('uses compatible row markup for implemented pieces only', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['src/lib/index.ts', 'src/lib/utils.ts', 'README.md'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(
        shadowRoot?.querySelector('[data-item-section="icon"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-section="content"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-focused="true"]')
      ).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
