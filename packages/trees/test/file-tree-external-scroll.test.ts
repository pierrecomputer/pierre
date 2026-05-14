import { describe, expect, test } from 'bun:test';

import {
  getFileTreeExternalScrollFallbackViewportHeight,
  normalizeFileTreeExternalScrollSnapshot,
  resolveFileTreeExternalScrollInitialSnapshot,
} from '../src/model/externalScroll';
import {
  computeFileTreeExternalLayout,
  type FileTreeLayoutRow,
} from '../src/model/layout';
import {
  createDomScrollSource,
  type FileTreeExternalScrollRequestContext,
  type FileTreeExternalScrollSnapshot,
} from '../src/scroll';
import { flushDom, installDom } from './helpers/dom';
import { loadScrollFileTree } from './helpers/loadFileTree';
import {
  getItemButton,
  getMountedItemPaths,
  getStickyRowPaths,
  pressKey,
} from './helpers/renderHarness';

describe('external scroll snapshot normalization', () => {
  test('preserves valid metrics and derives the effective viewport height', () => {
    expect(
      normalizeFileTreeExternalScrollSnapshot({
        bottomInset: 12,
        isScrolling: true,
        scrollOrigin: 'user',
        topInset: 18,
        viewportHeight: 120,
        viewportTop: -30,
      })
    ).toEqual({
      bottomInset: 12,
      effectiveViewportHeight: 90,
      isScrolling: true,
      scrollOrigin: 'user',
      topInset: 18,
      viewportHeight: 120,
      viewportTop: -30,
    });
  });

  test('clamps heights and insets while keeping raw finite viewportTop', () => {
    expect(
      normalizeFileTreeExternalScrollSnapshot({
        bottomInset: -4,
        topInset: -10,
        viewportHeight: -120,
        viewportTop: -45,
      })
    ).toEqual({
      bottomInset: 0,
      effectiveViewportHeight: 0,
      isScrolling: false,
      scrollOrigin: 'unknown',
      topInset: 0,
      viewportHeight: 0,
      viewportTop: -45,
    });
  });

  test('falls back for non-finite numbers and invalid origins', () => {
    const snapshot = {
      bottomInset: Number.POSITIVE_INFINITY,
      isScrolling: false,
      scrollOrigin: 'gesture',
      topInset: Number.NaN,
      viewportHeight: Number.NaN,
      viewportTop: Number.NEGATIVE_INFINITY,
    } as unknown as FileTreeExternalScrollSnapshot;

    expect(normalizeFileTreeExternalScrollSnapshot(snapshot, 150)).toEqual({
      bottomInset: 0,
      effectiveViewportHeight: 150,
      isScrolling: false,
      scrollOrigin: 'unknown',
      topInset: 0,
      viewportHeight: 150,
      viewportTop: 0,
    });
  });

  test('derives the initial fallback viewport height from visible row count', () => {
    expect(
      getFileTreeExternalScrollFallbackViewportHeight({
        initialVisibleRowCount: 4.5,
        itemHeight: 24,
      })
    ).toBe(108);
    expect(
      getFileTreeExternalScrollFallbackViewportHeight({
        initialVisibleRowCount: -2,
        itemHeight: 24,
      })
    ).toBe(0);
  });

  test('uses initialSnapshot before the initialVisibleRowCount fallback', () => {
    expect(
      resolveFileTreeExternalScrollInitialSnapshot({
        initialSnapshot: { viewportHeight: 60, viewportTop: 15 },
        initialVisibleRowCount: 10,
        itemHeight: 30,
      }).viewportHeight
    ).toBe(60);
  });

  test('uses initialVisibleRowCount when no initialSnapshot exists', () => {
    expect(
      resolveFileTreeExternalScrollInitialSnapshot({
        initialVisibleRowCount: 5,
        itemHeight: 30,
      })
    ).toEqual({
      bottomInset: 0,
      effectiveViewportHeight: 150,
      isScrolling: false,
      scrollOrigin: 'unknown',
      topInset: 0,
      viewportHeight: 150,
      viewportTop: 0,
    });
  });
});

function createLayoutRows(count: number): FileTreeLayoutRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ancestorPaths: [],
    isExpanded: false,
    kind: 'file',
    path: `file-${String(index).padStart(2, '0')}.ts`,
  }));
}

describe('computeFileTreeExternalLayout', () => {
  const itemHeight = 10;
  const rows = createLayoutRows(10);

  test('returns an empty mounted window when the viewport is fully above overscan', () => {
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 10,
      viewportTop: -40,
    });

    expect(layout.visible).toEqual({ endIndex: -1, startIndex: -1 });
    expect(layout.window).toMatchObject({ endIndex: -1, startIndex: -1 });
  });

  test('mounts rows when an above-tree viewport is within overscan', () => {
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 10,
      viewportTop: -15,
    });

    expect(layout.visible).toEqual({ endIndex: -1, startIndex: -1 });
    expect(layout.window).toMatchObject({ endIndex: 0, startIndex: 0 });
  });

  test('renders top rows when the viewport partially overlaps the row area', () => {
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 20,
      viewportTop: -5,
    });

    expect(layout.visible).toEqual({ endIndex: 1, startIndex: 0 });
    expect(layout.window).toMatchObject({ endIndex: 2, startIndex: 0 });
  });

  test('renders the expected row window for an in-tree viewport', () => {
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 20,
      viewportTop: 25,
    });

    expect(layout.visible).toEqual({ endIndex: 4, startIndex: 2 });
    expect(layout.window).toMatchObject({
      endIndex: 5,
      offsetTop: 10,
      startIndex: 1,
    });
  });

  test('returns an empty mounted window when the viewport is fully below overscan', () => {
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 10,
      viewportTop: 120,
    });

    expect(layout.visible).toEqual({ endIndex: -1, startIndex: -1 });
    expect(layout.window).toMatchObject({ endIndex: -1, startIndex: -1 });
  });

  test('uses normalized insets to reduce the external viewport height', () => {
    const snapshot = normalizeFileTreeExternalScrollSnapshot({
      bottomInset: 10,
      topInset: 10,
      viewportHeight: 40,
      viewportTop: 20,
    });
    const layout = computeFileTreeExternalLayout(rows, {
      itemHeight,
      overscan: 0,
      viewportHeight: snapshot.effectiveViewportHeight,
      viewportTop: snapshot.viewportTop + snapshot.topInset,
    });

    expect(layout.visible).toEqual({ endIndex: 4, startIndex: 3 });
  });

  test('does not compute sticky rows when the viewport is outside the tree', () => {
    const directoryRows: FileTreeLayoutRow[] = [
      {
        ancestorPaths: [],
        isExpanded: true,
        kind: 'directory',
        path: 'src/',
      },
      ...createLayoutRows(4).map((row) => ({
        ...row,
        ancestorPaths: ['src/'],
        path: `src/${row.path}`,
      })),
    ];

    const layout = computeFileTreeExternalLayout(directoryRows, {
      itemHeight,
      overscan: 1,
      viewportHeight: 20,
      viewportTop: 100,
    });

    expect(layout.sticky.rows).toEqual([]);
  });
});

class TestExternalScrollSource {
  requests: {
    context: FileTreeExternalScrollRequestContext;
    viewportTop: number;
  }[] = [];
  unsubscribeCount = 0;
  #listeners = new Set<() => void>();
  #snapshot: FileTreeExternalScrollSnapshot;

  constructor(snapshot: FileTreeExternalScrollSnapshot) {
    this.#snapshot = snapshot;
  }

  getSnapshot(): FileTreeExternalScrollSnapshot {
    return this.#snapshot;
  }

  scrollToViewportTop(
    viewportTop: number,
    context: FileTreeExternalScrollRequestContext
  ): void {
    this.requests.push({ context, viewportTop });
    this.#snapshot = {
      ...this.#snapshot,
      isScrolling: false,
      scrollOrigin: 'programmatic',
      viewportTop,
    };
  }

  setSnapshot(snapshot: FileTreeExternalScrollSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.unsubscribeCount += 1;
      this.#listeners.delete(listener);
    };
  }
}

function createFlatPaths(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `item${String(index).padStart(3, '0')}.ts`
  );
}

describe('createDomScrollSource', () => {
  const createRect = (top: number, height: number): DOMRect =>
    ({
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      toJSON: () => null,
      top,
      width: 0,
      x: 0,
      y: top,
    }) as DOMRect;

  test('tracks host-local metrics and updates synchronously', () => {
    const { cleanup, dom } = installDom();
    try {
      const scrollContainer = dom.window.document.createElement('div');
      const host = dom.window.document.createElement('div');
      const scrollContainerTop = 80;
      const hostBaseTop = 200;

      Object.defineProperty(scrollContainer, 'clientHeight', {
        configurable: true,
        get: () => 120,
      });
      Object.defineProperty(scrollContainer, 'clientTop', {
        configurable: true,
        get: () => 8,
      });
      scrollContainer.getBoundingClientRect = () =>
        createRect(scrollContainerTop, 120);
      host.getBoundingClientRect = () =>
        createRect(hostBaseTop - scrollContainer.scrollTop, 24);

      const source = createDomScrollSource({
        bottomInset: () => 6,
        scrollContainer,
        topInset: () => 12,
      });
      source.setHost(host);

      expect(source.getSnapshot()).toEqual({
        bottomInset: 6,
        isScrolling: false,
        scrollOrigin: 'unknown',
        topInset: 12,
        viewportHeight: 120,
        viewportTop: -112,
      });

      let notificationCount = 0;
      const unsubscribe = source.subscribe(() => {
        notificationCount += 1;
      });

      scrollContainer.scrollTop = 30;
      scrollContainer.dispatchEvent(new dom.window.Event('scroll'));
      expect(notificationCount).toBe(1);
      expect(source.getSnapshot()).toMatchObject({
        scrollOrigin: 'user',
        viewportTop: -82,
      });

      source.scrollToViewportTop(40, {
        origin: 'programmatic',
        reason: 'focus-reveal',
      });
      expect(scrollContainer.scrollTop).toBe(152);
      expect(source.getSnapshot()).toMatchObject({
        scrollOrigin: 'programmatic',
        viewportTop: 40,
      });

      unsubscribe();
      source.destroy();
    } finally {
      cleanup();
    }
  });
});

describe('FileTree external scroll runtime', () => {
  test('initial snapshot drives the first rendered window', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: { viewportHeight: 60, viewportTop: 90 },
        },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();

      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item003.ts', 'item004.ts']);
      expect(fileTree.getFileTreeContainer()?.dataset.fileTreeScrollMode).toBe(
        'external'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('source subscription updates rendered rows', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const source = new TestExternalScrollSource({
        viewportHeight: 60,
        viewportTop: 0,
      });
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: { source },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item000.ts', 'item001.ts']);

      source.setSnapshot({ viewportHeight: 60, viewportTop: 180 });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item006.ts', 'item007.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('outside external viewports render no rows until they intersect', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const source = new TestExternalScrollSource({
        viewportHeight: 30,
        viewportTop: -90,
      });
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: { source },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual([]);

      source.setSnapshot({ viewportHeight: 30, viewportTop: -10 });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item000.ts']);

      source.setSnapshot({ viewportHeight: 30, viewportTop: 900 });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual([]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('topInset and bottomInset shrink the rendered external window', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: {
            bottomInset: 30,
            topInset: 30,
            viewportHeight: 90,
            viewportTop: 0,
          },
        },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();

      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item001.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focus reveal calls the external source with structured context', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const source = new TestExternalScrollSource({
        bottomInset: 30,
        topInset: 0,
        viewportHeight: 90,
        viewportTop: 0,
      });
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: { source },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(50),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'item000.ts').focus();
      pressKey(getItemButton(shadowRoot, dom, 'item000.ts'), dom, 'End');
      await flushDom(2);

      expect(source.requests).toEqual([
        {
          context: {
            origin: 'programmatic',
            path: 'item049.ts',
            reason: 'focus-reveal',
          },
          viewportTop: 1440,
        },
      ]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('missing live source leaves scroll requests as no-ops', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: { viewportHeight: 60, viewportTop: 0 },
        },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'item000.ts').focus();
      expect(() => {
        pressKey(getItemButton(shadowRoot, dom, 'item000.ts'), dom, 'End');
      }).not.toThrow();
      await flushDom(2);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('detaching the live source leaves reveal requests as no-ops', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const source = new TestExternalScrollSource({
        viewportHeight: 60,
        viewportTop: 0,
      });
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: { viewportHeight: 60, viewportTop: 0 },
        },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      fileTree.setExternalScrollSource(source);
      fileTree.setExternalScrollSource(undefined);
      expect(source.unsubscribeCount).toBe(1);

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      getItemButton(shadowRoot, dom, 'item000.ts').focus();
      expect(() => {
        pressKey(getItemButton(shadowRoot, dom, 'item000.ts'), dom, 'End');
      }).not.toThrow();
      await flushDom(2);
      expect(source.requests).toEqual([]);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('setExternalScrollSource replaces the source subscription', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const firstSource = new TestExternalScrollSource({
        viewportHeight: 60,
        viewportTop: 0,
      });
      const secondSource = new TestExternalScrollSource({
        viewportHeight: 60,
        viewportTop: 180,
      });
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: { viewportHeight: 60, viewportTop: 0 },
        },
        flattenEmptyDirectories: false,
        overscan: 0,
        paths: createFlatPaths(20),
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      fileTree.setExternalScrollSource(firstSource);
      firstSource.setSnapshot({ viewportHeight: 60, viewportTop: 90 });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item003.ts', 'item004.ts']);

      fileTree.setExternalScrollSource(secondSource);
      expect(firstSource.unsubscribeCount).toBe(1);
      secondSource.setSnapshot({ viewportHeight: 60, viewportTop: 180 });
      firstSource.setSnapshot({ viewportHeight: 60, viewportTop: 0 });
      await flushDom();
      expect(
        getMountedItemPaths(fileTree.getFileTreeContainer()?.shadowRoot, dom)
      ).toEqual(['item006.ts', 'item007.ts']);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('internal-scroll models reject external source attachment', async () => {
    const { cleanup } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        paths: createFlatPaths(2),
      });

      expect(() => {
        fileTree.setExternalScrollSource(
          new TestExternalScrollSource({ viewportHeight: 60, viewportTop: 0 })
        );
      }).toThrow(/constructed with externalScroll/);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('sticky folders use the external top inset', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadScrollFileTree();
      const wrapper = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(wrapper);
      const fileTree = new FileTree({
        externalScroll: {
          initialSnapshot: {
            topInset: 12,
            viewportHeight: 90,
            viewportTop: 45,
          },
        },
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        overscan: 0,
        paths: ['src/a.ts', 'src/b.ts', 'src/nested/c.ts', 'test/a.ts'],
        stickyFolders: true,
      });

      fileTree.render({ containerWrapper: wrapper });
      await flushDom();
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(getStickyRowPaths(shadowRoot, dom)).toContain('src/');
      const overlay = shadowRoot?.querySelector(
        '[data-file-tree-sticky-overlay="true"]'
      );
      expect(
        overlay instanceof dom.window.HTMLElement
          ? overlay.style.getPropertyValue('top')
          : null
      ).toBe('12px');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
