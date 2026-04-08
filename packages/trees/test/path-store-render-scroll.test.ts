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

async function flushDom(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getFocusedTreeElement(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLElement | null {
  const activeElement = shadowRoot?.activeElement ?? null;
  return activeElement instanceof dom.window.HTMLElement
    ? (activeElement as HTMLElement)
    : null;
}

function getItemButton(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot?.querySelector(`[data-item-path="${path}"]`);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing button for ${path}`);
  }

  return button as HTMLButtonElement;
}

function getTreeRoot(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLDivElement {
  const root = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-root="true"]'
  );
  if (!(root instanceof dom.window.HTMLDivElement)) {
    throw new Error('missing tree root');
  }

  return root as HTMLDivElement;
}

function clickItem(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): void {
  const buttonElement = getItemButton(shadowRoot, dom, path);
  buttonElement.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
}

function pressKey(target: HTMLElement, dom: JSDOM, key: string): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      key,
    })
  );
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

  test('controller getItem returns minimal file/directory handles, single focus state, and null on miss', async () => {
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
    expect(fileItem?.isFocused()).toBe(false);
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
    expect(directoryItem.isFocused()).toBe(true);
    fileItem?.focus();
    expect(fileItem?.isFocused()).toBe(true);
    expect(directoryItem.isFocused()).toBe(false);
    expect(controller.getFocusedPath()).toBe('README.md');
    expect(controller.getItem('missing.ts')).toBeNull();

    controller.destroy();
  });

  test('controller focus helpers keep exactly one focused visible item', async () => {
    const { PathStoreTreesController } = await import('../src/path-store');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
    });

    const getFocusedPaths = () =>
      controller
        .getVisibleRows(0, controller.getVisibleCount() - 1)
        .filter((row) => row.isFocused)
        .map((row) => row.path);

    expect(getFocusedPaths()).toEqual(['src/']);

    controller.focusNextItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');
    expect(getFocusedPaths()).toEqual(['src/lib/']);

    controller.focusLastItem();
    expect(controller.getFocusedPath()).toBe('README.md');
    expect(getFocusedPaths()).toEqual(['README.md']);

    controller.focusPreviousItem();
    expect(controller.getFocusedPath()).toBe('src/index.ts');

    controller.focusPath('src/lib/util.ts');
    expect(controller.getFocusedPath()).toBe('src/lib/util.ts');

    controller.focusParentItem();
    expect(controller.getFocusedPath()).toBe('src/lib/');

    controller.focusFirstItem();
    expect(controller.getFocusedPath()).toBe('src/');
    expect(getFocusedPaths()).toEqual(['src/']);

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

  test('marks the virtualized list as scrolling to suppress hover styles', async () => {
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
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const listElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-list="true"]'
      );

      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      if (!(listElement instanceof dom.window.HTMLDivElement)) {
        throw new Error('missing list element');
      }

      const viewport = scrollElement as HTMLElement;
      const list = listElement as HTMLDivElement;

      expect(list.dataset.isScrolling).toBeUndefined();

      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(list.dataset.isScrolling).toBe('');

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(list.dataset.isScrolling).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders roving tabindex and baseline accessibility attributes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const sourceButton = getItemButton(shadowRoot, dom, 'src/');
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');

      expect(treeRoot.getAttribute('role')).toBe('tree');
      expect(treeRoot.getAttribute('aria-activedescendant')).toBeNull();
      expect(treeRoot.style.outline).toBe('none');
      expect(sourceButton.getAttribute('role')).toBe('treeitem');
      expect(sourceButton.getAttribute('aria-level')).toBe('1');
      expect(sourceButton.getAttribute('aria-posinset')).toBe('1');
      expect(sourceButton.getAttribute('aria-setsize')).toBe('2');
      expect(sourceButton.getAttribute('aria-expanded')).toBe('true');
      expect(sourceButton.getAttribute('aria-selected')).toBe('false');
      expect(sourceButton.tabIndex).toBe(0);
      expect(sourceButton.dataset.itemFocused).toBeUndefined();
      expect(readmeButton.getAttribute('aria-expanded')).toBeNull();
      expect(readmeButton.tabIndex).toBe(-1);

      sourceButton.focus();
      await flushDom();
      expect(sourceButton.dataset.itemFocused).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focused rows keep the matching separator line prominent', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const fileButton = getItemButton(shadowRoot, dom, 'src/lib/util.ts');

      fileButton.focus();
      await flushDom();

      const guideStyle = shadowRoot?.querySelector(
        '[data-path-store-guide-style="true"]'
      );
      const spacingItems = fileButton.querySelectorAll(
        '[data-item-section="spacing-item"]'
      );

      expect(spacingItems[0]?.getAttribute('data-ancestor-path')).toBe('src/');
      expect(spacingItems[1]?.getAttribute('data-ancestor-path')).toBe(
        'src/lib/'
      );
      expect(guideStyle?.innerHTML).toContain(
        '[data-item-section="spacing-item"][data-ancestor-path="src/lib/"]'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation matches the baseline tree behavior', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 1,
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/'), dom, 'ArrowDown');
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('src/lib/util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      pressKey(
        getItemButton(shadowRoot, dom, 'src/lib/util.ts'),
        dom,
        'ArrowLeft'
      );
      await flushDom();
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'End');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('README.md')?.isFocused()).toBe(true);

      pressKey(getTreeRoot(shadowRoot, dom), dom, 'Home');
      await flushDom();
      await flushDom();
      expect(fileTree.getItem('src/')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('collapse moves focus to the nearest visible ancestor', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const containerWrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(containerWrapper);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpandedPaths: ['src/lib/'],
        paths: ['README.md', 'src/index.ts', 'src/lib/util.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'src/lib/util.ts').focus();
      await flushDom();

      const sourceDirectory = fileTree.getItem('src/lib/');
      if (
        sourceDirectory == null ||
        sourceDirectory.isDirectory() !== true ||
        !('collapse' in sourceDirectory)
      ) {
        throw new Error('missing source directory item');
      }

      sourceDirectory.collapse();
      await flushDom();

      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);
      expect(shadowRoot?.innerHTML).not.toContain('src/lib/util.ts');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'src/lib/'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation survives virtualization when the focused row unmounts', async () => {
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
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }

      const viewport = scrollElement as HTMLElement;
      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      getItemButton(shadowRoot, dom, 'item050.ts').focus();
      await flushDom();
      expect(fileTree.getItem('item050.ts')?.isFocused()).toBe(true);

      viewport.scrollTop = 3000;
      viewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      expect(viewport.scrollTop).toBe(3000);
      expect(shadowRoot?.innerHTML).toContain('item100.ts');
      expect(
        getItemButton(shadowRoot, dom, 'item050.ts').dataset.itemParked
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item050.ts'
      );

      pressKey(getItemButton(shadowRoot, dom, 'item050.ts'), dom, 'ArrowDown');
      await flushDom();
      await flushDom();

      expect(fileTree.getItem('item051.ts')?.isFocused()).toBe(true);
      expect(viewport.scrollTop).toBe(
        51 * PATH_STORE_TREES_DEFAULT_ITEM_HEIGHT
      );
      expect(
        getItemButton(shadowRoot, dom, 'item051.ts').dataset.itemFocused
      ).toBe('true');
      expect(getFocusedTreeElement(shadowRoot, dom)?.dataset.itemPath).toBe(
        'item051.ts'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows use terminal-directory keyboard semantics', async () => {
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
      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(shadowRoot?.innerHTML).toContain('util.ts');
      expect(fileTree.getItem('src/lib/')?.isFocused()).toBe(true);

      pressKey(getItemButton(shadowRoot, dom, 'src/lib/'), dom, 'ArrowRight');
      await flushDom();
      expect(fileTree.getItem('src/lib/util.ts')?.isFocused()).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened row markup does not wrap separators in extra spans', async () => {
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
      const flattenedContainer = shadowRoot?.querySelector(
        '[data-item-flattened-subitems]'
      );

      expect(flattenedContainer?.innerHTML).toContain(' / ');
      expect(
        flattenedContainer?.querySelectorAll(
          ':scope > [data-item-flattened-subitem]'
        ).length
      ).toBe(2);
      expect(
        flattenedContainer?.querySelector(
          ':scope > span:not([data-item-flattened-subitem])'
        )
      ).toBeNull();

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

  test('uses compatible row markup for the implemented focus/navigation pieces only', async () => {
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
      const focusedRow = shadowRoot?.querySelector(
        '[data-item-focused="true"]'
      );
      const treeRoot = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-root="true"]'
      );

      expect(
        shadowRoot?.querySelector('[data-item-section="icon"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-section="content"]')
      ).not.toBeNull();
      expect(focusedRow).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-selected="true"]')
      ).toBeNull();
      expect(treeRoot?.getAttribute('role')).toBe('tree');
      expect(treeRoot?.getAttribute('aria-activedescendant')).toBeNull();

      getItemButton(shadowRoot, dom, 'src/lib/').focus();
      await flushDom();

      const focusedButton = getItemButton(shadowRoot, dom, 'src/lib/');
      expect(focusedButton.dataset.itemFocused).toBe('true');
      expect(focusedButton.getAttribute('role')).toBe('treeitem');
      expect(focusedButton.getAttribute('aria-selected')).toBe('false');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
