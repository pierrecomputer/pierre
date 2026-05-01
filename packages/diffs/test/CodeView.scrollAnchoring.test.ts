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

function makeFile(name: string, lineCount: number): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `line ${index + 1}`
    ).join('\n'),
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
});
