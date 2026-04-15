import { describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

const FILES = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/utils/worker.ts',
  'src/utils/stream.ts',
  'test/index.test.ts',
] as const;

const SEARCH_NAV_FILES = [
  ...FILES,
  'src/utils/worker/index.ts',
  'src/utils/worker/deprecated/old-worker.ts',
] as const;

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
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLInputElement: Reflect.get(globalThis, 'HTMLInputElement'),
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
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLInputElement: dom.window.HTMLInputElement,
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
    dom,
  };
}

async function flushDom(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pressKey(
  target: Element,
  dom: JSDOM,
  key: string,
  init: KeyboardEventInit = {}
): void {
  target.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...init,
    })
  );
}

function setInputValue(
  input: HTMLInputElement,
  dom: JSDOM,
  value: string
): void {
  input.value = value;
  input.dispatchEvent(
    new dom.window.Event('input', {
      bubbles: true,
      cancelable: true,
    })
  );
}

function getVisiblePaths(
  controller: import('../src/path-store/controller').PathStoreTreesController
): string[] {
  return controller
    .getVisibleRows(0, controller.getVisibleCount())
    .map((row) => row.path);
}

describe('path-store search', () => {
  test('expand-matches preserves existing expansion and keeps non-matches visible', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      fileTreeSearchMode: 'expand-matches',
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/components/'],
      initialExpansion: 'closed',
      paths: FILES,
    });

    controller.setSearch('worker');
    const visiblePaths = getVisiblePaths(controller);

    expect(visiblePaths).toContain('README.md');
    expect(visiblePaths).toContain('package.json');
    expect(visiblePaths).toContain('src/utils/worker.ts');
    expect(visiblePaths).toContain('src/components/Button.tsx');

    controller.destroy();
  });

  test('collapse-non-matches expands only ancestors of matches', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      fileTreeSearchMode: 'collapse-non-matches',
      flattenEmptyDirectories: false,
      initialExpandedPaths: ['src/components/'],
      initialExpansion: 'closed',
      paths: FILES,
    });

    controller.setSearch('worker');
    const visiblePaths = getVisiblePaths(controller);

    expect(visiblePaths).toContain('src/');
    expect(visiblePaths).toContain('src/utils/');
    expect(visiblePaths).toContain('src/utils/worker.ts');
    expect(visiblePaths).not.toContain('src/components/Button.tsx');

    controller.destroy();
  });

  test('hide-non-matches filters visible rows to matches plus ancestors', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: FILES,
    });

    controller.setSearch('worker');
    const visiblePaths = getVisiblePaths(controller);

    expect(visiblePaths).toContain('src/');
    expect(visiblePaths).toContain('src/utils/');
    expect(visiblePaths).toContain('src/utils/worker.ts');
    expect(visiblePaths).not.toContain('README.md');
    expect(visiblePaths).not.toContain('src/components/Button.tsx');

    controller.destroy();
  });

  test('built-in matcher keeps fuzzy subsequence matching', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: FILES,
    });

    controller.setSearch('srwk');

    expect(getVisiblePaths(controller)).toEqual(
      expect.arrayContaining(['src/', 'src/utils/', 'src/utils/worker.ts'])
    );

    controller.destroy();
  });

  test('onSearchChange fires for typed input, key-open seeding, and close but not initialSearchQuery', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');
    const calls: Array<string | null> = [];

    const controller = new PathStoreTreesController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      initialSearchQuery: 'worker',
      onSearchChange: (value) => {
        calls.push(value);
      },
      paths: FILES,
    });

    expect(calls).toEqual([]);

    controller.openSearch('R');
    controller.setSearch('read');
    controller.closeSearch();

    expect(calls).toEqual(['r', 'read', null]);

    controller.destroy();
  });

  test('search false hides the built-in input while programmatic search still works', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: FILES,
        search: false,
        viewportHeight: 180,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        shadowRoot?.querySelector('[data-file-tree-search-input]')
      ).toBeNull();

      fileTree.openSearch('worker');
      await flushDom();

      expect(
        shadowRoot?.querySelector('[data-item-path="src/utils/worker.ts"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-path="README.md"]')
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('search false keeps the printable-key open hotkey disabled', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: SEARCH_NAV_FILES,
        search: false,
        viewportHeight: 220,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-type="item"][data-item-path="README.md"]'
      );
      expect(firstButton).not.toBeNull();

      firstButton?.focus();
      pressKey(firstButton as HTMLButtonElement, dom, 'w');
      await flushDom();

      expect(fileTree.isSearchOpen()).toBe(false);
      expect(fileTree.getSearchValue()).toBe('');
      expect(
        shadowRoot?.querySelector('[data-file-tree-search-input]')
      ).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-path="README.md"]')
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('search keeps input focus while ArrowDown updates the focused match', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        id: 'pst-search-focus-test',
        initialExpansion: 'open',
        paths: SEARCH_NAV_FILES,
        search: true,
        viewportHeight: 220,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-type="item"][data-item-path="README.md"]'
      );
      expect(firstButton).not.toBeNull();

      firstButton?.focus();
      pressKey(firstButton as HTMLButtonElement, dom, 'w');
      await flushDom();

      const searchInput = shadowRoot?.querySelector<HTMLInputElement>(
        'input[data-file-tree-search-input]'
      );
      expect(searchInput).not.toBeNull();
      expect(searchInput?.value).toBe('w');
      expect(shadowRoot?.activeElement).toBe(searchInput);

      const initialFocusedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-focused="true"]'
      );
      const initialActiveDescendant =
        searchInput?.getAttribute('aria-activedescendant') ?? null;
      expect(initialActiveDescendant).not.toBeNull();
      expect(initialFocusedRow?.id).toBe(initialActiveDescendant ?? undefined);

      pressKey(searchInput as HTMLInputElement, dom, 'ArrowDown', {
        code: 'ArrowDown',
      });
      await flushDom();

      const nextFocusedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-focused="true"]'
      );
      const nextActiveDescendant =
        searchInput?.getAttribute('aria-activedescendant') ?? null;

      expect(shadowRoot?.activeElement).toBe(searchInput);
      expect(nextActiveDescendant).not.toBeNull();
      expect(nextFocusedRow?.id).toBe(nextActiveDescendant ?? undefined);
      expect(nextActiveDescendant).not.toBe(initialActiveDescendant);

      pressKey(searchInput as HTMLInputElement, dom, 'ArrowUp', {
        code: 'ArrowUp',
      });
      await flushDom();

      const previousFocusedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-focused="true"]'
      );
      const previousActiveDescendant =
        searchInput?.getAttribute('aria-activedescendant') ?? null;
      expect(shadowRoot?.activeElement).toBe(searchInput);
      expect(previousFocusedRow?.id).toBe(initialActiveDescendant ?? undefined);
      expect(previousActiveDescendant).toBe(initialActiveDescendant);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Enter selects the focused search match and closes search', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        id: 'pst-search-submit-test',
        initialExpansion: 'open',
        paths: SEARCH_NAV_FILES,
        search: true,
        viewportHeight: 220,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-type="item"][data-item-path="README.md"]'
      );
      const searchInput = shadowRoot?.querySelector<HTMLInputElement>(
        'input[data-file-tree-search-input]'
      );
      expect(firstButton).not.toBeNull();
      expect(searchInput).not.toBeNull();

      firstButton?.focus();
      pressKey(firstButton as HTMLButtonElement, dom, 'w');
      await flushDom();

      setInputValue(searchInput as HTMLInputElement, dom, 'worker');
      await flushDom();

      const focusedMatch = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-focused="true"]'
      );
      const focusedPathBeforeSubmit =
        focusedMatch?.getAttribute('data-item-path') ?? null;
      expect(focusedPathBeforeSubmit).not.toBeNull();

      pressKey(searchInput as HTMLInputElement, dom, 'Enter', {
        code: 'Enter',
      });
      await flushDom();

      expect(fileTree.isSearchOpen()).toBe(false);
      expect(fileTree.getSearchValue()).toBe('');
      expect(fileTree.getSelectedPaths()).toEqual(
        focusedPathBeforeSubmit == null ? [] : [focusedPathBeforeSubmit]
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
