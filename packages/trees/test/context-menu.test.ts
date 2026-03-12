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
    expect(payload.shadowHtml).toContain('display:none');
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
});
