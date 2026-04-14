import { describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
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

async function flushDom(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getItemButton(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM,
  path: string
): HTMLButtonElement {
  const button = shadowRoot?.querySelector(`[data-item-path="${path}"]`);
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`missing button for ${path}`);
  }

  return button as HTMLButtonElement;
}

describe('path-store dynamic files / mutation API', () => {
  test('controller emits add, move, batch, and reset mutation events', async () => {
    const { PathStore } = await import('@pierre/path-store');
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
    });
    const events: Array<{
      events?: readonly { operation: string }[];
      operation: string;
    }> = [];
    const unsubscribe = controller.onMutation('*', (event) => {
      events.push(event);
    });

    controller.add('src/utils.ts');
    controller.move('src/utils.ts', 'src/helpers.ts');
    controller.batch([
      { path: 'src/lib/', type: 'add' },
      { path: 'src/lib/theme.ts', type: 'add' },
    ]);
    controller.resetPaths(['README.md'], {
      preparedInput: PathStore.prepareInput(['README.md']),
    });

    expect(events.map((event) => event.operation)).toEqual([
      'add',
      'move',
      'batch',
      'reset',
    ]);
    expect(events[2]).toMatchObject({ operation: 'batch' });
    expect(events[2]?.events?.map((event) => event.operation)).toEqual([
      'add',
      'add',
    ]);
    expect(events[3]).toMatchObject({
      operation: 'reset',
      pathCountAfter: 1,
      usedPreparedInput: true,
    });

    unsubscribe();
    controller.destroy();
  });

  test('controller keeps focus and selection aligned to moved paths', async () => {
    const { PathStoreTreesController } =
      await import('../src/path-store/controller');

    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['docs/readme.md', 'src/index.ts'],
    });

    controller.focusPath('docs/readme.md');
    controller.selectOnlyPath('docs/readme.md');
    controller.move('docs/readme.md', 'src/readme.md');

    expect(controller.getFocusedPath()).toBe('src/readme.md');
    expect(controller.getSelectedPaths()).toEqual(['src/readme.md']);

    controller.remove('src/readme.md');

    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getFocusedPath()).toBe('src/');

    controller.destroy();
  });

  test('file-tree delegates the shared mutation handle and rerenders after resetPaths', async () => {
    const { PathStore } = await import('@pierre/path-store');
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const events: string[] = [];

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        viewportHeight: 140,
      });
      const unsubscribe = fileTree.onMutation('*', (event) => {
        events.push(event.operation);
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      fileTree.add('src/utils.ts');
      await flushDom();

      const shadowRootAfterAdd = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        getItemButton(shadowRootAfterAdd, dom, 'src/utils.ts')
      ).not.toBeNull();

      fileTree.resetPaths(['README.md'], {
        preparedInput: PathStore.prepareInput(['README.md']),
      });
      await flushDom();

      const shadowRootAfterReset = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        getItemButton(shadowRootAfterReset, dom, 'README.md')
      ).not.toBeNull();
      expect(
        shadowRootAfterReset?.querySelector('[data-item-path="src/index.ts"]')
      ).toBeNull();
      expect(events).toEqual(['add', 'reset']);

      unsubscribe();
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('context-menu delete proof removes the item and restores focus coherently', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let fileTree: InstanceType<typeof PathStoreFileTree> | null = null;

      fileTree = new PathStoreFileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (item, context): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              const deleteButton = dom.window.document.createElement('button');
              deleteButton.textContent = 'Delete';
              deleteButton.addEventListener('click', () => {
                fileTree?.remove(
                  item.path,
                  item.kind === 'directory' ? { recursive: true } : undefined
                );
                context.close();
              });
              menu.append(deleteButton);
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      readmeButton.focus();
      readmeButton.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 24,
          clientY: 36,
        })
      );
      await flushDom();

      const deleteButton = host?.querySelector('[slot="context-menu"] button');
      if (!(deleteButton instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected slotted delete button');
      }
      const menuDeleteButton = deleteButton as HTMLButtonElement;
      menuDeleteButton.click();
      await flushDom();

      expect(
        shadowRoot?.querySelector('[data-item-path="README.md"]')
      ).toBeNull();
      expect(host?.querySelector('[slot="context-menu"]')).toBeNull();
      expect(
        shadowRoot?.querySelector(
          'button[data-type="item"][data-item-focused="true"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
