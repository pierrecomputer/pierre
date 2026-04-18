import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

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
      viewportHeight: 120,
    });

    expect(payload.shadowHtml).toContain('slot name="header"');
    expect(payload.shadowHtml).toContain('data-type="context-menu-anchor"');
    expect(payload.shadowHtml).toContain('data-type="context-menu-trigger"');
    expect(payload.shadowHtml).toContain('aria-haspopup="menu"');
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
      viewportHeight: 120,
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
        viewportHeight: 120,
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
        viewportHeight: 120,
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
      const anchorElement = shadowRoot?.querySelector(
        '[data-type="context-menu-anchor"]'
      );
      expect(scrollElement?.contains(anchorElement ?? null)).toBe(true);
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
        viewportHeight: 120,
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
        viewportHeight: 120,
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
        viewportHeight: 120,
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
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md'],
        viewportHeight: 120,
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
        viewportHeight: 120,
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
        viewportHeight: 120,
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

  test('keeps pointer-driven trigger state from falling back to the focused row after scroll', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        viewportHeight: 120,
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
      const treeRoot = root;
      const scrollViewport = viewport;
      const triggerButton = trigger;

      firstRow.focus();
      firstRow.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowDown',
        })
      );
      await flushDom();
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

      expect(triggerButton.dataset.visible).toBe('false');
      expect(thirdRow.dataset.itemContextHover).toBeUndefined();
      expect(secondRow.dataset.itemContextHover).toBeUndefined();

      treeRoot.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'ArrowDown',
        })
      );
      await flushDom();

      expect(triggerButton.dataset.visible).toBe('true');

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
        viewportHeight: 120,
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
        viewportHeight: 120,
      });
      enabled.render({ containerWrapper: enabledMount });
      await flushDom();

      const enabledShadowRoot = enabled.getFileTreeContainer()?.shadowRoot;
      const enabledItem = getItemButton(enabledShadowRoot, dom, 'README.md');
      expect(enabledItem.getAttribute('aria-haspopup')).toBe('menu');
      expect(
        enabledShadowRoot?.querySelector('[data-type="context-menu-trigger"]')
      ).not.toBeNull();

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
        viewportHeight: 120,
      });

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = payload.html;
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
        viewportHeight: 120,
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
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      const iconUse = readmeButton.querySelector('use');
      expect(iconUse?.getAttribute('href')).toBe('#pst-test-readme');
      expect(
        readmeButton.querySelector('[data-item-section="status"]')?.textContent
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
        viewportHeight: 120,
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
