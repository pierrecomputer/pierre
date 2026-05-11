import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';
import {
  DEFAULT_CODE_VIEW_FILE_METRICS,
  DEFAULT_CODE_VIEW_LAYOUT,
} from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const ROOT_HEIGHT = 800;
const ROOT_WIDTH = 1000;

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
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    root.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: ROOT_HEIGHT,
      height: ROOT_HEIGHT,
      left: 0,
      right: ROOT_WIDTH,
      top: 0,
      width: ROOT_WIDTH,
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

function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
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

function makeInsertedDiffItem(id: string): CodeViewItem<undefined> {
  const oldLines = Array.from(
    { length: 160 },
    (_, index) => `line ${index + 1}`
  );
  const insertedLines = Array.from(
    { length: 10 },
    (_, index) => `inserted ${index + 1}`
  );
  const newLines = [
    ...oldLines.slice(0, 80),
    ...insertedLines,
    ...oldLines.slice(80),
  ];

  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: 'src/inserted.ts', contents: oldLines.join('\n') },
      { name: 'src/inserted.ts', contents: newLines.join('\n') }
    ),
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

function getFileLineTop(lineNumber: number): number {
  return (
    DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight +
    (lineNumber - 1) * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight
  );
}

function getViewportTopForLocalTop(localTop: number): number {
  return DEFAULT_CODE_VIEW_LAYOUT.paddingTop + localTop;
}

describe('CodeView range scrolling', () => {
  test('scrolls a single-line range to the same position as a line target', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'line',
        id: 'file:example',
        lineNumber: 50,
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
      const lineScrollTop = root.scrollTop;

      viewer.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 50, end: 50 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(lineScrollTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('centers a multi-line range as a single region', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 20, end: 30 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      const rangeTop = getViewportTopForLocalTop(getFileLineTop(20));
      const rangeHeight = 11 * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight;
      const expectedScrollTop = rangeTop - (ROOT_HEIGHT - rangeHeight) / 2;
      expect(root.scrollTop).toBe(expectedScrollTop);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('keeps nearest alignment still when the full range is visible', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      root.scrollTop = 500;
      dispatchScroll(root);
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 30, end: 35 },
        align: 'nearest',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(500);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('moves nearest alignment when the range starts above the viewport', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      root.scrollTop = 700;
      dispatchScroll(root);
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 30, end: 35 },
        align: 'nearest',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(
        getViewportTopForLocalTop(getFileLineTop(30))
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('falls back to start alignment when a centered range is taller than the viewport', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:example', 120)]);

      viewer.scrollTo({
        type: 'range',
        id: 'file:example',
        range: { start: 10, end: 60 },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop).toBe(
        getViewportTopForLocalTop(getFileLineTop(10))
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('resolves split-view range endpoints against their requested sides', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ diffStyle: 'split', expandUnchanged: true });
    const root = createRoot();

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeInsertedDiffItem('diff:inserted')]);

      viewer.scrollTo({
        type: 'range',
        id: 'diff:inserted',
        range: { start: 120, end: 120, side: 'additions' },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
      const additionsScrollTop = root.scrollTop;

      viewer.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
      viewer.render(true);

      viewer.scrollTo({
        type: 'range',
        id: 'diff:inserted',
        range: { start: 120, end: 120, side: 'deletions' },
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);

      expect(root.scrollTop - additionsScrollTop).toBe(
        10 * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
