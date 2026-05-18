import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';

function installDom({
  maxTouchPoints = 0,
  platform = 'MacIntel',
  userAgent,
}: {
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
} = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator'
  );
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    Node: Reflect.get(globalThis, 'Node'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    window: Reflect.get(globalThis, 'window'),
  };

  const navigator = Object.create(dom.window.navigator) as Navigator;
  Object.defineProperties(navigator, {
    maxTouchPoints: {
      configurable: true,
      value: maxTouchPoints,
    },
    platform: {
      configurable: true,
      value: platform,
    },
    userAgent: {
      configurable: true,
      value: userAgent ?? dom.window.navigator.userAgent,
    },
  });

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
    window: dom.window,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: navigator,
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
      if (originalNavigatorDescriptor == null) {
        Reflect.deleteProperty(globalThis, 'navigator');
      } else {
        Object.defineProperty(
          globalThis,
          'navigator',
          originalNavigatorDescriptor
        );
      }
      dom.window.close();
    },
  };
}

function getPointerEventsTarget(root: HTMLElement): HTMLDivElement {
  const container = root.firstElementChild;
  if (!(container instanceof HTMLDivElement)) {
    throw new Error('missing CodeView content container');
  }
  const stickyContainer = container.lastElementChild;
  if (!(stickyContainer instanceof HTMLDivElement)) {
    throw new Error('missing CodeView sticky container');
  }
  return stickyContainer;
}

function getCodeOverflowBlock(target: HTMLElement): string {
  return target.style.getPropertyValue('--diffs-overflow-override');
}

function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CodeView pointer events while scrolling', () => {
  test('disables pointer events by default during scroll and restores after delay', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('keeps pointer events enabled when opted out', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      pointerEventsOnScroll: true,
    });
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleanUp restores pointer events and cancels pending restore work', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);
      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');

      viewer.cleanUp();

      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleanUp unsets the root overflow anchor style', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      root.style.overflowAnchor = 'auto';

      viewer.setup(root);
      expect(root.style.overflowAnchor).toBe('none');

      viewer.cleanUp();

      expect(root.style.overflowAnchor).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('setOptions preserves the pending pointer events restore timer', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);
      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');

      viewer.setOptions({ pointerEventsOnScroll: true });

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('applies overflow override while scrolling on mobile Safari only', async () => {
    const { cleanup } = installDom({
      maxTouchPoints: 5,
      platform: 'iPhone',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    const modulePath = '../src/components/CodeView.ts?mobile-safari-test';
    const { CodeView: MobileSafariCodeView } = await import(modulePath);
    const viewer = new MobileSafariCodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('hidden');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('auto');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
