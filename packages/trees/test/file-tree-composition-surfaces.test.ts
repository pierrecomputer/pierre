import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { serializeFileTreeSsrPayload } from '../src/ssr';

interface CapturedContextMenuOpenContext {
  anchorElement: HTMLElement;
  anchorRect: {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
    x: number;
    y: number;
  };
  close: () => void;
  restoreFocus: () => void;
}

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSS: Reflect.get(globalThis, 'CSS'),
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

  return button;
}

function getTreeRoot(
  shadowRoot: ShadowRoot | null | undefined,
  dom: JSDOM
): HTMLElement {
  const root = shadowRoot?.querySelector('[role="tree"]');
  if (!(root instanceof dom.window.HTMLElement)) {
    throw new Error('missing tree root');
  }

  return root;
}

describe('file-tree composition surfaces', () => {
  test('preloadFileTree includes header slot and closed context-menu shell scaffolding', async () => {
    const { preloadFileTree } = await import('../src/render/FileTree');

    const payload = preloadFileTree({
      composition: {
        contextMenu: {
          enabled: true,
        },
      },
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 120 / 30,
    });
    expect(payload.shadowHtml).toContain('slot name="header"');
    expect(payload.shadowHtml).toContain('data-type="context-menu-anchor"');
    expect(payload.shadowHtml).toContain('data-type="context-menu-trigger"');
    expect(payload.shadowHtml).toContain('aria-haspopup="menu"');
    expect(payload.shadowHtml).toContain(
      'data-file-tree-context-menu-trigger-mode="right-click"'
    );
    expect(payload.shadowHtml).toContain('data-file-tree-virtualized-scroll');
    expect(payload.shadowHtml).toMatch(
      /data-file-tree-virtualized-scroll[\s\S]*data-type="context-menu-anchor"/
    );
  });

  test('preloadFileTree omits context-menu affordance when the feature is disabled', async () => {
    const { preloadFileTree } = await import('../src/render/FileTree');

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 120 / 30,
    });

    expect(payload.shadowHtml).not.toContain(
      'data-type="context-menu-trigger"'
    );
    expect(payload.shadowHtml).not.toContain('slot name="context-menu"');
    expect(payload.shadowHtml).not.toContain('data-type="context-menu-anchor"');
  });

  test('attaches and removes header slot content on the host', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          header: {
            render: (): HTMLElement => {
              const header = dom.window.document.createElement('button');
              header.dataset.testHeader = 'true';
              header.textContent = 'Header action';
              return header as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      expect(host?.querySelector('[slot="header"]')).not.toBeNull();
      expect(
        host?.querySelector('[data-test-header="true"]')?.textContent
      ).toBe('Header action');

      fileTree.cleanUp();
      expect(host?.querySelector('[slot="header"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('opens and closes a host-slotted context menu without rename-specific context fields', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let capturedContext: CapturedContextMenuOpenContext | null = null;

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (_item, context): HTMLElement => {
              capturedContext = context;
              const menu = dom.window.document.createElement('div');
              menu.dataset.testMenu = 'true';
              const closeButton = dom.window.document.createElement('button');
              closeButton.textContent = 'Close';
              closeButton.addEventListener('click', () => {
                context.close();
              });
              menu.append(closeButton);
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const button = getItemButton(shadowRoot, dom, 'README.md');
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const anchorElement = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      );
      expect(scrollElement?.contains(anchorElement ?? null)).toBe(false);
      expect(treeRoot.contains(anchorElement ?? null)).toBe(true);
      expect(anchorElement?.getAttribute('data-visible')).toBe('false');
      expect(
        shadowRoot
          ?.querySelector('[data-type="context-menu-trigger"]')
          ?.getAttribute('data-visible')
      ).toBe('false');

      button.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 24,
          clientY: 36,
        })
      );
      await flushDom();

      expect(host?.querySelector('[slot="context-menu"]')).not.toBeNull();
      expect(shadowRoot?.querySelector('[slot="context-menu"]')).toBeNull();
      if (capturedContext == null) {
        throw new Error('expected captured context');
      }
      const context =
        capturedContext as unknown as CapturedContextMenuOpenContext;
      expect(context.anchorElement).toBeDefined();
      expect(context.anchorElement.dataset.type).toBe('context-menu-trigger');
      expect(context.anchorRect).toBeDefined();
      expect(typeof context.close).toBe('function');
      expect(typeof context.restoreFocus).toBe('function');
      expect(
        'canRename' in (context as unknown as Record<string, unknown>)
      ).toBe(false);
      expect(
        'startRenaming' in (context as unknown as Record<string, unknown>)
      ).toBe(false);

      const { close } = context;
      if (typeof close !== 'function') {
        throw new Error('expected close helper');
      }
      close();
      await flushDom();

      expect(host?.querySelector('[slot="context-menu"]')).toBeNull();
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('Shift+F10 opens the context menu for the focused row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let capturedContext: CapturedContextMenuOpenContext | null = null;

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (_item, context): HTMLElement => {
              capturedContext = context;
              const menu = dom.window.document.createElement('div');
              menu.textContent = 'Context Menu';
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      itemButton.focus();
      itemButton.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true,
        })
      );
      await flushDom();

      expect(capturedContext).not.toBeNull();
      const openContext =
        capturedContext as unknown as CapturedContextMenuOpenContext;
      expect(openContext.anchorElement.dataset.type).toBe(
        'context-menu-trigger'
      );
      expect(
        shadowRoot?.querySelector(
          '[data-type="context-menu-anchor"] slot[name="context-menu"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keeps the opened row visually focused and restores DOM focus on close', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let capturedContext: CapturedContextMenuOpenContext | null = null;

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (_item, context): HTMLElement => {
              capturedContext = context;
              const menu = dom.window.document.createElement('div');
              const closeButton = dom.window.document.createElement('button');
              closeButton.textContent = 'Close';
              closeButton.addEventListener('click', () => {
                context.close();
              });
              menu.append(closeButton);
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const button = getItemButton(shadowRoot, dom, 'README.md');

      button.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      expect(button.dataset.itemFocused).toBe('true');
      expect(dom.window.document.activeElement).not.toBe(button);

      if (capturedContext == null) {
        throw new Error('expected captured context');
      }
      const closeContext =
        capturedContext as unknown as CapturedContextMenuOpenContext;
      closeContext.close();
      await flushDom();
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(host?.shadowRoot?.activeElement).toBe(button);
      expect(button.dataset.itemFocused).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('blocks tree keyboard navigation while context menu is open', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              menu.textContent = 'Menu';
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      itemButton.focus();
      itemButton.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true,
        })
      );
      await flushDom();

      const treeRoot = shadowRoot?.querySelector('[role="tree"]');
      const blockedArrowKey = new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'ArrowDown',
      });
      treeRoot?.dispatchEvent(blockedArrowKey);

      expect(blockedArrowKey.defaultPrevented).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders an interaction wash and keeps trigger and hover styling while open', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              menu.textContent = 'Menu';
              return menu as unknown as HTMLElement;
            },
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      ) as HTMLButtonElement | null;

      itemButton.focus();
      itemButton.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true,
        })
      );
      await flushDom();

      const wash = shadowRoot?.querySelector(
        '[data-type="context-menu-wash"]'
      ) as HTMLDivElement | null;
      expect(wash).not.toBeNull();
      expect(wash?.getAttribute('aria-hidden')).toBe('true');
      expect(trigger?.dataset.visible).toBe('true');
      expect(itemButton.dataset.itemContextHover).toBe('true');

      const treeRoot = shadowRoot?.querySelector('[role="tree"]');
      treeRoot?.dispatchEvent(
        new dom.window.Event('pointerleave', { bubbles: true, composed: true })
      );
      expect(trigger?.dataset.visible).toBe('true');
      expect(itemButton.dataset.itemContextHover).toBe('true');

      const wheelEvent = new dom.window.Event('wheel', {
        bubbles: true,
        cancelable: true,
      });
      wash?.dispatchEvent(wheelEvent);
      expect(wheelEvent.defaultPrevented).toBe(true);

      const touchStartEvent = new dom.window.Event('touchstart', {
        bubbles: true,
        cancelable: true,
      });
      wash?.dispatchEvent(touchStartEvent);
      expect(touchStartEvent.defaultPrevented).toBe(true);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('document Escape closes the menu and prevents default when focus is in slotted content', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              const closeButton = dom.window.document.createElement('button');
              closeButton.textContent = 'Close';
              menu.append(closeButton);
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      itemButton.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      const slottedMenuButton = host?.querySelector(
        '[slot="context-menu"] button'
      );
      if (!(slottedMenuButton instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected slotted menu button');
      }
      const menuButton = slottedMenuButton;
      menuButton.focus();

      const escapeEvent = new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      });
      menuButton.dispatchEvent(escapeEvent);
      await flushDom();

      expect(escapeEvent.defaultPrevented).toBe(true);
      expect(host?.querySelector('[slot="context-menu"]')).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keeps row hover when pointer moves from row to options anchor and open menu', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              menu.textContent = 'Menu';
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      const contextMenuAnchor = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      ) as HTMLDivElement | null;

      itemButton.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();
      expect(itemButton.dataset.itemContextHover).toBe('true');

      contextMenuAnchor?.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();
      expect(itemButton.dataset.itemContextHover).toBe('true');

      itemButton.focus();
      itemButton.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true,
        })
      );
      await flushDom();

      const contextMenuContent = host?.querySelector('[slot="context-menu"]');
      contextMenuContent?.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();
      expect(itemButton.dataset.itemContextHover).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('keyboard navigation retargets the trigger away from a stale hovered row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const openedPath = { current: null as string | null };
      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (item): HTMLElement => {
              openedPath.current = item.path;
              const menu = dom.window.document.createElement('div');
              return menu as unknown as HTMLElement;
            },
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const firstRow = getItemButton(shadowRoot, dom, 'README.md');
      const secondRow = getItemButton(shadowRoot, dom, 'src/index.ts');
      const thirdRow = getItemButton(shadowRoot, dom, 'src/lib/utils.ts');
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      );

      if (!(trigger instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected context-menu trigger');
      }

      firstRow.focus();
      await flushDom();
      expect(fileTree.getFocusedPath()).toBe('README.md');

      thirdRow.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();
      expect(thirdRow.dataset.itemContextHover).toBe('true');

      fileTree.focusPath('src/index.ts');
      await flushDom();

      const focusedSecondRow = getItemButton(shadowRoot, dom, 'src/index.ts');
      focusedSecondRow.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code: 'Space',
          ctrlKey: true,
          key: ' ',
        })
      );
      await flushDom();

      expect(fileTree.getFocusedPath()).toBe('src/index.ts');
      expect(thirdRow.dataset.itemContextHover).toBe('true');
      expect(secondRow.dataset.itemContextHover).toBeUndefined();
      expect(trigger.dataset.visible).toBe('true');

      trigger.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      expect(openedPath.current).toBe('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('falls back to the focused row after pointer hover clears during scroll', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const openedPath = { current: null as string | null };
      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (item): HTMLElement => {
              openedPath.current = item.path;
              const menu = dom.window.document.createElement('div');
              return menu as unknown as HTMLElement;
            },
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const root = shadowRoot?.querySelector('[role="tree"]');
      const viewport = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const firstRow = getItemButton(shadowRoot, dom, 'README.md');
      const secondRow = getItemButton(shadowRoot, dom, 'src/index.ts');
      const thirdRow = getItemButton(shadowRoot, dom, 'src/lib/utils.ts');
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      );

      if (
        !(root instanceof dom.window.HTMLElement) ||
        !(viewport instanceof dom.window.HTMLElement) ||
        !(trigger instanceof dom.window.HTMLButtonElement)
      ) {
        throw new Error('expected virtualized tree elements');
      }
      const scrollViewport = viewport;
      const triggerButton = trigger;

      firstRow.focus();
      fileTree.focusPath('src/index.ts');
      await flushDom();

      expect(fileTree.getFocusedPath()).toBe('src/index.ts');
      expect(triggerButton.dataset.visible).toBe('true');

      thirdRow.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();

      expect(triggerButton.dataset.visible).toBe('true');
      expect(thirdRow.dataset.itemContextHover).toBe('true');
      expect(secondRow.dataset.itemContextHover).toBeUndefined();

      scrollViewport.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();

      expect(triggerButton.dataset.visible).toBe('true');
      expect(thirdRow.dataset.itemContextHover).toBeUndefined();
      expect(secondRow.dataset.itemContextHover).toBeUndefined();
      expect(fileTree.getFocusedPath()).toBe('src/index.ts');

      triggerButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      expect(openedPath.current).toBe('src/index.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('hides the focused trigger when the retained focused row is parked offscreen', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        initialVisibleRowCount: 90 / 30,
        overscan: 0,
        paths: [
          'README.md',
          ...Array.from({ length: 20 }, (_unused, index) => {
            return `src/generated/file-${String(index).padStart(2, '0')}.ts`;
          }),
        ],
        stickyFolders: true,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const root = getTreeRoot(shadowRoot, dom);
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const firstRow = shadowRoot?.querySelector(
        'button[data-type="item"][data-item-type="file"]'
      );
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      );

      if (
        !(firstRow instanceof dom.window.HTMLButtonElement) ||
        !(scrollElement instanceof dom.window.HTMLElement) ||
        !(trigger instanceof dom.window.HTMLButtonElement)
      ) {
        throw new Error('expected virtualized tree elements');
      }
      const focusedPath = firstRow.dataset.itemPath;
      if (focusedPath == null) {
        throw new Error('expected focused row path');
      }

      firstRow.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();
      expect(fileTree.getFocusedPath()).toBe(focusedPath);
      expect(trigger.dataset.visible).toBe('true');

      scrollElement.scrollTop = 240;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await new Promise((resolve) => setTimeout(resolve, 60));
      await flushDom();

      const parkedFirstRow = getItemButton(shadowRoot, dom, focusedPath);
      expect(parkedFirstRow.dataset.itemParked).toBe('true');

      const visibleHoverRow = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      ).find((button) => {
        return (
          button instanceof dom.window.HTMLButtonElement &&
          button.dataset.itemParked !== 'true' &&
          button.dataset.fileTreeStickyRow !== 'true' &&
          button.dataset.itemPath !== focusedPath
        );
      });
      if (!(visibleHoverRow instanceof dom.window.HTMLButtonElement)) {
        throw new Error('expected a visible hover row');
      }

      visibleHoverRow.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();
      expect(trigger.dataset.visible).toBe('true');

      root.dispatchEvent(new dom.window.Event('pointerleave'));
      await flushDom();

      expect(trigger.dataset.visible).toBe('false');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('clears visual focus after a null-target blur from a row restored after parking', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        initialVisibleRowCount: 90 / 30,
        overscan: 0,
        paths: [
          'README.md',
          ...Array.from({ length: 20 }, (_unused, index) => {
            return `src/generated/file-${String(index).padStart(2, '0')}.ts`;
          }),
        ],
        stickyFolders: true,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      );
      const firstRow = shadowRoot?.querySelector(
        'button[data-type="item"][data-item-type="file"]'
      );

      if (
        !(firstRow instanceof dom.window.HTMLButtonElement) ||
        !(scrollElement instanceof dom.window.HTMLElement) ||
        !(trigger instanceof dom.window.HTMLButtonElement)
      ) {
        throw new Error('expected virtualized tree elements');
      }
      const focusedPath = firstRow.dataset.itemPath;
      if (focusedPath == null) {
        throw new Error('expected focused row path');
      }

      firstRow.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      scrollElement.scrollTop = 240;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      expect(
        getItemButton(shadowRoot, dom, focusedPath).dataset.itemParked
      ).toBe('true');

      scrollElement.scrollTop = 0;
      scrollElement.dispatchEvent(new dom.window.Event('scroll'));
      await flushDom();
      await flushDom();

      const restoredFirstRow = getItemButton(shadowRoot, dom, focusedPath);
      expect(restoredFirstRow.dataset.itemParked).toBeUndefined();
      expect(restoredFirstRow.dataset.itemFocused).toBe('true');
      await new Promise((resolve) => setTimeout(resolve, 60));
      await flushDom();
      expect(trigger.dataset.visible).toBe('true');

      restoredFirstRow.blur();
      await flushDom();
      await flushDom();

      expect(
        shadowRoot?.querySelector('button[data-item-focused="true"]')
      ).toBeNull();
      expect(trigger.dataset.visible).toBe('false');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('button-capable modes reserve the action lane and keep lane attrs stable', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            buttonVisibility: 'always',
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      const decorationLane = itemButton.querySelector(
        '[data-item-section="decoration"]'
      );
      const actionLane = itemButton.querySelector(
        '[data-item-section="action"]'
      );
      const decorativeAffordance = actionLane?.querySelector(
        '[data-item-action-affordance="decorative"]'
      );

      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-trigger-mode')
      ).toBe('button');
      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-button-visibility')
      ).toBe('always');
      expect(
        treeRoot.getAttribute('data-file-tree-has-context-menu-action-lane')
      ).toBe('true');
      expect(
        itemButton.getAttribute('data-item-context-menu-trigger-mode')
      ).toBe('button');
      expect(
        itemButton.getAttribute('data-item-context-menu-button-visibility')
      ).toBe('always');
      expect(
        itemButton.getAttribute('data-item-has-context-menu-action-lane')
      ).toBe('true');
      expect(decorationLane).not.toBeNull();
      expect(actionLane).not.toBeNull();
      expect(decorativeAffordance?.getAttribute('aria-hidden')).toBe('true');
      expect(actionLane?.querySelector('button')).toBeNull();
      expect(
        shadowRoot?.querySelectorAll('[data-type="context-menu-trigger"]')
      ).toHaveLength(1);

      itemButton.dispatchEvent(
        new dom.window.Event('pointerover', { bubbles: true, composed: true })
      );
      await flushDom();

      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-trigger-mode')
      ).toBe('button');
      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-button-visibility')
      ).toBe('always');
      expect(
        itemButton.getAttribute('data-item-context-menu-button-visibility')
      ).toBe('always');
      expect(
        itemButton.getAttribute('data-item-has-context-menu-action-lane')
      ).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('button mode defaults to when-needed visibility', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      const actionLane = itemButton.querySelector(
        '[data-item-section="action"]'
      );
      const decorativeAffordance = actionLane?.querySelector(
        '[data-item-action-affordance="decorative"]'
      );

      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-trigger-mode')
      ).toBe('button');
      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-button-visibility')
      ).toBe('when-needed');
      expect(
        itemButton.getAttribute('data-item-context-menu-button-visibility')
      ).toBe('when-needed');
      expect(
        itemButton.getAttribute('data-item-has-context-menu-action-lane')
      ).toBe('true');
      expect(actionLane).not.toBeNull();
      expect(decorativeAffordance).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('focused click reveals the default when-needed context-menu button without hover', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            triggerMode: 'button',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const secondRow = getItemButton(shadowRoot, dom, 'src/index.ts');
      const anchor = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      );
      const trigger = shadowRoot?.querySelector(
        '[data-type="context-menu-trigger"]'
      );

      if (
        !(anchor instanceof dom.window.HTMLDivElement) ||
        !(trigger instanceof dom.window.HTMLButtonElement)
      ) {
        throw new Error('expected context-menu anchor and trigger');
      }

      expect(anchor.dataset.visible).toBe('false');
      expect(trigger.dataset.visible).toBe('false');

      secondRow.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        })
      );
      await flushDom();

      const selectedSecondRow = getItemButton(shadowRoot, dom, 'src/index.ts');
      expect(fileTree.getFocusedPath()).toBe('src/index.ts');
      expect(anchor.dataset.visible).toBe('true');
      expect(trigger.dataset.visible).toBe('true');
      expect(selectedSecondRow.dataset.itemSelected).toBe('true');
      expect(selectedSecondRow.dataset.itemFocused).toBe('true');
      expect(selectedSecondRow.dataset.itemContextHover).toBeUndefined();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('right-click-only mode omits the action lane but still opens menus', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let capturedContext: CapturedContextMenuOpenContext | null = null;

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (_item, context): HTMLElement => {
              capturedContext = context;
              const menu = dom.window.document.createElement('div');
              menu.dataset.testMenu = 'true';
              return menu as unknown as HTMLElement;
            },
            triggerMode: 'right-click',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const treeRoot = getTreeRoot(shadowRoot, dom);
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      expect(
        treeRoot.getAttribute('data-file-tree-context-menu-trigger-mode')
      ).toBe('right-click');
      expect(
        treeRoot.getAttribute('data-file-tree-has-context-menu-action-lane')
      ).toBeNull();
      expect(
        itemButton.getAttribute('data-item-has-context-menu-action-lane')
      ).toBeNull();
      expect(
        itemButton.querySelector('[data-item-section="action"]')
      ).toBeNull();

      itemButton.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 24,
          clientY: 36,
        })
      );
      await flushDom();

      expect(capturedContext).not.toBeNull();
      expect(
        shadowRoot?.querySelector(
          '[data-type="context-menu-anchor"] slot[name="context-menu"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('right-click-only mode still anchors keyboard-opened menus to the focused row', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (): HTMLElement => {
              const menu = dom.window.document.createElement('div');
              menu.dataset.testMenu = 'true';
              return menu as unknown as HTMLElement;
            },
            triggerMode: 'right-click',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const itemButton = getItemButton(shadowRoot, dom, 'README.md');
      const scrollElement = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]'
      );
      const anchor = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      ) as HTMLDivElement | null;
      if (!(scrollElement instanceof dom.window.HTMLElement)) {
        throw new Error('expected virtualized scroll element');
      }

      itemButton.getBoundingClientRect = () =>
        ({
          bottom: 68,
          height: 20,
          left: 0,
          right: 120,
          top: 48,
          width: 120,
          x: 0,
          y: 48,
        }) as DOMRect;
      scrollElement.getBoundingClientRect = () =>
        ({
          bottom: 200,
          height: 200,
          left: 0,
          right: 240,
          top: 8,
          width: 240,
          x: 0,
          y: 8,
        }) as DOMRect;

      itemButton.focus();
      itemButton.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'F10',
          shiftKey: true,
        })
      );
      await flushDom();

      expect(anchor?.style.top).toBe('48px');
      expect(host?.querySelector('[slot="context-menu"]')).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('adds aria-haspopup=menu only when context menu is enabled', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');

      const disabledMount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(disabledMount);
      const disabled = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });
      disabled.render({ containerWrapper: disabledMount });
      await flushDom();

      const disabledShadowRoot = disabled.getFileTreeContainer()?.shadowRoot;
      const disabledItem = getItemButton(disabledShadowRoot, dom, 'README.md');
      expect(disabledItem.getAttribute('aria-haspopup')).toBeNull();
      expect(
        disabledShadowRoot?.querySelector('[data-type="context-menu-trigger"]')
      ).toBeNull();

      const enabledMount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(enabledMount);
      const enabled = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        initialVisibleRowCount: 120 / 30,
      });
      enabled.render({ containerWrapper: enabledMount });
      await flushDom();

      const enabledShadowRoot = enabled.getFileTreeContainer()?.shadowRoot;
      const enabledTreeRoot = getTreeRoot(enabledShadowRoot, dom);
      const enabledItem = getItemButton(enabledShadowRoot, dom, 'README.md');
      expect(enabledItem.getAttribute('aria-haspopup')).toBe('menu');
      expect(
        enabledShadowRoot?.querySelector('[data-type="context-menu-trigger"]')
      ).not.toBeNull();
      expect(
        enabledTreeRoot.getAttribute('data-file-tree-context-menu-trigger-mode')
      ).toBe('right-click');
      expect(
        enabledTreeRoot.getAttribute(
          'data-file-tree-has-context-menu-action-lane'
        )
      ).toBeNull();
      expect(
        enabledItem.getAttribute('data-item-has-context-menu-action-lane')
      ).toBeNull();
      disabled.cleanUp();
      enabled.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('hydrates host-managed slot content without duplicating header nodes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree, preloadFileTree } =
        await import('../src/render/FileTree');

      const payload = preloadFileTree({
        composition: {
          contextMenu: {
            enabled: true,
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
          },
          header: {
            render: (): HTMLElement => {
              const header = dom.window.document.createElement('div');
              header.dataset.testHydratedHeader = 'true';
              header.textContent = 'Hydrated header';
              return header as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        id: payload.id,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();
      fileTree.render({ fileTreeContainer: host });
      await flushDom();

      expect(host.querySelectorAll('[slot="header"]')).toHaveLength(1);
      expect(
        host.querySelector('[data-test-hydrated-header="true"]')
      ).not.toBeNull();
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('controller restores nearest parent before considering sibling fallbacks', async () => {
    const { FileTreeController } =
      await import('../src/model/FileTreeController');

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/index.ts', 'src/other.ts'],
    });

    controller.resetPaths(['src/other.ts']);

    expect(controller.resolveNearestVisiblePath('src/index.ts')).toBe('src/');
    expect(controller.focusNearestPath('src/index.ts')).toBe('src/');
    expect(controller.getFocusedPath()).toBe('src/');

    controller.destroy();
  });

  test('controller falls back to the previous sibling before the next sibling', async () => {
    const { FileTreeController } =
      await import('../src/model/FileTreeController');

    const controller = new FileTreeController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['alpha.ts', 'charlie.ts'],
    });

    expect(controller.resolveNearestVisiblePath('bravo.ts')).toBe('alpha.ts');
    expect(controller.focusNearestPath('bravo.ts')).toBe('alpha.ts');
    expect(controller.getFocusedPath()).toBe('alpha.ts');

    controller.destroy();
  });

  test('supports icon remaps and render-only row decorators', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let decoratorContextKeys: string[] = [];

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        icons: {
          byFileName: {
            'readme.md': 'pst-test-readme',
          },
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-readme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /></symbol></svg>',
        },
        paths: ['README.md', 'src/index.ts'],
        renderRowDecoration: (context) => {
          decoratorContextKeys = Object.keys(context);
          return context.item.path === 'README.md'
            ? { text: 'DOC', title: 'Documentation file' }
            : null;
        },
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      const iconUse = readmeButton.querySelector('use');
      expect(iconUse?.getAttribute('href')).toBe('#pst-test-readme');
      expect(
        readmeButton.querySelector('[data-item-section="decoration"]')
          ?.textContent
      ).toBe('DOC');
      expect(decoratorContextKeys).toEqual(['item', 'row']);
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('falls back to built-in file icons when no icon overrides are provided', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      const href =
        readmeButton.querySelector('use')?.getAttribute('href') ?? '';
      expect(href.startsWith('#file-tree-builtin-')).toBe(true);
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
