import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView, type CodeViewCoordinator } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';

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

function createRoot(height: number): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    root.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: height,
      height,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
}

function makeFile(
  name: string,
  label: string,
  lineCount: number
): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `${label} line ${index + 1}`
    ).join('\n'),
  };
}

function makeFileItem(
  id: string,
  label: string,
  lineCount: number
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, label, lineCount),
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

function getShadowText(element: HTMLElement): string {
  return element.shadowRoot?.textContent ?? '';
}

function getShellCounts(element: HTMLElement): {
  pre: number;
  svg: number;
  theme: number;
  unsafe: number;
} {
  const { shadowRoot } = element;
  expect(shadowRoot).not.toBeNull();
  return {
    pre: shadowRoot?.querySelectorAll('pre').length ?? 0,
    svg: shadowRoot?.querySelectorAll('svg[data-icon-sprite]').length ?? 0,
    theme: shadowRoot?.querySelectorAll('style[data-theme-css]').length ?? 0,
    unsafe: shadowRoot?.querySelectorAll('style[data-unsafe-css]').length ?? 0,
  };
}

async function waitForShellCounts(
  element: HTMLElement,
  expected: ReturnType<typeof getShellCounts>
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      expect(getShellCounts(element)).toEqual(expected);
      return;
    } catch {
      await wait(10);
    }
  }
  expect(getShellCounts(element)).toEqual(expected);
}

describe('CodeView element pooling', () => {
  test('reuses sanitized item shells without duplicating shared assets', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      unsafeCSS: ':host { --pooled-shell: 1; }',
    });
    const root = createRoot(120);
    const items = [
      makeFileItem('file:first', 'first pooled content', 100),
      makeFileItem('file:second', 'second pooled content', 100),
    ];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      let renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:first']);
      const firstElement = renderedItems[0].element;
      await waitForShellCounts(firstElement, {
        pre: 1,
        svg: 1,
        theme: 1,
        unsafe: 1,
      });
      expect(getShadowText(firstElement)).toContain('first pooled content');

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:second']);
      const secondElement = renderedItems[0].element;
      expect(secondElement).toBe(firstElement);
      await waitForShellCounts(secondElement, {
        pre: 1,
        svg: 1,
        theme: 1,
        unsafe: 1,
      });
      expect(getShadowText(secondElement)).toContain('second pooled content');
      expect(getShadowText(secondElement)).not.toContain(
        'first pooled content'
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('clears pooled shells when shared css options change', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      themeType: 'light',
    });

    try {
      viewer.setup(createRoot(1000));
      await renderItems(viewer, [
        makeFileItem('file:first', 'first content', 5),
        makeFileItem('file:second', 'second content', 5),
      ]);

      const pooledCandidates = viewer
        .getRenderedItems()
        .map((item) => item.element);
      expect(pooledCandidates).toHaveLength(2);

      viewer.setItems([]);
      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'dark',
      });
      await renderItems(viewer, [
        makeFileItem('file:third', 'third content', 5),
      ]);

      const nextElement = viewer.getRenderedItems()[0]?.element;
      expect(nextElement).toBeDefined();
      expect(pooledCandidates).not.toContain(nextElement);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('waits for managed slot children to clear before reusing a shell', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ disableFileHeader: true }, undefined, true);
    const root = createRoot(120);
    const coordinator: CodeViewCoordinator<undefined> = {
      hasAnnotationRenderer: false,
      hasGutterRenderer: false,
      hasHeaderRenderers: true,
      onSnapshotChange() {},
    };

    try {
      viewer.setSlotCoordinator(coordinator);
      viewer.setup(root);
      await renderItems(viewer, [
        makeFileItem('file:first', 'first managed content', 100),
        makeFileItem('file:second', 'second managed content', 100),
      ]);

      const firstItem = viewer.getRenderedItems()[0];
      expect(firstItem?.id).toBe('file:first');
      const firstElement = firstItem.element;
      firstElement.appendChild(document.createElement('div'));

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const secondItem = viewer.getRenderedItems()[0];
      expect(secondItem?.id).toBe('file:second');
      expect(secondItem.element).not.toBe(firstElement);

      firstElement.replaceChildren();
      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remountedFirstItem = viewer.getRenderedItems()[0];
      expect(remountedFirstItem?.id).toBe('file:first');
      expect(remountedFirstItem.element).toBe(firstElement);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
