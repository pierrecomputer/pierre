/** @jsxImportSource react */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const DISPLAY_PREFERENCES_STORAGE_KEY = 'diffshub.displayPreferences.v1';
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';
const PATCH_TEXT = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 export function example() {
-  return 1;
+  return 2;
 }
`;

const originalGlobals = {
  CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
  Image: Reflect.get(globalThis, 'Image'),
  cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
  customElements: Reflect.get(globalThis, 'customElements'),
  document: Reflect.get(globalThis, 'document'),
  fetch: Reflect.get(globalThis, 'fetch'),
  getComputedStyle: Reflect.get(globalThis, 'getComputedStyle'),
  HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
  HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
  HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
  HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
  HTMLTemplateElement: Reflect.get(globalThis, 'HTMLTemplateElement'),
  IntersectionObserver: Reflect.get(globalThis, 'IntersectionObserver'),
  IS_REACT_ACT_ENVIRONMENT: Reflect.get(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean },
    'IS_REACT_ACT_ENVIRONMENT'
  ),
  localStorage: Reflect.get(globalThis, 'localStorage'),
  matchMedia: Reflect.get(globalThis, 'matchMedia'),
  MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
  navigator: Reflect.get(globalThis, 'navigator'),
  requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
  ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
  ShadowRoot: Reflect.get(globalThis, 'ShadowRoot'),
  SVGElement: Reflect.get(globalThis, 'SVGElement'),
  window: Reflect.get(globalThis, 'window'),
};

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => {
  if ('type' in error && error.type === 'css parsing') {
    return;
  }

  console.error(error);
});

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost',
  virtualConsole,
});

let mobileMatches = false;
type MediaListener =
  | EventListenerOrEventListenerObject
  | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown);
let mediaListeners = new Map<
  MediaListener,
  (event: MediaQueryListEvent) => void
>();

class MockResizeObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

class MockIntersectionObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

class MockCSSStyleSheet {
  replaceSync(_cssText: string): void {}
}

beforeAll(() => {
  Object.assign(globalThis, {
    CSSStyleSheet: MockCSSStyleSheet,
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    customElements: dom.window.customElements,
    document: dom.window.document,
    fetch: fetchPatch,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    Image: dom.window.Image,
    IntersectionObserver: MockIntersectionObserver,
    localStorage: dom.window.localStorage,
    matchMedia,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    ResizeObserver: MockResizeObserver,
    ShadowRoot: dom.window.ShadowRoot,
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(dom.window, {
    CSSStyleSheet: MockCSSStyleSheet,
    IntersectionObserver: MockIntersectionObserver,
    matchMedia,
    ResizeObserver: MockResizeObserver,
  });
});

beforeEach(() => {
  mediaListeners = new Map();
  mobileMatches = false;
  localStorage.clear();
  document.body.textContent = '';
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.assign(globalThis, { [key]: value });
    }
  }
  dom.window.close();
});

describe('ReviewUI display preferences', () => {
  test('uses unified view on mobile without overwriting the stored desktop split preference', async () => {
    mobileMatches = true;
    writeStoredPreferences({
      collapseMode: 'expanded',
      diffIndicators: 'bars',
      diffStyle: 'split',
      lineNumbers: true,
      overflow: 'scroll',
      showBackgrounds: true,
    });

    const rendered = await renderReviewUI();

    try {
      await waitFor(() => {
        expect(
          querySelectorDeep(rendered.container, 'pre[data-diff]')?.getAttribute(
            'data-diff-type'
          )
        ).toBe('single');
      });
      expect(readStoredDiffStyle()).toBe('split');

      await act(async () => {
        setMobileMatches(false);
        await flushReact();
      });

      await waitFor(() => {
        expect(
          querySelectorDeep(rendered.container, 'pre[data-diff]')?.getAttribute(
            'data-diff-type'
          )
        ).toBe('split');
      });

      const toggle = await waitForElement<HTMLButtonElement>(
        rendered.container,
        'button[title="Switch to unified view"]'
      );
      await act(async () => {
        toggle.click();
        await flushReact();
      });

      await waitFor(() => {
        expect(readStoredDiffStyle()).toBe('unified');
      });
    } finally {
      await cleanup(rendered);
    }
  });

  test('uses stored collapsed mode for initially loaded diff items', async () => {
    writeStoredPreferences({
      collapseMode: 'collapsed',
      diffIndicators: 'bars',
      diffStyle: 'split',
      lineNumbers: true,
      overflow: 'scroll',
      showBackgrounds: true,
    });

    const rendered = await renderReviewUI();

    try {
      await waitFor(() => {
        expect(
          rendered.container.querySelector('button[aria-label="Expand diff"]')
        ).not.toBeNull();
      });
    } finally {
      await cleanup(rendered);
    }
  });
});

interface StoredPreferences {
  collapseMode: 'expanded' | 'collapsed';
  diffIndicators: 'bars' | 'classic' | 'none';
  diffStyle: 'split' | 'unified';
  lineNumbers: boolean;
  overflow: 'wrap' | 'scroll';
  showBackgrounds: boolean;
}

interface RenderedReviewUI {
  container: HTMLDivElement;
  root: Root;
}

async function renderReviewUI(): Promise<RenderedReviewUI> {
  const container = document.createElement('div');
  document.body.append(container);
  const { ReviewUI } = await import('../../components/ReviewUI');
  let root: Root | undefined;

  await act(async () => {
    root = createRoot(container);
    root.render(
      <AppRouterContext.Provider value={testRouter}>
        <ReviewUI
          initialUrl="https://github.com/pierrecomputer/pierre/pull/1"
          path="pierrecomputer/pierre/pull/1"
        />
      </AppRouterContext.Provider>
    );
    await flushReact();
  });

  if (root == null) {
    throw new Error('ReviewUI root was not created');
  }
  return { container, root };
}

async function cleanup({ container, root }: RenderedReviewUI): Promise<void> {
  await act(async () => {
    root.unmount();
    await flushReact();
  });
  container.remove();
}

function writeStoredPreferences(preferences: StoredPreferences): void {
  localStorage.setItem(
    DISPLAY_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ preferences, version: 1 })
  );
}

function readStoredDiffStyle(): string | undefined {
  const rawValue = localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY);
  if (rawValue == null) {
    return undefined;
  }

  return (
    JSON.parse(rawValue) as {
      preferences?: { diffStyle?: string };
    }
  ).preferences?.diffStyle;
}

function fetchPatch(): Promise<Response> {
  return Promise.resolve({
    body: null,
    ok: true,
    text: () => Promise.resolve(PATCH_TEXT),
  } as Response);
}

const testRouter: AppRouterInstance = {
  back() {},
  forward() {},
  prefetch() {},
  push() {},
  refresh() {},
  replace() {},
};

function matchMedia(query: string): MediaQueryList {
  const matches = query === MOBILE_MEDIA_QUERY ? mobileMatches : false;
  let mediaQueryList: MediaQueryList;

  mediaQueryList = {
    addEventListener(
      _type: 'change',
      listener: EventListenerOrEventListenerObject | null
    ) {
      if (listener == null) {
        return;
      }
      mediaListeners.set(listener, (event) => {
        if (typeof listener === 'function') {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      });
    },
    addListener(
      listener:
        | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown)
        | null
    ) {
      if (listener == null) {
        return;
      }
      mediaListeners.set(listener, (event) => {
        listener.call(mediaQueryList, event);
      });
    },
    dispatchEvent() {
      return true;
    },
    matches,
    media: query,
    onchange: null,
    removeEventListener(
      _type: 'change',
      listener: EventListenerOrEventListenerObject | null
    ) {
      if (listener != null) {
        mediaListeners.delete(listener);
      }
    },
    removeListener(
      listener:
        | ((this: MediaQueryList, event: MediaQueryListEvent) => unknown)
        | null
    ) {
      if (listener != null) {
        mediaListeners.delete(listener);
      }
    },
  } as MediaQueryList;

  return mediaQueryList;
}

function setMobileMatches(matches: boolean): void {
  mobileMatches = matches;
  const event = { matches, media: MOBILE_MEDIA_QUERY } as MediaQueryListEvent;
  for (const listener of mediaListeners.values()) {
    listener(event);
  }
}

async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 2_000) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await flushReact();
    });
  }

  throw lastError;
}

async function waitForElement<ElementType extends Element>(
  container: ParentNode,
  selector: string
): Promise<ElementType> {
  let element: ElementType | null = null;
  await waitFor(() => {
    element = container.querySelector<ElementType>(selector);
    expect(element).not.toBeNull();
  });
  if (element == null) {
    throw new Error(`Expected to find element matching ${selector}`);
  }
  return element;
}

function querySelectorDeep<ElementType extends Element>(
  root: ParentNode,
  selector: string
): ElementType | null {
  const directMatch = root.querySelector<ElementType>(selector);
  if (directMatch != null) {
    return directMatch;
  }

  for (const element of root.querySelectorAll('*')) {
    const shadowMatch =
      element.shadowRoot == null
        ? null
        : querySelectorDeep<ElementType>(element.shadowRoot, selector);
    if (shadowMatch != null) {
      return shadowMatch;
    }
  }

  return null;
}

async function flushReact(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
