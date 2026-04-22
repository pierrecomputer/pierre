import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import type {
  FileTreeDropContext,
  FileTreeDropResult,
  FileTreeOptions,
} from '../src/index';

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

type MockDataTransfer = {
  data: Map<string, string>;
  dropEffect: DataTransfer['dropEffect'];
  effectAllowed: DataTransfer['effectAllowed'];
  getData(type: string): string;
  setData(type: string, value: string): void;
  setDragImage(_element: Element, _x: number, _y: number): void;
};

function createMockDataTransfer(): MockDataTransfer {
  return {
    data: new Map(),
    dropEffect: 'move',
    effectAllowed: 'move',
    getData(type: string): string {
      return this.data.get(type) ?? '';
    },
    setData(type: string, value: string): void {
      this.data.set(type, value);
    },
    setDragImage(): void {},
  };
}

function dispatchDragEvent(
  element: HTMLElement,
  dom: JSDOM,
  type: string,
  init: {
    clientX?: number;
    clientY?: number;
    dataTransfer?: MockDataTransfer;
    relatedTarget?: EventTarget | null;
  } = {}
): void {
  const event = new dom.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    clientX: {
      configurable: true,
      value: init.clientX ?? 100,
    },
    clientY: {
      configurable: true,
      value: init.clientY ?? 100,
    },
    dataTransfer: {
      configurable: true,
      value: init.dataTransfer ?? createMockDataTransfer(),
    },
    relatedTarget: {
      configurable: true,
      value: init.relatedTarget ?? null,
    },
  });
  element.dispatchEvent(event);
}

function dispatchTouchEvent(
  target: EventTarget,
  dom: JSDOM,
  type: string,
  init: {
    changedTouches?: readonly { clientX: number; clientY: number }[];
    touches?: readonly { clientX: number; clientY: number }[];
  }
): void {
  const event = new dom.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    changedTouches: {
      configurable: true,
      value: init.changedTouches ?? init.touches ?? [],
    },
    touches: {
      configurable: true,
      value: init.touches ?? [],
    },
  });
  target.dispatchEvent(event);
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

  return root;
}

function getItemButton(
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

function getStickyRowButton(
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

function getUniqueItemPaths(elements: Iterable<HTMLElement>): string[] {
  return Array.from(
    new Set(
      Array.from(elements)
        .map(
          (element) =>
            element.dataset.fileTreeStickyPath ?? element.dataset.itemPath
        )
        .filter((path): path is string => path != null)
    )
  );
}

function getDraggingPaths(shadowRoot: ShadowRoot | null | undefined): string[] {
  return getUniqueItemPaths(
    shadowRoot?.querySelectorAll<HTMLElement>('[data-item-dragging="true"]') ??
      []
  );
}

function getDragTargetPaths(
  shadowRoot: ShadowRoot | null | undefined
): string[] {
  return getUniqueItemPaths(
    shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-item-drag-target="true"]'
    ) ?? []
  );
}

function getScrollElement(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLElement {
  const scrollElement = shadowRoot?.querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  if (!(scrollElement instanceof dom.window.HTMLElement)) {
    throw new Error('missing scroll element');
  }

  return scrollElement;
}

function getParkedDraggingButton(
  shadowRoot: ShadowRoot | null | undefined,
  path: string
): HTMLElement | null {
  return (
    shadowRoot?.querySelector(
      `[data-item-path="${path}"][data-item-parked="true"][data-item-dragging="true"]`
    ) ?? null
  );
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

async function loadFileTreeController(): Promise<
  typeof import('../src/model/FileTreeController').FileTreeController
> {
  const { FileTreeController } =
    await import('../src/model/FileTreeController');
  return FileTreeController;
}

async function renderFileTree(options: FileTreeOptions) {
  const { cleanup, dom } = installDom();
  const FileTree = await loadFileTree();
  const mount = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(mount);
  const fileTree = new FileTree(options);
  fileTree.render({ containerWrapper: mount });
  await flushDom();
  const host = fileTree.getFileTreeContainer();
  const shadowRoot = host?.shadowRoot;
  const treeRoot = getTreeRoot(shadowRoot, dom);

  return {
    cleanup: () => {
      fileTree.cleanUp();
      cleanup();
    },
    dom,
    fileTree,
    shadowRoot,
    treeRoot,
  };
}

const BASE_PATHS = [
  'README.md',
  'package.json',
  'docs/guide.md',
  'docs/api.md',
  'src/index.ts',
  'src/lib/utils.ts',
  'src/lib/theme.ts',
  'assets/images/social/logo.png',
  'assets/images/social/banner.png',
] as const;

describe('file-tree drag and drop', () => {
  test('getDragSession returns a snapshot and failed completion clears the session', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      paths: ['README.md'],
    });

    try {
      expect(controller.startDrag('README.md')).toBe(true);
      const dragSession = controller.getDragSession();
      if (dragSession == null) {
        throw new Error('expected drag session');
      }

      (dragSession.draggedPaths as string[]).push('mutated.ts');
      dragSession.target = {
        directoryPath: 'fake/',
        flattenedSegmentPath: null,
        hoveredPath: 'fake/',
        kind: 'directory',
      };

      expect(controller.getDragSession()).toEqual({
        draggedPaths: ['README.md'],
        primaryPath: 'README.md',
        target: null,
      });
      expect(controller.completeDrag()).toBe(false);
      expect(controller.getDragSession()).toBeNull();
    } finally {
      controller.destroy();
    }
  });

  test('external path mutations abort an in-flight drag session', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
    });

    try {
      expect(controller.startDrag('README.md')).toBe(true);
      expect(controller.getDragSession()).toEqual({
        draggedPaths: ['README.md'],
        primaryPath: 'README.md',
        target: null,
      });

      controller.move('src/index.ts', 'src/main.ts');

      expect(controller.getDragSession()).toBeNull();
      expect(controller.getItem('src/main.ts')).not.toBeNull();
      expect(controller.getItem('src/index.ts')).toBeNull();
    } finally {
      controller.destroy();
    }
  });

  test('touch pending drag disables native draggable until the touch ends', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );

      dispatchTouchEvent(sourceButton, rendered.dom, 'touchstart', {
        touches: [{ clientX: 12, clientY: 12 }],
      });
      await flushDom();
      expect(sourceButton.getAttribute('draggable')).toBe('false');

      dispatchTouchEvent(
        rendered.dom.window.document,
        rendered.dom,
        'touchend',
        {
          changedTouches: [{ clientX: 12, clientY: 12 }],
        }
      );
      await flushDom();
      expect(sourceButton.getAttribute('draggable')).toBe('true');
    } finally {
      rendered.cleanup();
    }
  });

  test('touch drag activation keeps native draggable disabled', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      const draggableWrites: string[] = [];
      const setAttribute = sourceButton.setAttribute.bind(sourceButton);
      sourceButton.setAttribute = (name: string, value: string): void => {
        if (name === 'draggable') {
          draggableWrites.push(value);
        }
        setAttribute(name, value);
      };

      dispatchTouchEvent(sourceButton, rendered.dom, 'touchstart', {
        touches: [{ clientX: 12, clientY: 12 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
      await flushDom();

      expect(draggableWrites).not.toContain('true');
      expect(sourceButton.getAttribute('draggable')).toBe('false');
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual(['README.md']);

      dispatchTouchEvent(
        rendered.dom.window.document,
        rendered.dom,
        'touchcancel',
        {
          changedTouches: [{ clientX: 12, clientY: 12 }],
        }
      );
      await flushDom();
      expect(sourceButton.getAttribute('draggable')).toBe('true');
    } finally {
      rendered.cleanup();
    }
  });

  test('touch drag resolves drop targets when shadow hit-testing retargets to the host', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const host = rendered.fileTree.getFileTreeContainer();
      if (!(host instanceof rendered.dom.window.HTMLElement)) {
        throw new Error('missing file tree host');
      }
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      sourceButton.getBoundingClientRect = () =>
        ({
          bottom: 30,
          height: 30,
          left: 0,
          right: 240,
          top: 0,
          width: 240,
          x: 0,
          y: 0,
        }) as DOMRect;
      targetButton.getBoundingClientRect = () =>
        ({
          bottom: 70,
          height: 30,
          left: 0,
          right: 240,
          top: 40,
          width: 240,
          x: 0,
          y: 40,
        }) as DOMRect;
      rendered.dom.window.document.elementFromPoint = () => host;

      dispatchTouchEvent(sourceButton, rendered.dom, 'touchstart', {
        touches: [{ clientX: 12, clientY: 12 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
      await flushDom();
      dispatchTouchEvent(
        rendered.dom.window.document,
        rendered.dom,
        'touchmove',
        {
          touches: [{ clientX: 12, clientY: 52 }],
        }
      );
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual(['src/']);

      dispatchTouchEvent(
        rendered.dom.window.document,
        rendered.dom,
        'touchend',
        {
          changedTouches: [{ clientX: 12, clientY: 52 }],
        }
      );
      await flushDom();

      expect(rendered.fileTree.getItem('src/README.md')).not.toBeNull();
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);
    } finally {
      rendered.cleanup();
    }
  });

  test('root-level file hover resolves to a root drop and clears drag state after success', async () => {
    const dropResults: FileTreeDropResult[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        onDropComplete: (event: FileTreeDropResult) => {
          dropResults.push(event);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'src/index.ts'],
      search: true,
      initialVisibleRowCount: 140 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/index.ts'
      );
      const hoveredButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => hoveredButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(hoveredButton, rendered.dom, 'dragover', {
        clientX: 12,
        clientY: 12,
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        clientX: 12,
        clientY: 12,
        dataTransfer,
      });
      await flushDom();

      expect(rendered.fileTree.getItem('index.ts')).not.toBeNull();
      expect(rendered.fileTree.getItem('src/index.ts')).toBeNull();
      expect(dropResults).toEqual([
        {
          draggedPaths: ['src/index.ts'],
          operation: 'move',
          target: {
            directoryPath: null,
            flattenedSegmentPath: null,
            hoveredPath: 'README.md',
            kind: 'root',
          },
        },
      ]);
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);
    } finally {
      rendered.cleanup();
    }
  });

  test('sticky directory hover resolves the same drop target as the canonical folder row', async () => {
    const completed: FileTreeDropResult[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        onDropComplete: (event: FileTreeDropResult) => {
          completed.push(event);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['src/index.ts', 'src/utils.ts', 'z.ts'],
      stickyFolders: true,
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const scrollElement = getScrollElement(rendered.shadowRoot, rendered.dom);
      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new rendered.dom.window.Event('scroll'));
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'z.ts'
      );
      const canonicalTarget = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const stickyTarget = getStickyRowButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const dataTransfer = createMockDataTransfer();

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();

      rendered.dom.window.document.elementFromPoint = () => canonicalTarget;
      dispatchDragEvent(canonicalTarget, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual(['src/']);

      rendered.dom.window.document.elementFromPoint = () => stickyTarget;
      dispatchDragEvent(stickyTarget, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual(['src/']);

      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(rendered.fileTree.getItem('src/z.ts')).not.toBeNull();
      expect(rendered.fileTree.getItem('z.ts')).toBeNull();
      expect(completed).toEqual([
        {
          draggedPaths: ['z.ts'],
          operation: 'move',
          target: {
            directoryPath: 'src/',
            flattenedSegmentPath: null,
            hoveredPath: 'src/',
            kind: 'directory',
          },
        },
      ]);
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);
    } finally {
      rendered.cleanup();
    }
  });

  test('sticky rows can act as drag sources for directory moves', async () => {
    const completed: FileTreeDropResult[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        onDropComplete: (event: FileTreeDropResult) => {
          completed.push(event);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/', 'target/'],
      paths: ['src/index.ts', 'src/utils.ts', 'target/existing.ts'],
      stickyFolders: true,
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const scrollElement = getScrollElement(rendered.shadowRoot, rendered.dom);
      scrollElement.scrollTop = 1;
      scrollElement.dispatchEvent(new rendered.dom.window.Event('scroll'));
      await flushDom();

      const stickySource = getStickyRowButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'target/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => targetButton;

      dispatchDragEvent(stickySource, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual(['src/']);

      dispatchDragEvent(targetButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual(['target/']);

      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(rendered.fileTree.getItem('target/src/')).not.toBeNull();
      expect(rendered.fileTree.getItem('target/src/index.ts')).not.toBeNull();
      expect(rendered.fileTree.getItem('src/')).toBeNull();
      expect(completed).toEqual([
        {
          draggedPaths: ['src/'],
          operation: 'move',
          target: {
            directoryPath: 'target/',
            flattenedSegmentPath: null,
            hoveredPath: 'target/',
            kind: 'directory',
          },
        },
      ]);
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);
    } finally {
      rendered.cleanup();
    }
  });

  test('dragging a selected row moves the full selected set', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['docs/'],
      paths: BASE_PATHS,
      initialVisibleRowCount: 180 / 30,
    });

    try {
      rendered.fileTree.getItem('README.md')?.select();
      rendered.fileTree.getItem('package.json')?.select();
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'docs/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => targetButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(targetButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(rendered.fileTree.getItem('docs/README.md')).not.toBeNull();
      expect(rendered.fileTree.getItem('docs/package.json')).not.toBeNull();
      expect(rendered.fileTree.getItem('README.md')).toBeNull();
      expect(rendered.fileTree.getItem('package.json')).toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('dragging an unselected row collapses to a single-item drag and selection', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['docs/', 'src/'],
      paths: BASE_PATHS,
      initialVisibleRowCount: 180 / 30,
    });

    try {
      rendered.fileTree.getItem('README.md')?.select();
      rendered.fileTree.getItem('package.json')?.select();
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/index.ts'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'docs/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => targetButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      expect(rendered.fileTree.getSelectedPaths()).toEqual(['src/index.ts']);

      dispatchDragEvent(targetButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(rendered.fileTree.getItem('docs/index.ts')).not.toBeNull();
      expect(rendered.fileTree.getItem('README.md')).not.toBeNull();
      expect(rendered.fileTree.getItem('package.json')).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('self and descendant drops are rejected before mutation', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/', 'src/lib/'],
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const descendantButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/lib/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => descendantButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(descendantButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);

      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();
      expect(rendered.fileTree.getItem('src/')).not.toBeNull();
      expect(rendered.fileTree.getItem('src/lib/utils.ts')).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('search-active drag blocking matches legacy behavior', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      fileTreeSearchMode: 'hide-non-matches',
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: BASE_PATHS,
      search: true,
      initialVisibleRowCount: 180 / 30,
    });

    try {
      rendered.fileTree.setSearch('read');
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer: createMockDataTransfer(),
      });
      await flushDom();

      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);
      expect(rendered.fileTree.getSelectedPaths()).toEqual([]);
    } finally {
      rendered.cleanup();
    }
  });

  test('flattened segment targets resolve to canonical intermediate folder paths', async () => {
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['assets/images/social/', 'src/'],
      paths: [
        'assets/images/social/logo.png',
        'assets/images/social/banner.png',
        'src/index.ts',
      ],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/index.ts'
      );
      const segmentTarget = rendered.shadowRoot?.querySelector(
        '[data-item-flattened-subitem="assets/images/"]'
      );
      if (!(segmentTarget instanceof rendered.dom.window.HTMLElement)) {
        throw new Error('missing flattened segment target for assets/images/');
      }
      const flattenedSegmentTarget = segmentTarget;
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () =>
        flattenedSegmentTarget;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(flattenedSegmentTarget, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(
        rendered.fileTree.getItem('assets/images/index.ts')
      ).not.toBeNull();
      expect(
        rendered.fileTree.getItem('assets/images/social/index.ts')
      ).toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('parked dragged rows survive virtualization ejection during scroll', async () => {
    const paths = Array.from(
      { length: 180 },
      (_, index) => `item${String(index).padStart(3, '0')}.ts`
    );
    const rendered = await renderFileTree({
      dragAndDrop: true,
      flattenEmptyDirectories: false,
      paths,
      initialVisibleRowCount: 120 / 30,
    });

    try {
      const scrollElement = rendered.shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      if (!(scrollElement instanceof rendered.dom.window.HTMLElement)) {
        throw new Error('missing scroll element');
      }
      const viewport = scrollElement;

      viewport.scrollTop = 1500;
      viewport.dispatchEvent(new rendered.dom.window.Event('scroll'));
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'item050.ts'
      );
      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer: createMockDataTransfer(),
      });
      await flushDom();

      viewport.scrollTop = 3000;
      viewport.dispatchEvent(new rendered.dom.window.Event('scroll'));
      await flushDom();

      expect(
        getParkedDraggingButton(rendered.shadowRoot, 'item050.ts')
      ).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('path-based canDrag/canDrop hooks gate built-in pointer drops and onDropComplete observes success', async () => {
    const completed: FileTreeDropResult[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        canDrag: (paths: readonly string[]) => !paths.includes('README.md'),
        canDrop: (event: FileTreeDropContext) =>
          event.target.directoryPath !== 'docs/',
        onDropComplete: (event: FileTreeDropResult) => {
          completed.push(event);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['docs/', 'src/'],
      paths: ['README.md', 'docs/guide.md', 'package.json', 'src/index.ts'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const blockedSource = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      dispatchDragEvent(blockedSource, rendered.dom, 'dragstart', {
        dataTransfer: createMockDataTransfer(),
      });
      await flushDom();
      expect(getDraggingPaths(rendered.shadowRoot)).toEqual([]);

      const allowedSource = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'package.json'
      );
      const blockedTarget = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'docs/'
      );
      const allowedTarget = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );

      const blockedDataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => blockedTarget;
      dispatchDragEvent(allowedSource, rendered.dom, 'dragstart', {
        dataTransfer: blockedDataTransfer,
      });
      await flushDom();
      dispatchDragEvent(blockedTarget, rendered.dom, 'dragover', {
        dataTransfer: blockedDataTransfer,
      });
      await flushDom();
      expect(getDragTargetPaths(rendered.shadowRoot)).toEqual([]);
      dispatchDragEvent(allowedSource, rendered.dom, 'dragend', {
        dataTransfer: blockedDataTransfer,
      });
      await flushDom();

      const allowedDataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => allowedTarget;
      dispatchDragEvent(allowedSource, rendered.dom, 'dragstart', {
        dataTransfer: allowedDataTransfer,
      });
      await flushDom();
      dispatchDragEvent(allowedTarget, rendered.dom, 'dragover', {
        dataTransfer: allowedDataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer: allowedDataTransfer,
      });
      await flushDom();

      expect(completed).toEqual([
        {
          draggedPaths: ['package.json'],
          operation: 'move',
          target: {
            directoryPath: 'src/',
            flattenedSegmentPath: null,
            hoveredPath: 'src/',
            kind: 'directory',
          },
        },
      ]);
      expect(rendered.fileTree.getItem('src/package.json')).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('multi-item collision errors do not partially move earlier paths', async () => {
    const errors: string[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        onDropError: (error: string) => {
          errors.push(error);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['README.md', 'package.json', 'src/package.json'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      rendered.fileTree.getItem('README.md')?.select();
      rendered.fileTree.getItem('package.json')?.select();
      await flushDom();

      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'README.md'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => targetButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(targetButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(errors).toEqual([
        'Destination already exists: "src/package.json"',
      ]);
      expect(rendered.fileTree.getItem('README.md')).not.toBeNull();
      expect(rendered.fileTree.getItem('src/README.md')).toBeNull();
      expect(rendered.fileTree.getItem('package.json')).not.toBeNull();
      expect(rendered.fileTree.getItem('src/package.json')).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  test('onDropError reports collision failures without controlled mode', async () => {
    const errors: string[] = [];
    const rendered = await renderFileTree({
      dragAndDrop: {
        onDropError: (error: string) => {
          errors.push(error);
        },
      },
      flattenEmptyDirectories: true,
      initialExpandedPaths: ['src/'],
      paths: ['package.json', 'src/package.json'],
      initialVisibleRowCount: 180 / 30,
    });

    try {
      const sourceButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'package.json'
      );
      const targetButton = getItemButton(
        rendered.shadowRoot,
        rendered.dom,
        'src/'
      );
      const dataTransfer = createMockDataTransfer();
      rendered.dom.window.document.elementFromPoint = () => targetButton;

      dispatchDragEvent(sourceButton, rendered.dom, 'dragstart', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(targetButton, rendered.dom, 'dragover', {
        dataTransfer,
      });
      await flushDom();
      dispatchDragEvent(rendered.treeRoot, rendered.dom, 'drop', {
        dataTransfer,
      });
      await flushDom();

      expect(errors).toEqual([
        'Destination already exists: "src/package.json"',
      ]);
      expect(rendered.fileTree.getItem('package.json')).not.toBeNull();
    } finally {
      rendered.cleanup();
    }
  });
});
