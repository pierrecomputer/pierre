import { JSDOM } from 'jsdom';

const DOM_GLOBAL_KEYS = [
  'CSS',
  'CSSStyleSheet',
  'customElements',
  'document',
  'Event',
  'FocusEvent',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLDivElement',
  'HTMLInputElement',
  'HTMLStyleElement',
  'HTMLTemplateElement',
  'KeyboardEvent',
  'MouseEvent',
  'MutationObserver',
  'navigator',
  'Node',
  'ResizeObserver',
  'SVGElement',
  'ShadowRoot',
  'window',
] as const;

type DomGlobalKey = (typeof DOM_GLOBAL_KEYS)[number];

type DomGlobalSnapshot = Record<DomGlobalKey, unknown>;

export interface InstalledDom {
  cleanup: () => void;
  dom: JSDOM;
}

class MockStyleSheet {
  replaceSync(_value: string): void {}
}

class MockResizeObserver {
  observe(_target: Element): void {}
  disconnect(): void {}
}

// Installs the browser globals that the vanilla tree renderer touches, then
// restores the previous process state when the test calls cleanup().
export function installDom(): InstalledDom {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = Object.fromEntries(
    DOM_GLOBAL_KEYS.map((key) => [key, Reflect.get(globalThis, key)])
  ) as DomGlobalSnapshot;

  Object.assign(globalThis, {
    CSS: Reflect.get(dom.window, 'CSS'),
    CSSStyleSheet: MockStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    FocusEvent: dom.window.FocusEvent,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    ShadowRoot: dom.window.ShadowRoot,
    window: dom.window,
  });

  return {
    cleanup() {
      for (const key of DOM_GLOBAL_KEYS) {
        const value = originalValues[key];
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
    dom,
  };
}

export async function flushDom(times: number = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
