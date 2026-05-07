import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { JSDOM } from 'jsdom';
import type { App, Component, VNodeChild } from 'vue';

let createApp: typeof import('vue').createApp;
let createSSRApp: typeof import('vue').createSSRApp;
let defineComponent: typeof import('vue').defineComponent;
let h: typeof import('vue').h;
let nextTick: typeof import('vue').nextTick;
let renderToString: typeof import('@vue/server-renderer').renderToString;
let FileTreeVue: typeof import('../src/vue').FileTree;
let useFileTree: typeof import('../src/vue').useFileTree;
let useFileTreeSearch: typeof import('../src/vue').useFileTreeSearch;
let useFileTreeSelection: typeof import('../src/vue').useFileTreeSelection;
let FileTreeClass: typeof import('../src/render/FileTree').FileTree;
let preloadFileTree: typeof import('../src/render/FileTree').preloadFileTree;

const TAG = 'file-tree-container';
const originalGlobals = {
  CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
  customElements: Reflect.get(globalThis, 'customElements'),
  document: Reflect.get(globalThis, 'document'),
  Event: Reflect.get(globalThis, 'Event'),
  Element: Reflect.get(globalThis, 'Element'),
  HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
  HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
  HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
  HTMLInputElement: Reflect.get(globalThis, 'HTMLInputElement'),
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

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost',
});

class MockCSSStyleSheet {
  replaceSync(_value: string): void {}
}

class MockResizeObserver {
  observe(_target: Element): void {}
  disconnect(): void {}
}

beforeAll(async () => {
  Object.assign(globalThis, {
    CSSStyleSheet: MockCSSStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    Event: dom.window.Event,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLInputElement: dom.window.HTMLInputElement,
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

  class FileTreeContainerElement extends dom.window.HTMLElement {
    constructor() {
      super();
      if (this.shadowRoot == null) {
        this.attachShadow({ mode: 'open' });
      }
    }
  }

  if (dom.window.customElements.get(TAG) == null) {
    dom.window.customElements.define(TAG, FileTreeContainerElement);
  }

  ({ createApp, createSSRApp, defineComponent, h, nextTick } =
    await import('vue'));
  ({ renderToString } = await import('@vue/server-renderer'));
  ({
    FileTree: FileTreeVue,
    useFileTree,
    useFileTreeSearch,
    useFileTreeSelection,
  } = await import('../src/vue'));
  ({ FileTree: FileTreeClass, preloadFileTree } =
    await import('../src/render/FileTree'));
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
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

async function flushDom(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function dispatchClick(target: Element): void {
  target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

async function mountComponent(
  component: Component,
  container: HTMLElement
): Promise<App<Element>> {
  const app = createApp(component);
  app.mount(container);
  await flushDom();
  return app;
}

function getHost(container: HTMLElement): HTMLElement {
  const host = container.querySelector(TAG);
  if (!(host instanceof dom.window.HTMLElement)) {
    throw new Error('expected rendered file-tree host');
  }

  return host;
}

function getItemButton(host: HTMLElement, path: string): HTMLButtonElement {
  const button = host.shadowRoot?.querySelector(`[data-item-path="${path}"]`);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`expected item button for ${path}`);
  }

  return button;
}

const BASE_OPTIONS = {
  flattenEmptyDirectories: true,
  initialExpansion: 'open' as const,
  paths: ['README.md', 'src/index.ts'],
  initialVisibleRowCount: 120 / 30,
};

describe('file-tree Vue lane', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  test('renders a model-first tree and applies model mutations from Vue event handlers', async () => {
    const model = new FileTreeClass(BASE_OPTIONS);
    const component = defineComponent({
      render(): VNodeChild {
        return h('div', [
          h(
            'button',
            {
              'data-test-add': '',
              onClick: () => {
                model.add('src/utils.ts');
              },
              type: 'button',
            },
            'Add path'
          ),
          h(FileTreeVue, { model }),
        ]);
      },
    });

    const app = await mountComponent(component, container);
    try {
      const host = getHost(container);
      expect(getItemButton(host, 'README.md')).not.toBeNull();
      expect(
        host.shadowRoot?.querySelector('[data-item-path="src/utils.ts"]')
      ).toBeNull();

      const addButton = container.querySelector('[data-test-add]');
      if (!(addButton instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected add button');
      }

      dispatchClick(addButton);
      await flushDom();

      expect(getItemButton(host, 'src/utils.ts')).not.toBeNull();
    } finally {
      app.unmount();
      model.cleanUp();
    }
  });

  test('useFileTree cleans up the owned model when its component unmounts', async () => {
    let capturedModel: InstanceType<typeof FileTreeClass> | null = null;
    const component = defineComponent({
      setup() {
        const { model } = useFileTree(BASE_OPTIONS);
        capturedModel = model;
        return { model };
      },
      render(): VNodeChild {
        return h(FileTreeVue, { model: this.model });
      },
    });
    const app = await mountComponent(component, container);

    if (capturedModel == null) {
      throw new Error('expected model from useFileTree');
    }

    const cleanUpSpy = spyOn(capturedModel, 'cleanUp');
    app.unmount();
    await flushDom();
    expect(cleanUpSpy).toHaveBeenCalledTimes(1);
    cleanUpSpy.mockRestore();
  });

  test('restores a model header composition after a Vue slot override unmounts', async () => {
    const model = new FileTreeClass({
      ...BASE_OPTIONS,
      composition: {
        header: {
          html: '<button data-test-model-header="true">Model header</button>',
        },
      },
    });
    const component = defineComponent({
      render(): VNodeChild {
        return h(
          FileTreeVue,
          { model },
          {
            header: () =>
              h('button', { 'data-test-vue-header': '' }, 'Vue header'),
          }
        );
      },
    });

    const app = await mountComponent(component, container);
    try {
      const firstHost = getHost(container);
      expect(
        firstHost.querySelector('[data-test-vue-header]')?.textContent
      ).toBe('Vue header');
      expect(
        firstHost.querySelector('[data-test-model-header="true"]')
      ).toBeNull();

      app.unmount();
      const secondContainer = document.createElement('div');
      document.body.appendChild(secondContainer);
      try {
        model.render({ containerWrapper: secondContainer });
        await flushDom();
        const secondHost = getHost(secondContainer);
        expect(
          secondHost.querySelector('[data-test-model-header="true"]')
            ?.textContent
        ).toBe('Model header');
      } finally {
        secondContainer.remove();
      }
    } finally {
      model.cleanUp();
    }
  });

  test('renders the context-menu scoped slot from model open events', async () => {
    const model = new FileTreeClass({
      ...BASE_OPTIONS,
      composition: {
        contextMenu: {
          buttonVisibility: 'always',
          enabled: true,
          triggerMode: 'button',
        },
      },
    });
    const component = defineComponent({
      render(): VNodeChild {
        return h(
          FileTreeVue,
          { model },
          {
            'context-menu': ({
              item,
            }: {
              item: import('../src').ContextMenuItem;
            }) =>
              h(
                'div',
                { 'data-test-vue-context-menu': '' },
                `Menu for ${item.path}`
              ),
          }
        );
      },
    });

    const app = await mountComponent(component, container);
    try {
      const host = getHost(container);
      const anchorElement = getItemButton(host, 'README.md');
      model.getComposition()?.contextMenu?.onOpen?.(
        { kind: 'file', name: 'README.md', path: 'README.md' },
        {
          anchorElement,
          anchorRect: {
            bottom: 10,
            height: 10,
            left: 0,
            right: 10,
            top: 0,
            width: 10,
            x: 0,
            y: 0,
          },
          close: () => {},
          restoreFocus: () => {},
        }
      );
      await flushDom();

      expect(
        host.querySelector('[data-test-vue-context-menu]')?.textContent
      ).toBe('Menu for README.md');
    } finally {
      app.unmount();
      model.cleanUp();
    }
  });

  test('selection and search composables rerender from model updates', async () => {
    const model = new FileTreeClass({ ...BASE_OPTIONS, search: true });
    const component = defineComponent({
      setup() {
        const selectedPaths = useFileTreeSelection(model);
        const search = useFileTreeSearch(model);
        return { search, selectedPaths };
      },
      render(): VNodeChild {
        return h('div', [
          h(
            'button',
            {
              'data-test-select': '',
              onClick: () => {
                model.getItem('README.md')?.select();
              },
              type: 'button',
            },
            'Select README'
          ),
          h(
            'button',
            {
              'data-test-search': '',
              onClick: () => {
                this.search.open('read');
              },
              type: 'button',
            },
            'Search read'
          ),
          h(
            'output',
            { 'data-test-selected-count': '' },
            String(this.selectedPaths.length)
          ),
          h(
            'output',
            { 'data-test-search-open': '' },
            String(this.search.isOpen.value)
          ),
          h(
            'output',
            { 'data-test-search-value': '' },
            this.search.value.value
          ),
          h(
            'output',
            { 'data-test-search-count': '' },
            String(this.search.matchingPaths.value.length)
          ),
          h(FileTreeVue, { model }),
        ]);
      },
    });

    const app = await mountComponent(component, container);
    try {
      expect(
        container.querySelector('[data-test-selected-count]')?.textContent
      ).toBe('0');
      expect(
        container.querySelector('[data-test-search-open]')?.textContent
      ).toBe('false');
      expect(
        container.querySelector('[data-test-search-value]')?.textContent
      ).toBe('');
      expect(
        container.querySelector('[data-test-search-count]')?.textContent
      ).toBe('0');

      const selectButton = container.querySelector('[data-test-select]');
      const searchButton = container.querySelector('[data-test-search]');
      if (
        !(selectButton instanceof dom.window.HTMLButtonElement) ||
        !(searchButton instanceof dom.window.HTMLButtonElement)
      ) {
        throw new Error('expected composable harness buttons');
      }

      dispatchClick(selectButton);
      await flushDom();
      expect(
        container.querySelector('[data-test-selected-count]')?.textContent
      ).toBe('1');

      dispatchClick(searchButton);
      await flushDom();
      expect(
        container.querySelector('[data-test-search-open]')?.textContent
      ).toBe('true');
      expect(
        container.querySelector('[data-test-search-value]')?.textContent
      ).toBe('read');
      expect(
        container.querySelector('[data-test-search-count]')?.textContent
      ).toBe('1');
    } finally {
      app.unmount();
      model.cleanUp();
    }
  });

  test('hydrates colocated preloadedData and preserves live header interactions', async () => {
    const preloadedData = preloadFileTree({
      ...BASE_OPTIONS,
      id: 'pst-vue-ssr-test',
    });
    const originalDocument = Reflect.get(globalThis, 'document');
    const originalWindow = Reflect.get(globalThis, 'window');
    const hydrationWarnings: string[] = [];
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    function createHarness() {
      const model = new FileTreeClass(BASE_OPTIONS);
      return defineComponent({
        data() {
          return { count: 0, model };
        },
        beforeUnmount() {
          model.cleanUp();
        },
        render(): VNodeChild {
          return h(
            FileTreeVue,
            { model, preloadedData },
            {
              header: () =>
                h(
                  'button',
                  {
                    'data-test-ssr-header': '',
                    onClick: () => {
                      this.count += 1;
                    },
                    type: 'button',
                  },
                  `Header action ${String(this.count)}`
                ),
            }
          );
        },
      });
    }

    try {
      Reflect.deleteProperty(globalThis, 'document');
      Reflect.deleteProperty(globalThis, 'window');
      const serverHtml = await renderToString(createSSRApp(createHarness()));
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
      });

      expect(serverHtml).toContain('template shadowrootmode="open"');
      expect(serverHtml).toContain('data-allow-mismatch="children"');
      expect(serverHtml).toContain('data-test-ssr-header');

      container.innerHTML = serverHtml;
      console.error = (...args: unknown[]) => {
        hydrationWarnings.push(args.map((value) => String(value)).join(' '));
      };
      console.warn = (...args: unknown[]) => {
        hydrationWarnings.push(args.map((value) => String(value)).join(' '));
      };

      const app = createSSRApp(createHarness());
      app.mount(container);
      await flushDom();

      expect(
        hydrationWarnings.some((message) =>
          message.toLowerCase().includes('hydration')
        )
      ).toBe(false);

      const host = getHost(container);
      expect(host.querySelectorAll('[slot="header"]')).toHaveLength(1);
      expect(host.querySelector('template[shadowrootmode="open"]')).toBeNull();
      const headerNode = host.querySelector('[data-test-ssr-header]');
      if (!(headerNode instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected hydrated header button');
      }

      expect(headerNode.textContent).toBe('Header action 0');
      dispatchClick(headerNode);
      await flushDom();
      expect(headerNode.textContent).toBe('Header action 1');
      expect(host.querySelector('template[shadowrootmode="open"]')).toBeNull();

      app.unmount();
    } finally {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
      });
    }
  });
});
