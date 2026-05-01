import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';

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
    Node: Reflect.get(globalThis, 'Node'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
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
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
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
      await wait(0);
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

      viewer.cleanUp();

      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
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

      viewer.setOptions({ pointerEventsOnScroll: true });

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
