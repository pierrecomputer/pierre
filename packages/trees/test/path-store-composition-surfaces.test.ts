import { describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
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
}

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

describe('path-store composition surfaces', () => {
  test('preloadPathStoreFileTree includes header slot and closed context-menu shell scaffolding', async () => {
    const { preloadPathStoreFileTree } = await import('../src/path-store');

    const payload = preloadPathStoreFileTree({
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

  test('attaches and removes header slot content on the host', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
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
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let capturedContext: CapturedContextMenuOpenContext | null = null;

      const fileTree = new PathStoreFileTree({
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

  test('hydrates host-managed slot content without duplicating header nodes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree, preloadPathStoreFileTree } =
        await import('../src/path-store');

      const payload = preloadPathStoreFileTree({
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

      const fileTree = new PathStoreFileTree({
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

  test('supports icon remaps and render-only row decorators', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      let decoratorContextKeys: string[] = [];

      const fileTree = new PathStoreFileTree({
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
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
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
