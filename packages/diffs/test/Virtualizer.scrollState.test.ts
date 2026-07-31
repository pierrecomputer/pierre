import { describe, expect, test } from 'bun:test';

import { Virtualizer } from '../src/components/Virtualizer';
import { createRoot, installDom, wait } from './domHarness';

describe('Virtualizer scroll state', () => {
  test('reads and restores an element root logical scroll position', async () => {
    const dom = installDom();
    const root = createRoot();
    const content = document.createElement('div');
    root.appendChild(content);
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      value: 5_000,
    });
    root.scrollTop = 1_200;
    root.scrollLeft = 320;
    const scrollCalls: ScrollToOptions[] = [];
    root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      const top =
        typeof options === 'number'
          ? (y ?? root.scrollTop)
          : (options?.top ?? root.scrollTop);
      const left =
        typeof options === 'number'
          ? root.scrollLeft
          : (options?.left ?? root.scrollLeft);
      root.scrollTop = top;
      root.scrollLeft = left;
      scrollCalls.push({
        behavior: typeof options === 'number' ? undefined : options?.behavior,
        top,
        ...(typeof options !== 'number' && options?.left !== undefined
          ? { left }
          : {}),
      });
    };
    const virtualizer = new Virtualizer();

    try {
      virtualizer.setup(root, content);
      await wait(0);
      expect(virtualizer.getScrollTop()).toBe(1_200);
      expect(virtualizer.getScrollLeft()).toBe(320);

      virtualizer.scrollTo({ top: 2_500, left: 640, behavior: 'instant' });
      expect(virtualizer.getScrollTop()).toBe(2_500);
      expect(virtualizer.getScrollLeft()).toBe(640);
      expect(scrollCalls.at(-1)).toEqual({
        behavior: 'instant',
        left: 640,
        top: 2_500,
      });
      await wait(0);
      expect(virtualizer.getWindowSpecs().top).toBe(1_500);

      virtualizer.scrollTo({ top: 10_000 });
      expect(virtualizer.getScrollTop()).toBe(4_200);
      expect(scrollCalls.at(-1)).toEqual({ behavior: 'auto', top: 4_200 });
      virtualizer.scrollTo({ top: -100 });
      expect(virtualizer.getScrollTop()).toBe(0);
    } finally {
      virtualizer.cleanUp();
      dom.cleanup();
    }
  });

  test('reads and restores a document root logical scroll position', async () => {
    const dom = installDom();
    const originalInnerHeight = Object.getOwnPropertyDescriptor(
      globalThis,
      'innerHeight'
    );
    Object.defineProperty(globalThis, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5_000,
    });
    let scrollY = 1_200;
    Object.defineProperty(dom.window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    });
    let scrollX = 320;
    Object.defineProperty(dom.window, 'scrollX', {
      configurable: true,
      get: () => scrollX,
    });
    const scrollCalls: ScrollToOptions[] = [];
    dom.window.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
      const top =
        typeof options === 'number'
          ? (y ?? scrollY)
          : (options?.top ?? scrollY);
      const left =
        typeof options === 'number' ? scrollX : (options?.left ?? scrollX);
      scrollY = top;
      scrollX = left;
      scrollCalls.push({
        behavior: typeof options === 'number' ? undefined : options?.behavior,
        top,
        ...(typeof options !== 'number' && options?.left !== undefined
          ? { left }
          : {}),
      });
    };
    const virtualizer = new Virtualizer();

    try {
      virtualizer.setup(document);
      await wait(0);
      expect(virtualizer.getScrollTop()).toBe(1_200);
      expect(virtualizer.getScrollLeft()).toBe(320);

      virtualizer.scrollTo({ top: 2_500, left: 640, behavior: 'instant' });
      expect(virtualizer.getScrollTop()).toBe(2_500);
      expect(virtualizer.getScrollLeft()).toBe(640);
      expect(scrollCalls.at(-1)).toEqual({
        behavior: 'instant',
        left: 640,
        top: 2_500,
      });
      await wait(0);
      expect(virtualizer.getWindowSpecs().top).toBe(1_500);

      virtualizer.scrollTo({ top: 10_000 });
      expect(virtualizer.getScrollTop()).toBe(4_200);
      expect(scrollCalls.at(-1)).toEqual({ behavior: 'auto', top: 4_200 });
      virtualizer.scrollTo({ top: -100 });
      expect(virtualizer.getScrollTop()).toBe(0);
    } finally {
      virtualizer.cleanUp();
      if (originalInnerHeight === undefined) {
        Reflect.deleteProperty(globalThis, 'innerHeight');
      } else {
        Object.defineProperty(globalThis, 'innerHeight', originalInnerHeight);
      }
      dom.cleanup();
    }
  });
});
