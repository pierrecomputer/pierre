import { JSDOM } from 'jsdom';

import type { CodeView } from '../src/components/CodeView';
import type { CodeViewItem, FileContents } from '../src/types';

export interface InstallDomNavigatorOptions {
  maxTouchPoints?: number;
  platform?: string;
  userAgent?: string;
}

export interface InstallDomOptions {
  /**
   * Overrides applied to the jsdom navigator clone. Used by mobile-Safari
   * detection tests; note that CodeView's MOBILE_SAFARI constant is evaluated
   * once at module load, so tests that need it re-evaluated must re-import the
   * module with a cache-busting query (see CodeView.pointerEvents.test.ts).
   */
  navigator?: InstallDomNavigatorOptions;
}

export interface DomHandle {
  window: JSDOM['window'];
  cleanup(): void;
  /**
   * Registers the element that document.elementFromPoint(x, y) returns for an
   * exact coordinate pair. jsdom performs no layout, so hit-testing tests
   * (e.g. gutter drag selection) must declare their targets explicitly.
   */
  setElementFromPoint(x: number, y: number, element: Element): void;
}

// Installs a jsdom-backed DOM environment on globalThis for component tests.
// Always installs the same superset of globals: per-file subsets drifted apart
// in the past and caused harness bugs, while unused extras are harmless. The
// returned cleanup() restores (or deletes) every global it touched.
export function installDom(options: InstallDomOptions = {}): DomHandle {
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
    DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
    Element: Reflect.get(globalThis, 'Element'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLCanvasElement: Reflect.get(globalThis, 'HTMLCanvasElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    getComputedStyle: Reflect.get(globalThis, 'getComputedStyle'),
    matchMedia: Reflect.get(globalThis, 'matchMedia'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    SVGSVGElement: Reflect.get(globalThis, 'SVGSVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  // jsdom does not implement PointerEvent; tests dispatch this MouseEvent
  // subclass instead, carrying the pointer fields InteractionManager reads.
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

  const matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener(): void {},
    removeEventListener(): void {},
    addListener(): void {},
    removeListener(): void {},
    dispatchEvent(): boolean {
      return true;
    },
  })) as typeof window.matchMedia;

  const {
    maxTouchPoints = 0,
    platform = 'MacIntel',
    userAgent,
  } = options.navigator ?? {};
  // Bun defines globalThis.navigator as a non-writable accessor, so the
  // override has to go through defineProperty and be restored from the saved
  // property descriptor rather than plain assignment.
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

  // Bun has no requestAnimationFrame; back frames with setTimeout so renders
  // scheduled via rAF run on the macrotask queue and wait(0) can flush them.
  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();

  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: (contextId: string) => {
      if (contextId !== '2d') {
        return null;
      }
      return {
        font: '',
        measureText: (text: string) => ({ width: text.length * 8 }),
      };
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });

  const pointTargets = new Map<string, Element>();
  Object.defineProperty(dom.window.document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number): Element | null =>
      pointTargets.get(`${x},${y}`) ?? null,
  });

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
    Event: dom.window.Event,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLCanvasElement: dom.window.HTMLCanvasElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    matchMedia,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
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
    SVGSVGElement: dom.window.SVGSVGElement,
    window: dom.window,
  });
  Object.assign(dom.window, { matchMedia, PointerEvent: MockPointerEvent });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: navigator,
  });

  return {
    window: dom.window,
    setElementFromPoint(x: number, y: number, element: Element): void {
      pointTargets.set(`${x},${y}`, element);
    },
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

export interface CreateRootOptions {
  width?: number;
  height?: number;
}

// Creates a scroll-container div with a stubbed scrollTo and a fixed
// bounding rect, since jsdom performs no layout. Appends it to document.body.
export function createRoot(options: CreateRootOptions = {}): HTMLDivElement {
  const { width = 1000, height = 800 } = options;
  const root = document.createElement('div');
  root.scrollTo = (scrollOptions?: ScrollToOptions | number, y?: number) => {
    root.scrollTop =
      typeof scrollOptions === 'number'
        ? (y ?? 0)
        : (scrollOptions?.top ?? root.scrollTop);
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
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

export function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
}

export function makeFile(name: string, lineCount = 20): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `line ${index + 1}`
    ).join('\n'),
  };
}

export function makeFileItem(
  id: string,
  lineCount = 20
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, lineCount),
  };
}

// Pushes items into the viewer and flushes the rAF-scheduled render pass.
export async function renderItems(
  viewer: CodeView,
  items: readonly CodeViewItem[]
): Promise<void> {
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
}
