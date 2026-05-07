import { describe, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
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
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
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
    HTMLStyleElement: dom.window.HTMLStyleElement,
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
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
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

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRenderedPre(
  root: ParentNode,
  predicate: (pre: HTMLPreElement) => boolean,
  message: string
): Promise<HTMLPreElement> {
  let lastAttribute: string | null | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    const pre = findRenderedPre(root);
    lastAttribute = pre?.getAttribute('data-indicators');
    if (pre != null && predicate(pre)) {
      return pre;
    }
    await wait(10);
  }
  throw new Error(`${message}; last data-indicators=${String(lastAttribute)}`);
}

function findRenderedPre(root: ParentNode): HTMLPreElement | null {
  const directPre = root.querySelector('pre');
  if (directPre instanceof HTMLPreElement) {
    return directPre;
  }

  for (const element of root.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const shadowRoot = element.shadowRoot;
    if (shadowRoot == null) {
      continue;
    }
    const shadowPre = findRenderedPre(shadowRoot);
    if (shadowPre != null) {
      return shadowPre;
    }
  }

  return null;
}

function makeFile(name: string, contents: string): FileContents {
  return { name, contents };
}

function makeDiffItem(): CodeViewItem<undefined> {
  return {
    id: 'diff:indicator-style',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      makeFile('src/example.ts', 'const value = 1;\n'),
      makeFile('src/example.ts', 'const value = 2;\n')
    ),
  };
}

describe('CodeView diff indicators', () => {
  test('updates rendered indicator attributes when options change', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      diffIndicators: 'bars',
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const root = createRoot();

    try {
      viewer.setup(root);
      viewer.setItems([makeDiffItem()]);
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => pre.getAttribute('data-indicators') === 'bars',
        'Expected initial bars indicators'
      );

      viewer.setOptions({
        diffIndicators: 'classic',
        disableErrorHandling: true,
        disableFileHeader: true,
      });
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => pre.getAttribute('data-indicators') === 'classic',
        'Expected classic indicators after option change'
      );

      viewer.setOptions({
        diffIndicators: 'none',
        disableErrorHandling: true,
        disableFileHeader: true,
      });
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => !pre.hasAttribute('data-indicators'),
        'Expected indicators to be removed after option change'
      );
    } finally {
      viewer.cleanUp();
      await disposeHighlighter();
      cleanup();
    }
  });
});
