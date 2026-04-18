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

async function loadFileTreeController(): Promise<
  typeof import('../src/index').FileTreeController
> {
  const module = await import('../src/model/FileTreeController');
  const controller = Object.values(module).find(
    (value): value is typeof import('../src/index').FileTreeController =>
      typeof value === 'function' &&
      'prototype' in value &&
      'getVisibleRows' in value.prototype
  );
  if (controller == null) {
    throw new Error('Expected FileTreeController export');
  }

  return controller;
}

async function loadFileTree(): Promise<typeof import('../src/index').FileTree> {
  const module = await import('../src/render/FileTree');
  const fileTree = Object.values(module).find(
    (value): value is typeof import('../src/index').FileTree =>
      typeof value === 'function' &&
      'prototype' in value &&
      'render' in value.prototype
  );
  if (fileTree == null) {
    throw new Error('Expected FileTree export');
  }

  return fileTree;
}

describe('file-tree dynamic files / mutation API', () => {
  test('controller emits add, move, batch, and reset mutation events', async () => {
    const { PathStore } = await import('@pierre/path-store');
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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
      pathCountBefore: 4,
      pathCountAfter: 1,
      usedPreparedInput: true,
    });

    unsubscribe();
    controller.destroy();
  });

  test('typed onMutation listeners stay filtered while subscribe still tracks non-mutation rerenders', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
    });
    const subscribeNotifications: number[] = [];
    const addEvents: string[] = [];
    const removeEvents: Array<{ path: string; recursive: boolean }> = [];

    const unsubscribeRerender = controller.subscribe(() => {
      subscribeNotifications.push(controller.getVisibleCount());
    });
    const unsubscribeAdd = controller.onMutation('add', (event) => {
      addEvents.push(event.path);
    });
    const unsubscribeRemove = controller.onMutation('remove', (event) => {
      removeEvents.push({
        path: event.path,
        recursive: event.recursive,
      });
    });

    const subscribeCountBeforeCollapse = subscribeNotifications.length;
    const srcDirectory = controller.getItem('src/');
    if (
      srcDirectory == null ||
      srcDirectory.isDirectory() !== true ||
      !('collapse' in srcDirectory)
    ) {
      throw new Error('expected src/ directory handle');
    }
    srcDirectory.collapse();

    expect(subscribeNotifications.length).toBeGreaterThan(
      subscribeCountBeforeCollapse
    );
    expect(addEvents).toEqual([]);
    expect(removeEvents).toEqual([]);

    controller.add('src/utils.ts');
    controller.remove('README.md');

    expect(addEvents).toEqual(['src/utils.ts']);
    expect(removeEvents).toEqual([
      {
        path: 'README.md',
        recursive: false,
      },
    ]);

    unsubscribeRemove();
    unsubscribeAdd();
    unsubscribeRerender();
    controller.destroy();
  });

  test('controller keeps focus and selection aligned to moved paths', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
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

  test('directory moves remap focused selections and range anchors', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/utils.ts'],
    });

    controller.focusPath('src/index.ts');
    controller.selectOnlyPath('src/index.ts');
    controller.move('src/', 'lib/');

    expect(controller.getFocusedPath()).toBe('lib/index.ts');
    expect(controller.getSelectedPaths()).toEqual(['lib/index.ts']);

    controller.selectPathRange('lib/utils.ts', false);

    expect(controller.getSelectedPaths()).toEqual([
      'lib/index.ts',
      'lib/utils.ts',
    ]);

    controller.destroy();
  });

  test('directory lookup-path moves still remap focused descendants', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/utils.ts'],
    });

    controller.focusPath('src/index.ts');
    controller.selectOnlyPath('src/index.ts');
    controller.selectPath('src/utils.ts');
    controller.move('src', 'lib/');

    expect(controller.getFocusedPath()).toBe('lib/index.ts');
    expect(controller.getSelectedPaths()).toEqual([
      'lib/index.ts',
      'lib/utils.ts',
    ]);

    controller.destroy();
  });

  test('recursive directory removal falls focus back to the nearest surviving row', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/utils.ts'],
    });

    controller.focusPath('src/index.ts');
    controller.remove('src/', { recursive: true });

    expect(controller.getFocusedPath()).toBe('README.md');
    expect(controller.getItem('src/')).toBeNull();

    controller.destroy();
  });

  test('directory lookup-path removals clear descendant selections and focused paths', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/utils.ts'],
    });

    controller.focusPath('src/index.ts');
    controller.selectOnlyPath('src/index.ts');
    controller.selectPath('src/utils.ts');
    controller.remove('src', { recursive: true });

    expect(controller.getSelectedPaths()).toEqual([]);
    expect(controller.getFocusedPath()).toBe('README.md');

    controller.destroy();
  });

  test('batch supports mixed add, move, and remove operations', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/old.ts'],
    });
    const batchEvents: Array<readonly string[]> = [];
    const unsubscribe = controller.onMutation('batch', (event) => {
      batchEvents.push(event.events.map((entry) => entry.operation));
    });

    controller.batch([
      { path: 'src/new.ts', type: 'add' },
      { from: 'src/new.ts', to: 'src/renamed.ts', type: 'move' },
      { path: 'src/old.ts', type: 'remove' },
    ]);

    expect(batchEvents).toEqual([['add', 'move', 'remove']]);
    expect(controller.getItem('src/old.ts')).toBeNull();
    expect(controller.getItem('src/renamed.ts')).not.toBeNull();

    unsubscribe();
    controller.destroy();
  });

  test('file-tree delegates the shared mutation handle and rerenders after resetPaths', async () => {
    const { PathStore } = await import('@pierre/path-store');
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const events: string[] = [];

      const fileTree = new FileTree({
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

  test('empty directories render as folders even before they gain children', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: ['docs/'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const docsButton = getItemButton(shadowRoot, dom, 'docs/');

      expect(docsButton.dataset.itemType).toBe('folder');
      expect(docsButton.getAttribute('aria-expanded')).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('getItem returns fresh handles after move and remove mutations', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'lib/', 'src/foo.ts'],
    });

    const movedHandleBefore = controller.getItem('src/foo.ts');
    expect(movedHandleBefore).not.toBeNull();

    controller.move('src/foo.ts', 'lib/foo.ts');

    expect(controller.getItem('src/foo.ts')).toBeNull();
    const movedHandleAfter = controller.getItem('lib/foo.ts');
    expect(movedHandleAfter).not.toBeNull();
    expect(movedHandleAfter?.getPath()).toBe('lib/foo.ts');
    expect(movedHandleAfter?.isDirectory()).toBe(false);

    controller.remove('lib/foo.ts');

    expect(controller.getItem('lib/foo.ts')).toBeNull();

    controller.destroy();
  });

  test('adding under a collapsed directory keeps the directory collapsed until re-expanded', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
    });

    const srcDirectory = controller.getItem('src/');
    if (
      srcDirectory == null ||
      srcDirectory.isDirectory() !== true ||
      !('collapse' in srcDirectory) ||
      !('expand' in srcDirectory)
    ) {
      throw new Error('expected src/ directory handle');
    }

    srcDirectory.collapse();
    controller.add('src/utils.ts');

    expect(
      controller.getVisibleRows(0, controller.getVisibleCount())
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/utils.ts',
        }),
      ])
    );

    srcDirectory.expand();

    expect(controller.getVisibleRows(0, controller.getVisibleCount())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/utils.ts',
        }),
      ])
    );

    controller.destroy();
  });

  test('shared mutation handle intentionally omits raw-store callback batching', async () => {
    const FileTreeController = await loadFileTreeController();

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['README.md'],
    });

    const assertBatchCallbackIsRejected = (): void => {
      // @ts-expect-error raw PathStore callback batching is intentionally not exposed on the shared trees handle
      controller.batch((store) => {
        store.add('src/index.ts');
      });
    };
    void assertBatchCallbackIsRejected;

    controller.destroy();
  });

  test('context-menu delete proof removes the item and restores focus coherently', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let fileTree: InstanceType<typeof FileTree> | null = null;

      fileTree = new FileTree({
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
