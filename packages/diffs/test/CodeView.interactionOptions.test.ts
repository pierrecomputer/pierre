import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockPointerEvent extends dom.window.MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }

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
    Element: dom.window.Element,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    PointerEvent: MockPointerEvent,
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
  Object.assign(dom.window, { PointerEvent: MockPointerEvent });

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
      bottom: 400,
      height: 400,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
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

function makeFileItem(id: string, lineCount = 8): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.txt`, lineCount),
  };
}

async function renderFileItem(viewer: CodeView, item = makeFileItem('file')) {
  viewer.setItems([item]);
  viewer.render(true);
  await wait(0);
}

function getRenderedPre(viewer: CodeView): HTMLPreElement {
  const [renderedItem] = viewer.getRenderedItems();
  expect(renderedItem).toBeDefined();
  const pre = renderedItem?.element.shadowRoot?.querySelector('pre');
  expect(pre).toBeInstanceOf(HTMLPreElement);
  return pre as HTMLPreElement;
}

function getLineElement(pre: HTMLPreElement, lineNumber: number): HTMLElement {
  const line = pre.querySelector(`[data-line="${lineNumber}"]`);
  expect(line).toBeInstanceOf(HTMLElement);
  return line as HTMLElement;
}

function getNumberElement(
  pre: HTMLPreElement,
  lineNumber: number
): HTMLElement {
  const number = pre.querySelector(`[data-column-number="${lineNumber}"]`);
  expect(number).toBeInstanceOf(HTMLElement);
  return number as HTMLElement;
}

describe('CodeView interaction option updates', () => {
  test('enables line clicks for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const clickedLines: number[] = [];
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot());
      await renderFileItem(viewer);

      let pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-lines')).toBe(false);

      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        onLineClick: (props: { lineNumber: number }) => {
          clickedLines.push(props.lineNumber);
        },
      });
      await wait(0);

      pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-lines')).toBe(true);
      getLineElement(pre, 1).dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );

      expect(clickedLines).toEqual([1]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables line selection attributes for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot());
      await renderFileItem(viewer);

      let pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-line-numbers')).toBe(false);

      viewer.setOptions({
        disableFileHeader: true,
        enableLineSelection: true,
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-line-numbers')).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables hover highlighting for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot());
      await renderFileItem(viewer);

      viewer.setOptions({
        disableFileHeader: true,
        lineHoverHighlight: 'both',
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      const pre = getRenderedPre(viewer);
      const line = getLineElement(pre, 1);
      const number = getNumberElement(pre, 1);
      line.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );

      expect(line.hasAttribute('data-hovered')).toBe(true);
      expect(number.hasAttribute('data-hovered')).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables custom gutter utility setup for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot());
      await renderFileItem(viewer);

      viewer.setOptions({
        disableFileHeader: true,
        enableGutterUtility: true,
        renderGutterUtility: () => document.createElement('button'),
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      const pre = getRenderedPre(viewer);
      const number = getNumberElement(pre, 1);
      number.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );

      expect(number.querySelector('[data-gutter-utility-slot]')).not.toBeNull();
      expect(
        viewer
          .getRenderedItems()[0]
          .element.querySelector('[slot="gutter-utility-slot"]')
      ).not.toBeNull();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
