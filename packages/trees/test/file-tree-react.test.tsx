/** @jsxImportSource react */

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
import { act, useState } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

let FileTreeReact: typeof import('../src/react').FileTree;
let FileTreeClass: typeof import('../src/render/FileTree').FileTree;
let preloadFileTree: typeof import('../src/render/FileTree').preloadFileTree;
let useFileTree: typeof import('../src/react').useFileTree;
let useFileTreeSearch: typeof import('../src/react').useFileTreeSearch;
let useFileTreeSelection: typeof import('../src/react').useFileTreeSelection;

const TAG = 'file-tree-container';
const originalGlobals = {
  CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
  customElements: Reflect.get(globalThis, 'customElements'),
  document: Reflect.get(globalThis, 'document'),
  Event: Reflect.get(globalThis, 'Event'),
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
  IS_REACT_ACT_ENVIRONMENT: Reflect.get(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean },
    'IS_REACT_ACT_ENVIRONMENT'
  ),
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

  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  ({
    FileTree: FileTreeReact,
    useFileTree,
    useFileTreeSearch,
    useFileTreeSelection,
  } = await import('../src/react'));
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
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function dispatchClick(target: Element): void {
  target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

async function actAndFlush(callback: () => void): Promise<void> {
  await act(async () => {
    callback();
    await flushDom();
  });
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
  viewportHeight: 120,
};

describe('file-tree React lane', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test('renders a model-first tree and applies model mutations from React event handlers', async () => {
    function Harness() {
      const { model } = useFileTree(BASE_OPTIONS);

      return (
        <>
          <button
            data-test-add
            onClick={() => {
              model.add('src/utils.ts');
            }}
            type="button"
          >
            Add path
          </button>
          <FileTreeReact model={model} />
        </>
      );
    }

    await actAndFlush(() => {
      root.render(<Harness />);
    });

    const host = getHost(container);
    expect(getItemButton(host, 'README.md')).not.toBeNull();
    expect(
      host.shadowRoot?.querySelector('[data-item-path="src/utils.ts"]')
    ).toBeNull();

    const addButtonNode = container.querySelector('[data-test-add]');
    if (!(addButtonNode instanceof dom.window.HTMLButtonElement)) {
      throw new Error('expected add button');
    }

    const addButton = addButtonNode;

    await actAndFlush(() => {
      dispatchClick(addButton);
    });

    expect(getItemButton(host, 'src/utils.ts')).not.toBeNull();
  });

  test('useFileTree cleans up the model when its owner unmounts', async () => {
    let capturedModel: { cleanUp(): void } | null = null;
    const localContainer = document.createElement('div');
    document.body.appendChild(localContainer);
    const localRoot = createRoot(localContainer);

    function Harness() {
      const { model } = useFileTree(BASE_OPTIONS);
      capturedModel = model;
      return <FileTreeReact model={model} />;
    }

    try {
      await act(async () => {
        localRoot.render(<Harness />);
        await flushDom();
      });

      if (capturedModel == null) {
        throw new Error('expected model from useFileTree');
      }

      const cleanUpSpy = spyOn(capturedModel, 'cleanUp');
      act(() => {
        localRoot.unmount();
      });
      expect(cleanUpSpy).toHaveBeenCalledTimes(1);
      cleanUpSpy.mockRestore();
    } finally {
      localContainer.remove();
    }
  });

  test('can remount the same model instance after unmount', async () => {
    const model = new FileTreeClass(BASE_OPTIONS);
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.append(firstContainer, secondContainer);
    const firstRoot = createRoot(firstContainer);
    const secondRoot = createRoot(secondContainer);

    try {
      await act(async () => {
        firstRoot.render(<FileTreeReact model={model} />);
        await flushDom();
      });
      expect(
        getItemButton(getHost(firstContainer), 'README.md')
      ).not.toBeNull();

      act(() => {
        firstRoot.unmount();
      });

      await act(async () => {
        secondRoot.render(<FileTreeReact model={model} />);
        await flushDom();
      });
      expect(
        getItemButton(getHost(secondContainer), 'README.md')
      ).not.toBeNull();
    } finally {
      act(() => {
        secondRoot.unmount();
      });
      model.cleanUp();
      firstContainer.remove();
      secondContainer.remove();
    }
  });

  test('preserves a model header composition when the wrapper does not override it', async () => {
    const model = new FileTreeClass({
      ...BASE_OPTIONS,
      composition: {
        header: {
          html: '<button data-test-model-header="true">Model header</button>',
        },
      },
    });

    const localContainer = document.createElement('div');
    document.body.appendChild(localContainer);
    const localRoot = createRoot(localContainer);

    try {
      await act(async () => {
        localRoot.render(<FileTreeReact model={model} />);
        await flushDom();
      });

      const host = getHost(localContainer);
      expect(
        host.querySelector('[data-test-model-header="true"]')?.textContent
      ).toBe('Model header');
    } finally {
      act(() => {
        localRoot.unmount();
      });
      model.cleanUp();
      localContainer.remove();
    }
  });

  test('restores a model header composition after a wrapper override unmounts', async () => {
    const model = new FileTreeClass({
      ...BASE_OPTIONS,
      composition: {
        header: {
          html: '<button data-test-model-header="true">Model header</button>',
        },
      },
    });
    const firstContainer = document.createElement('div');
    const secondContainer = document.createElement('div');
    document.body.append(firstContainer, secondContainer);
    const firstRoot = createRoot(firstContainer);
    const secondRoot = createRoot(secondContainer);

    try {
      await act(async () => {
        firstRoot.render(
          <FileTreeReact
            header={<button data-test-react-header>React header</button>}
            model={model}
          />
        );
        await flushDom();
      });

      const firstHost = getHost(firstContainer);
      expect(
        firstHost.querySelector('[data-test-react-header]')?.textContent
      ).toBe('React header');
      expect(
        firstHost.querySelector('[data-test-model-header="true"]')
      ).toBeNull();

      act(() => {
        firstRoot.unmount();
      });

      await act(async () => {
        secondRoot.render(<FileTreeReact model={model} />);
        await flushDom();
      });

      const secondHost = getHost(secondContainer);
      expect(
        secondHost.querySelector('[data-test-model-header="true"]')?.textContent
      ).toBe('Model header');
    } finally {
      act(() => {
        secondRoot.unmount();
      });
      model.cleanUp();
      firstContainer.remove();
      secondContainer.remove();
    }
  });

  test('header button clicks can mutate the model and focus the new item', async () => {
    function Harness() {
      const { model } = useFileTree(BASE_OPTIONS);

      return (
        <FileTreeReact
          header={
            <button
              data-test-header-add
              onClick={() => {
                model.add('demo-note.md');
                model.focusPath('demo-note.md');
              }}
              type="button"
            >
              Add file
            </button>
          }
          model={model}
        />
      );
    }

    await actAndFlush(() => {
      root.render(<Harness />);
    });

    const host = getHost(container);
    const headerButtonNode = host.querySelector('[data-test-header-add]');
    if (!(headerButtonNode instanceof dom.window.HTMLButtonElement)) {
      throw new Error('expected header add button');
    }

    const headerButton = headerButtonNode;

    await actAndFlush(() => {
      dispatchClick(headerButton);
    });

    const addedItem = getItemButton(host, 'demo-note.md');
    expect(addedItem).not.toBeNull();
  });

  test('selection and search hooks rerender from model updates', async () => {
    function Harness() {
      const { model } = useFileTree({ ...BASE_OPTIONS, search: true });
      const selectedPaths = useFileTreeSelection(model);
      const search = useFileTreeSearch(model);

      return (
        <>
          <button
            data-test-select
            onClick={() => {
              model.getItem('README.md')?.select();
            }}
            type="button"
          >
            Select README
          </button>
          <button
            data-test-search
            onClick={() => {
              search.open('read');
            }}
            type="button"
          >
            Search read
          </button>
          <output data-test-search-count>{search.matchingPaths.length}</output>
          <output data-test-search-open>{String(search.isOpen)}</output>
          <output data-test-search-value>{search.value}</output>
          <output data-test-selected-count>{selectedPaths.length}</output>
          <FileTreeReact model={model} />
        </>
      );
    }

    await actAndFlush(() => {
      root.render(<Harness />);
    });

    const selectedCountNode = container.querySelector(
      '[data-test-selected-count]'
    );
    const searchOpenNode = container.querySelector('[data-test-search-open]');
    const searchValueNode = container.querySelector('[data-test-search-value]');
    const searchCountNode = container.querySelector('[data-test-search-count]');
    const selectButtonNode = container.querySelector('[data-test-select]');
    const searchButtonNode = container.querySelector('[data-test-search]');
    if (
      !(selectedCountNode instanceof dom.window.HTMLElement) ||
      !(searchOpenNode instanceof dom.window.HTMLElement) ||
      !(searchValueNode instanceof dom.window.HTMLElement) ||
      !(searchCountNode instanceof dom.window.HTMLElement) ||
      !(selectButtonNode instanceof dom.window.HTMLButtonElement) ||
      !(searchButtonNode instanceof dom.window.HTMLButtonElement)
    ) {
      throw new Error('expected hook harness elements');
    }

    const selectedCount = selectedCountNode;
    const searchOpen = searchOpenNode;
    const searchValue = searchValueNode;
    const searchCount = searchCountNode;
    const selectButton = selectButtonNode;
    const searchButton = searchButtonNode;

    expect(selectedCount.textContent).toBe('0');
    expect(searchOpen.textContent).toBe('false');
    expect(searchValue.textContent).toBe('');
    expect(searchCount.textContent).toBe('0');

    await actAndFlush(() => {
      dispatchClick(selectButton);
    });

    expect(selectedCount.textContent).toBe('1');

    await actAndFlush(() => {
      dispatchClick(searchButton);
    });

    expect(searchOpen.textContent).toBe('true');
    expect(searchValue.textContent).toBe('read');
    expect(searchCount.textContent).toBe('1');
  });

  test('search hook reacts to manual input in the tree search box', async () => {
    function Harness() {
      const { model } = useFileTree({ ...BASE_OPTIONS, search: true });
      const search = useFileTreeSearch(model);

      return (
        <>
          <button
            data-test-open-search
            onClick={() => {
              search.open('button');
            }}
            type="button"
          >
            Open search
          </button>
          <output data-test-search-value>{search.value}</output>
          <FileTreeReact model={model} />
        </>
      );
    }

    await actAndFlush(() => {
      root.render(<Harness />);
    });

    const host = getHost(container);
    const openSearchButtonNode = container.querySelector(
      '[data-test-open-search]'
    );
    const searchValueNode = container.querySelector('[data-test-search-value]');
    if (
      !(openSearchButtonNode instanceof dom.window.HTMLButtonElement) ||
      !(searchValueNode instanceof dom.window.HTMLElement)
    ) {
      throw new Error('expected search harness elements');
    }

    const openSearchButton = openSearchButtonNode;
    const searchValue = searchValueNode;

    await actAndFlush(() => {
      dispatchClick(openSearchButton);
    });

    expect(searchValue.textContent).toBe('button');

    const searchInputNode = host.shadowRoot?.querySelector(
      '[data-file-tree-search-input]'
    );
    if (!(searchInputNode instanceof dom.window.HTMLInputElement)) {
      throw new Error('expected tree search input');
    }

    const searchInput = searchInputNode;

    await actAndFlush(() => {
      searchInput.value = 'readme';
      searchInput.dispatchEvent(
        new dom.window.Event('input', { bubbles: true })
      );
    });

    expect(searchValue.textContent).toBe('readme');
  });

  test('bridges header and context-menu composition through the model surface', async () => {
    function Harness() {
      const { model } = useFileTree(BASE_OPTIONS);
      const [showHeader, setShowHeader] = useState(true);
      const [showMenu, setShowMenu] = useState(true);

      return (
        <>
          <button
            data-test-toggle-header
            onClick={() => {
              setShowHeader(false);
            }}
            type="button"
          >
            Hide header
          </button>
          <button
            data-test-toggle-menu
            onClick={() => {
              setShowMenu(false);
            }}
            type="button"
          >
            Hide menu
          </button>
          <FileTreeReact
            header={
              showHeader ? (
                <button data-test-header>Header action</button>
              ) : null
            }
            model={model}
            renderContextMenu={
              showMenu
                ? (item) => <div data-test-menu>{item.path}</div>
                : undefined
            }
          />
        </>
      );
    }

    await actAndFlush(() => {
      root.render(<Harness />);
    });

    const host = getHost(container);
    expect(
      host.querySelector('[slot="header"] [data-test-header]')
    ).not.toBeNull();

    const readmeButton = getItemButton(host, 'README.md');
    await actAndFlush(() => {
      readmeButton.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 24,
          clientY: 36,
        })
      );
    });

    expect(
      host.querySelector('[slot="context-menu"] [data-test-menu]')?.textContent
    ).toBe('README.md');

    const toggleHeaderButtonNode = container.querySelector(
      '[data-test-toggle-header]'
    );
    const toggleMenuButtonNode = container.querySelector(
      '[data-test-toggle-menu]'
    );
    if (
      !(toggleHeaderButtonNode instanceof dom.window.HTMLButtonElement) ||
      !(toggleMenuButtonNode instanceof dom.window.HTMLButtonElement)
    ) {
      throw new Error('expected toggle buttons');
    }

    const toggleHeaderButton = toggleHeaderButtonNode;
    const toggleMenuButton = toggleMenuButtonNode;

    await actAndFlush(() => {
      dispatchClick(toggleHeaderButton);
    });
    await flushDom();

    expect(host.querySelector('[slot="header"]')).toBeNull();

    await actAndFlush(() => {
      dispatchClick(toggleMenuButton);
    });
    await flushDom();

    expect(host.querySelector('[slot="context-menu"]')).toBeNull();
  });

  test('hydrates preloadedData without a client/server mismatch', async () => {
    const preloadedData = preloadFileTree({
      ...BASE_OPTIONS,
      id: 'pst-react-hydration-test',
    });
    const hydrationErrors: string[] = [];
    const originalConsoleError = console.error;
    const originalDocument = Reflect.get(globalThis, 'document');
    const hydrateContainer = document.createElement('div');
    document.body.appendChild(hydrateContainer);
    const model = new FileTreeClass(BASE_OPTIONS);

    function Harness() {
      return (
        <FileTreeReact
          header={<button data-test-hydration-header>Header action</button>}
          model={model}
          preloadedData={preloadedData}
        />
      );
    }

    Reflect.deleteProperty(globalThis, 'document');
    const serverHtml = renderToString(<Harness />);
    Object.assign(globalThis, { document: originalDocument });
    hydrateContainer.innerHTML = serverHtml;
    console.error = (...args: unknown[]) => {
      hydrationErrors.push(args.map((value) => String(value)).join(' '));
    };

    let hydrationRoot: Root | null = null;
    try {
      await act(async () => {
        hydrationRoot = hydrateRoot(hydrateContainer, <Harness />);
        await flushDom();
      });

      const hydratedHost = getHost(hydrateContainer);
      expect(
        hydratedHost.querySelector(
          '[slot="header"] [data-test-hydration-header]'
        )
      ).not.toBeNull();
      expect(
        hydrationErrors.some((message) =>
          message.includes(
            "Hydration failed because the server rendered HTML didn't match the client"
          )
        )
      ).toBe(false);
    } finally {
      console.error = originalConsoleError;
      Object.assign(globalThis, { document: originalDocument });
      if (hydrationRoot != null) {
        act(() => {
          hydrationRoot?.unmount();
        });
      }
      model.cleanUp();
      hydrateContainer.remove();
    }
  });

  test('hydrates colocated preloadedData and preserves live header interactions', async () => {
    function HeaderAction() {
      const [count, setCount] = useState(0);
      return (
        <button
          data-test-ssr-header
          onClick={() => {
            setCount((previousCount) => previousCount + 1);
          }}
          type="button"
        >
          Header action {count}
        </button>
      );
    }

    const preloadedData = preloadFileTree({
      ...BASE_OPTIONS,
      id: 'pst-react-ssr-test',
    });
    const originalDocument = Reflect.get(globalThis, 'document');
    const ssrMount = document.createElement('div');
    document.body.appendChild(ssrMount);

    function Harness() {
      const { model } = useFileTree(BASE_OPTIONS);

      return (
        <FileTreeReact
          header={<HeaderAction />}
          model={model}
          preloadedData={preloadedData}
        />
      );
    }

    Reflect.deleteProperty(globalThis, 'document');
    const serverHtml = renderToString(<Harness />);
    Object.assign(globalThis, { document: originalDocument });
    ssrMount.innerHTML = serverHtml;

    const serverHost = getHost(ssrMount);
    expect(serverHost.querySelectorAll('[slot="header"]')).toHaveLength(1);
    expect(
      serverHost.querySelector('[slot="header"] [data-test-ssr-header]')
        ?.textContent
    ).toBe('Header action 0');

    let hydrationRoot: Root | null = null;
    try {
      await act(async () => {
        hydrationRoot = hydrateRoot(ssrMount, <Harness />);
        await flushDom();
      });

      expect(serverHost.querySelectorAll('[slot="header"]')).toHaveLength(1);
      const hydratedHeaderNode = serverHost.querySelector(
        '[data-test-ssr-header]'
      );
      if (!(hydratedHeaderNode instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected hydrated header button');
      }

      const hydratedHeader = hydratedHeaderNode;

      await actAndFlush(() => {
        dispatchClick(hydratedHeader);
      });

      expect(hydratedHeader.textContent).toBe('Header action 1');
    } finally {
      Object.assign(globalThis, { document: originalDocument });
      if (hydrationRoot != null) {
        act(() => {
          hydrationRoot?.unmount();
        });
      }
      ssrMount.remove();
    }
  });
});
