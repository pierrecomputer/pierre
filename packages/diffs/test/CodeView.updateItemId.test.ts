import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import {
  CodeView,
  type CodeViewLineSelection,
} from '../src/components/CodeView';
import type {
  CodeViewItem,
  CodeViewScrollTarget,
  FileContents,
} from '../src/types';

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

async function renderItems(
  viewer: CodeView,
  items: readonly CodeViewItem[]
): Promise<void> {
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
}

describe('CodeView item id updates', () => {
  test('emits a selected line change when renaming the selected item', async () => {
    const { cleanup } = installDom();
    const changes: (CodeViewLineSelection | null)[] = [];
    const viewer = new CodeView({
      onSelectedLinesChange(selection) {
        changes.push(selection);
      },
    });
    const root = createRoot();
    const selection: CodeViewLineSelection = {
      id: 'file:old',
      range: { start: 2, end: 3 },
    };

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:old', 20)]);
      viewer.setSelectedLines(selection, { notify: false });

      expect(viewer.updateItemId('file:old', 'file:new')).toBe(true);

      const renamedSelection = { ...selection, id: 'file:new' };
      expect(viewer.getSelectedLines()).toEqual(renamedSelection);
      expect(changes).toEqual([renamedSelection]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('does not mutate a pending scroll target passed by the caller', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();
    const target: CodeViewScrollTarget = {
      type: 'item',
      id: 'file:old',
      align: 'center',
      behavior: 'instant',
    };

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:old', 120)]);
      viewer.scrollTo(target);

      expect(viewer.updateItemId('file:old', 'file:new')).toBe(true);

      expect(target).toEqual({
        type: 'item',
        id: 'file:old',
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
