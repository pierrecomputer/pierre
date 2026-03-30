import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

import { createTree } from '../src/core/create-tree';
import { hotkeysCoreFeature } from '../src/features/hotkeys-core/feature';
import { renamingFeature } from '../src/features/renaming/feature';
import { selectionFeature } from '../src/features/selection/feature';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import { generateSyncDataLoader } from '../src/loader/sync';
import type { ContextMenuOpenContext } from '../src/types';
import type { FileTreeNode } from '../src/types';

let FileTree: typeof import('../src/FileTree').FileTree;
let preloadFileTree: typeof import('../src/ssr/preloadFileTree').preloadFileTree;
let preactRenderer: typeof import('../src/utils/preactRenderer').preactRenderer;

beforeAll(async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLSlotElement: dom.window.HTMLSlotElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    SVGElement: dom.window.SVGElement,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    customElements: dom.window.customElements,
  });

  // jsdom doesn't support CSSStyleSheet.replaceSync – provide a no-op mock.
  class MockCSSStyleSheet {
    cssRules: unknown[] = [];
    replaceSync(_text: string) {}
  }
  Object.assign(globalThis, { CSSStyleSheet: MockCSSStyleSheet });

  ({ FileTree } = await import('../src/FileTree'));
  ({ preloadFileTree } = await import('../src/ssr/preloadFileTree'));
  ({ preactRenderer } = await import('../src/utils/preactRenderer'));
});

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('context menu', () => {
  test('SSR output includes the header slot outlet', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts'],
    });

    expect(payload.shadowHtml).toContain('slot name="header"');
  });

  test('SSR output omits context menu affordance when the feature is disabled', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
    });

    expect(payload.shadowHtml).not.toContain(
      'data-type="context-menu-trigger"'
    );
    expect(payload.shadowHtml).not.toContain('context-menu-container');
    expect(payload.shadowHtml).not.toContain('slot name="context-menu"');
  });

  test('SSR output contains hidden trigger but NOT the slot container when the feature is enabled', () => {
    const payload = preloadFileTree(
      {
        initialFiles: [
          'README.md',
          'src/index.ts',
          'src/components/Button.tsx',
        ],
      },
      {
        onContextMenuOpen: () => {},
      }
    );

    expect(payload.shadowHtml).toContain('data-type="context-menu-trigger"');
    expect(payload.shadowHtml).toContain('data-visible="false"');
    expect(payload.shadowHtml).not.toContain('context-menu-container');
    expect(payload.shadowHtml).not.toContain('slot name="context-menu"');
  });

  test('SSR hydration succeeds without mismatch when context menu is enabled but closed', () => {
    const onOpen = () => {};
    const onClose = () => {};
    const payload = preloadFileTree(
      {
        initialFiles: ['README.md', 'src/index.ts'],
      },
      {
        onContextMenuOpen: onOpen,
        onContextMenuClose: onClose,
      }
    );

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    let hydrated = 0;
    let rendered = 0;
    const origHydrate = preactRenderer.hydrateRoot;
    const origRender = preactRenderer.renderRoot;
    preactRenderer.hydrateRoot = () => {
      hydrated += 1;
    };
    preactRenderer.renderRoot = () => {
      rendered += 1;
    };

    try {
      const ft = new FileTree(
        { initialFiles: ['README.md', 'src/index.ts'] },
        { onContextMenuOpen: onOpen, onContextMenuClose: onClose }
      );
      ft.hydrate({ fileTreeContainer: container });
      expect(hydrated).toBe(1);
      expect(rendered).toBe(0);
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
      preactRenderer.renderRoot = origRender;
    }
  });

  test('onContextMenuOpen callback is wired through callbacksRef', () => {
    const onOpen = () => {};
    const onClose = () => {};

    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      { onContextMenuOpen: onOpen, onContextMenuClose: onClose }
    );

    expect(ft.callbacksRef.current.onContextMenuOpen).toBe(onOpen);
    expect(ft.callbacksRef.current.onContextMenuClose).toBe(onClose);
  });

  test('setCallbacks rerenders when context menu enabled state toggles', () => {
    const container = document.createElement('file-tree-container');

    let renders = 0;
    const origRender = preactRenderer.renderRoot;
    preactRenderer.renderRoot = () => {
      renders += 1;
    };

    try {
      const ft = new FileTree({ initialFiles: ['README.md'] });
      ft.render({ fileTreeContainer: container });

      expect(renders).toBe(1);

      ft.setCallbacks({ onContextMenuOpen: () => {} });
      expect(renders).toBe(2);

      ft.setCallbacks({ onContextMenuOpen: () => {} });
      expect(renders).toBe(2);

      ft.setCallbacks({ onContextMenuOpen: undefined });
      expect(renders).toBe(3);
    } finally {
      preactRenderer.renderRoot = origRender;
    }
  });

  test('setCallbacks updates context menu callbacks', () => {
    const ft = new FileTree({ initialFiles: ['README.md'] });

    expect(ft.callbacksRef.current.onContextMenuOpen).toBeUndefined();
    expect(ft.callbacksRef.current.onContextMenuClose).toBeUndefined();

    const onOpen = () => {};
    const onClose = () => {};
    ft.setCallbacks({ onContextMenuOpen: onOpen, onContextMenuClose: onClose });

    expect(ft.callbacksRef.current.onContextMenuOpen).toBe(onOpen);
    expect(ft.callbacksRef.current.onContextMenuClose).toBe(onClose);
  });

  test('Shift+F10 opens the context menu for the focused item', async () => {
    const openedItems: Array<{ path: string; isFolder: boolean }> = [];
    const openContexts: Array<{
      anchorElement: HTMLElement;
      close: () => void;
    }> = [];
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      {
        onContextMenuOpen: (item, context) => {
          openedItems.push(item);
          openContexts.push({
            anchorElement: context.anchorElement,
            close: context.close,
          });
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    const focusBeforeOpen = document.createElement('button');
    document.body.appendChild(focusBeforeOpen);
    focusBeforeOpen.focus();
    expect(document.activeElement).toBe(focusBeforeOpen);

    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );

    await Promise.resolve();

    expect(openedItems).toEqual([{ path: 'README.md', isFolder: false }]);
    expect(openContexts).toHaveLength(1);
    expect(openContexts[0]?.anchorElement.getAttribute('data-type')).toBe(
      'context-menu-trigger'
    );
    expect(typeof openContexts[0]?.close).toBe('function');
    expect(
      shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"] slot[name="context-menu"]'
      )
    ).not.toBeNull();
  });

  test('context menu exposes startRenaming/canRename when renaming is enabled', async () => {
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      { initialFiles: ['README.md'], renaming: true },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    const capturedContext = openContextRef.current;
    expect(capturedContext).not.toBeNull();
    if (capturedContext == null) {
      throw new Error('Expected context menu open context');
    }
    expect(capturedContext.canRename).toBe(true);
    expect(typeof capturedContext.startRenaming).toBe('function');

    capturedContext.startRenaming?.();
    await Promise.resolve();

    const tree = ft.handleRef.current?.tree;
    expect(tree?.isRenamingItem?.()).toBe(true);
    expect(
      shadowRoot?.querySelector('[data-type="context-menu-wash"]')
    ).toBeNull();
  });

  test('context menu reports canRename=false when renaming is disabled', async () => {
    let canRenameValue: boolean | undefined;
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      {
        onContextMenuOpen: (_item, context) => {
          canRenameValue = context.canRename;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    expect(canRenameValue).toBe(false);
  });

  test('renaming feature applies onInput value before completeRenaming', () => {
    const renamedValueRef: { current: string | null } = { current: null };
    const tree = createTree<FileTreeNode>({
      rootItemId: 'root',
      dataLoader: generateSyncDataLoader(['README.md']),
      getItemName: (item) => item.getItemData().name,
      isItemFolder: (item) => item.getItemData()?.children?.direct != null,
      features: [
        syncDataLoaderFeature,
        selectionFeature,
        hotkeysCoreFeature,
        renamingFeature,
      ],
      onRename: (_item, value) => {
        renamedValueRef.current = value;
      },
    });
    tree.setMounted(true);
    tree.rebuildTree();

    const readme = tree
      .getItems()
      .find((item) => item.getItemData().path === 'README.md');
    if (readme == null) {
      throw new Error('Expected README item');
    }

    readme.startRenaming();
    const renameInputProps = readme.getRenameInputProps() as {
      onInput?: (event: { target?: { value: string } }) => void;
    };
    renameInputProps.onInput?.({ target: { value: 'RENAMED.md' } });
    tree.completeRenaming();

    expect(renamedValueRef.current).toBe('RENAMED.md');
  });

  test('renaming feature seeds flattened folder rename with leaf basename', () => {
    const tree = createTree<FileTreeNode>({
      rootItemId: 'root',
      dataLoader: generateSyncDataLoader(['src/utils/deep/index.ts'], {
        flattenEmptyDirectories: true,
      }),
      getItemName: (item) => item.getItemData().name,
      isItemFolder: (item) => item.getItemData()?.children?.direct != null,
      features: [
        syncDataLoaderFeature,
        selectionFeature,
        hotkeysCoreFeature,
        renamingFeature,
      ],
    });
    tree.setMounted(true);
    tree.rebuildTree();

    const flattenedFolder = tree
      .getItems()
      .find((item) => item.getItemData().flattens != null);
    expect(flattenedFolder).toBeDefined();
    if (flattenedFolder == null) {
      throw new Error('Expected a flattened folder item');
    }

    flattenedFolder.startRenaming();
    expect(tree.getRenamingValue()).toBe('deep');
  });

  test('flattened folder rename renders input only for the leaf segment', async () => {
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      {
        initialFiles: ['src/utils/deep/index.ts'],
        flattenEmptyDirectories: true,
        renaming: true,
      },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const flattenedFolderButton = Array.from(
      shadowRoot?.querySelectorAll(
        'button[data-type="item"][data-item-type="folder"]'
      ) ?? []
    ).find(
      (button) => button.querySelector('[data-item-flattened-subitems]') != null
    ) as HTMLButtonElement | undefined;
    expect(flattenedFolderButton).toBeDefined();
    if (flattenedFolderButton == null) {
      throw new Error('Expected a flattened folder row');
    }
    flattenedFolderButton.focus();
    flattenedFolderButton.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();
    openContextRef.current?.startRenaming?.();
    await Promise.resolve();

    const input = shadowRoot?.querySelector(
      '[data-item-flattened-rename-input]'
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (input == null) {
      throw new Error('Expected flattened rename input');
    }
    expect(input.value).toBe('deep');

    const flattenedContainer = input.closest('[data-item-flattened-subitems]');
    expect(flattenedContainer).not.toBeNull();
    if (flattenedContainer == null) {
      throw new Error('Expected flattened segments container');
    }
    const segments = flattenedContainer.querySelectorAll(
      '[data-item-flattened-subitem]'
    );
    expect(segments.length).toBeGreaterThan(1);

    const firstSegment = segments.item(0);
    expect(firstSegment?.querySelector('[data-item-rename-input]')).toBeNull();
    const lastSegment = segments.item(segments.length - 1);
    expect(lastSegment?.querySelector('[data-item-rename-input]')).toBe(input);
  });

  test('renaming.onRename is called for file rename', async () => {
    const renameEvents: Array<{
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }> = [];
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      {
        initialFiles: ['README.md'],
        renaming: {
          onRename: (event) => {
            renameEvents.push(event);
          },
        },
      },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    const context = openContextRef.current;
    expect(context).not.toBeNull();
    if (context == null) {
      throw new Error('Expected context menu open context');
    }
    context.startRenaming?.();
    await Promise.resolve();

    const tree = ft.handleRef.current?.tree;
    expect(tree).not.toBeUndefined();
    tree?.applySubStateUpdate('renamingValue', () => 'RENAMED.md');
    tree?.completeRenaming();
    await Promise.resolve();

    expect(renameEvents).toEqual([
      {
        sourcePath: 'README.md',
        destinationPath: 'RENAMED.md',
        isFolder: false,
      },
    ]);
    expect(ft.getFiles()).toEqual(['RENAMED.md']);
  });

  test('renaming.onRename is called for folder rename', async () => {
    const renameEvents: Array<{
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }> = [];
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      {
        initialFiles: ['src/index.ts', 'src/components/Button.tsx'],
        renaming: {
          onRename: (event) => {
            renameEvents.push(event);
          },
        },
      },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    const context = openContextRef.current;
    expect(context).not.toBeNull();
    if (context == null) {
      throw new Error('Expected context menu open context');
    }
    context.startRenaming?.();
    await Promise.resolve();

    const tree = ft.handleRef.current?.tree;
    expect(tree).not.toBeUndefined();
    tree?.applySubStateUpdate('renamingValue', () => 'source');
    tree?.completeRenaming();
    await Promise.resolve();

    expect(renameEvents).toEqual([
      {
        sourcePath: 'src',
        destinationPath: 'source',
        isFolder: true,
      },
    ]);
    expect(ft.getFiles()).toContain('source/index.ts');
    expect(ft.getFiles()).toContain('source/components/Button.tsx');
  });

  test('folder rename restores focus to the renamed folder (no flatten)', async () => {
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      {
        initialFiles: ['src/index.ts', 'src/components/Button.tsx'],
        flattenEmptyDirectories: false,
        renaming: true,
      },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });
    await flushMicrotasks();

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const sourceFolderButton = Array.from(
      shadowRoot?.querySelectorAll(
        'button[data-type="item"][data-item-type="folder"]'
      ) ?? []
    ).find(
      (button) => button.querySelector('[data-item-flattened-subitems]') == null
    ) as HTMLButtonElement | undefined;
    expect(sourceFolderButton).toBeDefined();
    if (sourceFolderButton == null) {
      throw new Error('Expected non-flattened source folder button');
    }
    sourceFolderButton.focus();
    sourceFolderButton.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await flushMicrotasks();
    openContextRef.current?.startRenaming?.();
    await flushMicrotasks();

    const tree = ft.handleRef.current?.tree;
    expect(tree).not.toBeUndefined();
    tree?.applySubStateUpdate('renamingValue', () => 'source');
    tree?.completeRenaming();
    await flushMicrotasks();

    const handleAfter = ft.handleRef.current;
    const renamedFolderId = handleAfter?.pathToId.get('source');
    expect(renamedFolderId).toBeDefined();
    if (renamedFolderId == null) {
      throw new Error('Expected renamed folder ID');
    }
    const focusedRow = shadowRoot?.querySelector(
      'button[data-type="item"][data-item-focused="true"]'
    ) as HTMLButtonElement | null;
    expect(focusedRow).not.toBeNull();
    expect(tree?.getState().focusedItem).toBe(renamedFolderId);
    expect(focusedRow?.dataset.itemId).toBe(renamedFolderId);
    expect(ft.getFiles()).toContain('source/index.ts');
  });

  test('folder rename restores focus to the renamed folder (flattened)', async () => {
    const openContextRef: { current: ContextMenuOpenContext | null } = {
      current: null,
    };
    const ft = new FileTree(
      {
        initialFiles: ['src/utils/deep/index.ts'],
        flattenEmptyDirectories: true,
        renaming: true,
      },
      {
        onContextMenuOpen: (_item, context) => {
          openContextRef.current = context;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });
    await flushMicrotasks();

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const sourceFolderButton = Array.from(
      shadowRoot?.querySelectorAll(
        'button[data-type="item"][data-item-type="folder"]'
      ) ?? []
    ).find(
      (button) => button.querySelector('[data-item-flattened-subitems]') != null
    ) as HTMLButtonElement | undefined;
    expect(sourceFolderButton).toBeDefined();
    if (sourceFolderButton == null) {
      throw new Error('Expected flattened source folder button');
    }
    sourceFolderButton.focus();
    sourceFolderButton.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await flushMicrotasks();
    openContextRef.current?.startRenaming?.();
    await flushMicrotasks();

    const tree = ft.handleRef.current?.tree;
    expect(tree).not.toBeUndefined();
    tree?.applySubStateUpdate('renamingValue', () => 'renamed');
    tree?.completeRenaming();
    await flushMicrotasks();

    const handleAfter = ft.handleRef.current;
    const renamedFolderPath = 'src/utils/renamed';
    const renamedFolderId =
      handleAfter?.pathToId.get(`f::${renamedFolderPath}`) ??
      handleAfter?.pathToId.get(renamedFolderPath);
    expect(renamedFolderId).toBeDefined();
    if (renamedFolderId == null) {
      throw new Error('Expected renamed folder ID');
    }
    const focusedRow = shadowRoot?.querySelector(
      'button[data-type="item"][data-item-focused="true"]'
    ) as HTMLButtonElement | null;
    expect(focusedRow).not.toBeNull();
    expect(tree?.getState().focusedItem).toBe(renamedFolderId);
    expect(focusedRow?.dataset.itemId).toBe(renamedFolderId);
    expect(ft.getFiles()).toContain('src/utils/renamed/index.ts');
  });

  test('context menu close helper closes tree-managed open state', async () => {
    let closeContextMenu: (() => void) | null = null;
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      {
        onContextMenuOpen: (_item, context) => {
          closeContextMenu = context.close;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.focus();
    const focusBeforeOpen = document.activeElement;
    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    expect(
      shadowRoot?.querySelector('[data-type="context-menu-wash"]')
    ).not.toBeNull();

    const closeHelper = closeContextMenu as (() => void) | null;
    if (closeHelper == null) {
      throw new Error('Expected close helper to be defined');
    }
    const tempFocusTarget = document.createElement('button');
    document.body.appendChild(tempFocusTarget);
    tempFocusTarget.focus();
    expect(document.activeElement).toBe(tempFocusTarget);

    closeHelper();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot?.querySelector('[data-type="context-menu-wash"]')).toBe(
      null
    );
    expect(document.activeElement).toBe(focusBeforeOpen);
    tempFocusTarget.remove();
  });

  test('restores keyboard focus after a mouse-opened context menu closes', async () => {
    let closeContextMenu: (() => void) | null = null;
    const ft = new FileTree(
      { initialFiles: ['README.md', 'src/index.ts'] },
      {
        onContextMenuOpen: (_item, context) => {
          closeContextMenu = context.close;
        },
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButtons = shadowRoot?.querySelectorAll<HTMLButtonElement>(
      'button[data-type="item"]'
    );
    const firstItem = itemButtons?.[0] ?? null;
    const secondItem = itemButtons?.[1] ?? null;
    const trigger = shadowRoot?.querySelector(
      '[data-type="context-menu-trigger"]'
    ) as HTMLButtonElement | null;
    expect(firstItem).not.toBeNull();
    expect(secondItem).not.toBeNull();
    expect(trigger).not.toBeNull();

    firstItem?.focus();
    firstItem?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      })
    );
    const focusBeforeOpen = document.activeElement as HTMLElement | null;
    expect(focusBeforeOpen).not.toBeNull();

    // Simulate browser behavior where clicking the floating trigger can blur
    // focus to <body> before the menu opens.
    focusBeforeOpen?.blur();
    expect(document.activeElement).toBe(document.body);

    secondItem?.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    trigger?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    await Promise.resolve();

    const closeHelper = closeContextMenu as (() => void) | null;
    if (closeHelper == null) {
      throw new Error('Expected close helper to be defined');
    }
    closeHelper();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(shadowRoot?.querySelector('[data-type="context-menu-wash"]')).toBe(
      null
    );
    expect(document.activeElement).toBe(focusBeforeOpen);
  });

  test('blocks tree keyboard navigation while context menu is open', async () => {
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      { onContextMenuOpen: () => {} }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const fileTreeContainer = ft.getFileTreeContainer();
    const shadowRoot = fileTreeContainer?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    itemButton?.focus();
    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    const treeRoot = shadowRoot?.querySelector('[role="tree"]');
    const blockedArrowKey = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    treeRoot?.dispatchEvent(blockedArrowKey);
    expect(blockedArrowKey.defaultPrevented).toBe(true);
  });

  test('renders a transparent interaction wash and keeps trigger visible while open', async () => {
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      { onContextMenuOpen: () => {} }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    const trigger = shadowRoot?.querySelector(
      '[data-type="context-menu-trigger"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();
    expect(trigger).not.toBeNull();

    itemButton?.focus();
    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    const wash = shadowRoot?.querySelector(
      '[data-type="context-menu-wash"]'
    ) as HTMLDivElement | null;
    expect(wash).not.toBeNull();
    expect(wash?.getAttribute('aria-hidden')).toBe('true');
    expect(trigger?.dataset.visible).toBe('true');
    expect(itemButton?.dataset.itemContextHover).toBe('true');

    const treeRoot = shadowRoot?.querySelector('[role="tree"]');
    treeRoot?.dispatchEvent(new Event('pointerleave'));
    expect(trigger?.dataset.visible).toBe('true');
    expect(itemButton?.dataset.itemContextHover).toBe('true');

    const wheelEvent = new Event('wheel', { bubbles: true, cancelable: true });
    wash?.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);
  });

  test('keeps item hover styling active while context menu is open', async () => {
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      {
        onContextMenuOpen: () => {},
      }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const fileTreeContainer = ft.getFileTreeContainer();
    const shadowRoot = fileTreeContainer?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(itemButton).not.toBeNull();

    const contextMenuContent = document.createElement('div');
    contextMenuContent.setAttribute('slot', 'context-menu');
    contextMenuContent.textContent = 'Context Menu Content';
    fileTreeContainer?.appendChild(contextMenuContent);

    itemButton?.focus();
    itemButton?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();

    expect(
      shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"] slot[name="context-menu"]'
      )
    ).not.toBeNull();

    contextMenuContent.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    expect(itemButton?.dataset.itemContextHover).toBe('true');

    const treeRoot = shadowRoot?.querySelector('[role="tree"]');
    expect(treeRoot).not.toBeNull();
    treeRoot?.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    expect(itemButton?.dataset.itemContextHover).toBe('true');

    contextMenuContent.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    expect(itemButton?.dataset.itemContextHover).toBe('true');
  });

  test('keeps row hover when pointer moves from row to options anchor', () => {
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      { onContextMenuOpen: () => {} }
    );
    const containerWrapper = document.createElement('div');
    ft.render({ containerWrapper });

    const shadowRoot = ft.getFileTreeContainer()?.shadowRoot;
    const itemButton = shadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    const contextMenuAnchor = shadowRoot?.querySelector(
      '[data-type="context-menu-anchor"]'
    ) as HTMLDivElement | null;
    expect(itemButton).not.toBeNull();
    expect(contextMenuAnchor).not.toBeNull();

    itemButton?.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    expect(itemButton?.dataset.itemContextHover).toBe('true');

    contextMenuAnchor?.dispatchEvent(
      new Event('pointerover', { bubbles: true, composed: true })
    );
    expect(itemButton?.dataset.itemContextHover).toBe('true');
  });

  test('adds aria-haspopup=menu only when context menu is enabled', () => {
    const disabled = new FileTree({ initialFiles: ['README.md'] });
    const disabledContainer = document.createElement('div');
    disabled.render({ containerWrapper: disabledContainer });

    const disabledShadowRoot = disabled.getFileTreeContainer()?.shadowRoot;
    const disabledItem = disabledShadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    expect(disabledItem).not.toBeNull();
    expect(disabledItem?.getAttribute('aria-haspopup')).toBeNull();
    expect(
      disabledShadowRoot?.querySelector('[data-type="context-menu-trigger"]')
    ).toBeNull();

    const enabled = new FileTree(
      { initialFiles: ['README.md'] },
      { onContextMenuOpen: () => {} }
    );
    const enabledContainer = document.createElement('div');
    enabled.render({ containerWrapper: enabledContainer });

    const enabledShadowRoot = enabled.getFileTreeContainer()?.shadowRoot;
    const enabledItem = enabledShadowRoot?.querySelector(
      'button[data-type="item"]'
    ) as HTMLButtonElement | null;
    const trigger = enabledShadowRoot?.querySelector(
      '[data-type="context-menu-trigger"]'
    ) as HTMLButtonElement | null;

    expect(enabledItem).not.toBeNull();
    expect(enabledItem?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
  });
});
