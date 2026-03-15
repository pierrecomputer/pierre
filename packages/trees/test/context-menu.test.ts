import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

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
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    HTMLDivElement: dom.window.HTMLDivElement,
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
    const ft = new FileTree(
      { initialFiles: ['README.md'] },
      {
        onContextMenuOpen: (item) => {
          openedItems.push(item);
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
    expect(
      shadowRoot?.querySelector('[data-type="context-menu-container"]')
    ).not.toBeNull();
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
      shadowRoot?.querySelector('[data-type="context-menu-container"]')
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
