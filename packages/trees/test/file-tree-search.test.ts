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

const LARGE_VISIBLE_FILES = Array.from(
  { length: 700 },
  (_unused, index) => `file-${String(index).padStart(4, '0')}.ts`
);

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
  controller: import('../src/index').FileTreeController
): string[] {
  return controller
    .getVisibleRows(0, controller.getVisibleCount())
    .map((row) => row.path);
}

async function loadFileTreeController(): Promise<
  typeof import('../src/index').FileTreeController
> {
  const module = await import('../src/model/FileTreeController');
  const controller = Object.values(module).find(
    (value): value is typeof import('../src/index').FileTreeController =>
      typeof value === 'function' &&
      'prototype' in value &&
      'getVisibleRows' in value.prototype
  );
  if (controller == null) {
    throw new Error('Expected FileTreeController export');
  }

  return controller;
}

async function loadFileTree(): Promise<typeof import('../src/index').FileTree> {
  const module = await import('../src/render/FileTree');
  const fileTree = Object.values(module).find(
    (value): value is typeof import('../src/index').FileTree =>
      typeof value === 'function' &&
      'prototype' in value &&
      'render' in value.prototype
  );
  if (fileTree == null) {
    throw new Error('Expected FileTree export');
  }

  return fileTree;
}

describe('file-tree search', () => {
  test('expand-matches preserves existing expansion and keeps non-matches visible', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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

  test('focusNearestPath returns the correct visible path during filtered search', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: FILES,
    });

    controller.setSearch('worker');

    expect(controller.resolveNearestVisiblePath('src/utils/worker.ts')).toBe(
      'src/utils/worker.ts'
    );
    expect(controller.focusNearestPath('src/utils/worker.ts')).toBe(
      'src/utils/worker.ts'
    );

    controller.destroy();
  });

  test('filtered visible rows fetch only the contiguous runs they need', async () => {
    const { PathStore } = await import('@pierre/path-store');
    const FileTreeController = await loadFileTreeController();

    const originalGetVisibleSlice = PathStore.prototype.getVisibleSlice;
    const requestedRanges: Array<[number, number]> = [];
    PathStore.prototype.getVisibleSlice = function getVisibleSlice(start, end) {
      requestedRanges.push([start, end]);
      return originalGetVisibleSlice.call(this, start, end);
    };

    try {
      const controller = new FileTreeController({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: [
          'a/worker-a.ts',
          ...Array.from({ length: 24 }, (_unused, index) => {
            return `b/fill-${String(index)}.ts`;
          }),
          'm/worker-m.ts',
          ...Array.from({ length: 24 }, (_unused, index) => {
            return `n/fill-${String(index)}.ts`;
          }),
          'z/worker-z.ts',
        ],
      });

      controller.setSearch('worker');
      requestedRanges.length = 0;

      const visiblePaths = controller
        .getVisibleRows(0, 5)
        .map((row) => row.path);

      expect(visiblePaths).toEqual([
        'a/',
        'a/worker-a.ts',
        'm/',
        'm/worker-m.ts',
        'z/',
        'z/worker-z.ts',
      ]);
      expect(requestedRanges).toHaveLength(3);
      expect(requestedRanges.every(([start, end]) => end - start <= 1)).toBe(
        true
      );
      expect(requestedRanges[0]?.[0]).toBeLessThan(
        requestedRanges[1]?.[0] ?? 0
      );
      expect(requestedRanges[1]?.[0]).toBeLessThan(
        requestedRanges[2]?.[0] ?? 0
      );

      controller.destroy();
    } finally {
      PathStore.prototype.getVisibleSlice = originalGetVisibleSlice;
    }
  });

  test('closed-search visible count stays tied to the full store count before full projection expansion', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: LARGE_VISIBLE_FILES,
    });

    expect(controller.getVisibleCount()).toBe(LARGE_VISIBLE_FILES.length);
    expect(controller.getVisibleRows(520, 520)[0]?.path).toBe(
      LARGE_VISIBLE_FILES[520]
    );

    controller.destroy();
  });

  test('focusNextItem can cross the initial partial projection boundary', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: LARGE_VISIBLE_FILES,
    });

    for (let index = 0; index < 520; index += 1) {
      controller.focusNextItem();
    }

    expect(controller.getFocusedPath()).toBe(LARGE_VISIBLE_FILES[520]);

    controller.destroy();
  });

  test('onSearchChange fires for typed input, key-open seeding, and close but not initialSearchQuery', async () => {
    const FileTreeController = await loadFileTreeController();
    const calls: Array<string | null> = [];

    const controller = new FileTreeController({
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
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
        'button[data-type="item"]'
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
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
        'button[data-type="item"]'
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
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
        'button[data-type="item"]'
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
      const selectedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-selected="true"]'
      );
      expect(selectedRow?.getAttribute('data-item-path')).toBe(
        focusedPathBeforeSubmit
      );
      expect(shadowRoot?.activeElement).toBe(selectedRow);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Enter immediately after ArrowDown still returns focus to the selected row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const manyWorkerFiles = [
        'README.md',
        ...Array.from({ length: 24 }, (_unused, index) => {
          return `src/utils/worker/match-${String(index)}.ts`;
        }),
      ];

      const fileTree = new FileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        id: 'pst-search-enter-race-test',
        initialExpansion: 'open',
        overscan: 0,
        paths: manyWorkerFiles,
        search: true,
        viewportHeight: 44,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstButton = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-type="item"]'
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

      pressKey(searchInput as HTMLInputElement, dom, 'ArrowDown', {
        code: 'ArrowDown',
      });
      pressKey(searchInput as HTMLInputElement, dom, 'Enter', {
        code: 'Enter',
      });
      await flushDom();
      await flushDom();

      const selectedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-selected="true"]'
      );
      expect(fileTree.isSearchOpen()).toBe(false);
      expect(selectedRow).not.toBeNull();
      expect(selectedRow?.getAttribute('data-item-path')).toBe(
        'src/utils/worker/match-1.ts'
      );
      expect(shadowRoot?.activeElement).toBe(selectedRow);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('closing search scrolls a newly selected offscreen row back toward the viewport center', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const offscreenWorkerFiles = [
        'README.md',
        ...Array.from({ length: 24 }, (_unused, index) => {
          return `src/generated/file-${String(index)}.ts`;
        }),
        ...Array.from({ length: 24 }, (_unused, index) => {
          return `src/utils/worker/match-${String(index)}.ts`;
        }),
      ];

      const fileTree = new FileTree({
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: false,
        id: 'pst-search-center-selected-row',
        initialExpansion: 'open',
        overscan: 0,
        paths: offscreenWorkerFiles,
        search: true,
        viewportHeight: 44,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector<HTMLElement>(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const firstButton = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-type="item"]'
      );
      const searchInput = shadowRoot?.querySelector<HTMLInputElement>(
        'input[data-file-tree-search-input]'
      );
      expect(scrollElement).not.toBeNull();
      expect(firstButton).not.toBeNull();
      expect(searchInput).not.toBeNull();

      firstButton?.focus();
      pressKey(firstButton as HTMLButtonElement, dom, 'w');
      await flushDom();

      setInputValue(searchInput as HTMLInputElement, dom, 'worker');
      await flushDom();

      pressKey(searchInput as HTMLInputElement, dom, 'ArrowDown', {
        code: 'ArrowDown',
      });
      pressKey(searchInput as HTMLInputElement, dom, 'Enter', {
        code: 'Enter',
      });
      await flushDom();
      await flushDom();

      const selectedRow = shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-item-selected="true"]'
      );
      expect(scrollElement?.scrollTop).toBeGreaterThan(0);
      expect(selectedRow?.getAttribute('data-item-path')).toBe(
        'src/utils/worker/match-1.ts'
      );
      expect(shadowRoot?.activeElement).toBe(selectedRow);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
