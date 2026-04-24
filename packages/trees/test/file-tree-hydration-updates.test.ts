import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    HTMLTemplateElement: Reflect.get(globalThis, 'HTMLTemplateElement'),
    MutationObserver: Reflect.get(globalThis, 'MutationObserver'),
    navigator: Reflect.get(globalThis, 'navigator'),
    Node: Reflect.get(globalThis, 'Node'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    ShadowRoot: Reflect.get(globalThis, 'ShadowRoot'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockStyleSheet {
    replaceSync(_value: string): void {}
  }

  class MockResizeObserver {
    observe(_target: Element): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    CSSStyleSheet: MockStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
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
      for (const [key, value] of Object.entries(originalValues)) {
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

async function flushDom(times: number = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('file-tree hydration updates', () => {
  test('hydrated trees rerender visible rows after an external expand mutation', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree, preloadFileTree, serializeFileTreeSsrPayload } =
        await import('../src/render/FileTree');
      const payload = preloadFileTree({
        flattenEmptyDirectories: false,
        id: 'hydration-update-test',
        initialVisibleRowCount: 8,
        paths: ['art/a.ts', 'art/b.ts', 'src/index.ts'],
      });

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        id: payload.id,
        initialVisibleRowCount: 8,
        paths: ['art/a.ts', 'art/b.ts', 'src/index.ts'],
      });
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        shadowRoot?.querySelector('[data-item-path="art/a.ts"]')
      ).toBeNull();

      const artItem = fileTree.getItem('art/');
      if (artItem == null || !artItem.isDirectory()) {
        throw new Error('expected art/ directory handle');
      }
      if (!('expand' in artItem)) {
        throw new Error('expected expand method');
      }
      artItem.expand();
      await flushDom();

      expect(
        shadowRoot?.querySelector('[data-item-path="art/a.ts"]')
      ).not.toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-path="art/b.ts"]')
      ).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
