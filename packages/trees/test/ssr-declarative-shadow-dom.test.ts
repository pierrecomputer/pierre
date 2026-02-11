import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

let FileTree: typeof import('../src/FileTree').FileTree;
let createFileTreeSsrPayload: typeof import('../src/ssr/preloadFileTree').createFileTreeSsrPayload;
let ensureFileTreeStyles: typeof import('../src/components/web-components').ensureFileTreeStyles;
let adoptDeclarativeShadowDom: typeof import('../src/components/web-components').adoptDeclarativeShadowDom;
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
  ({ createFileTreeSsrPayload } = await import('../src/ssr/preloadFileTree'));
  ({ ensureFileTreeStyles, adoptDeclarativeShadowDom } =
    await import('../src/components/web-components'));
  ({ preactRenderer } = await import('../src/utils/preactRenderer'));
});

describe('SSR + declarative shadow DOM', () => {
  test('createFileTreeSsrPayload returns an id and shadow HTML containing the expected wrapper', () => {
    const payload = createFileTreeSsrPayload({
      files: ['README.md', 'src/index.ts'],
    });

    expect(payload.id).toMatch(/^ft_srv_/);
    expect(payload.shadowHtml).toContain('data-file-tree-style');
    expect(payload.shadowHtml).toContain(`data-file-tree-id="${payload.id}"`);
  });

  test('ensureFileTreeStyles adopts styles and removes SSR inline <style> marker when supported', () => {
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // Simulate declarative shadow DOM markup.
    shadowRoot.innerHTML =
      '<style data-file-tree-style>/* css */</style><div>content</div>';

    // Pretend adoptedStyleSheets is supported.
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      value: [],
      writable: true,
    });

    ensureFileTreeStyles(shadowRoot);

    expect(shadowRoot.querySelector('style[data-file-tree-style]')).toBeNull();
    expect(
      (shadowRoot as unknown as { adoptedStyleSheets: unknown[] })
        .adoptedStyleSheets
    ).toHaveLength(1);
  });

  test('adoptDeclarativeShadowDom moves template content into shadowRoot when not parsed by the browser', () => {
    const host = document.createElement('file-tree-container');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    host.innerHTML =
      '<template shadowrootmode="open"><div data-file-tree-id="x">ok</div></template>';

    adoptDeclarativeShadowDom(host, shadowRoot);
    expect(host.querySelector('template[shadowrootmode="open"]')).toBeNull();
    expect(
      shadowRoot.querySelector('[data-file-tree-id="x"]')?.textContent
    ).toBe('ok');
  });

  test('FileTree.hydrate uses existing SSR wrapper and calls hydrateRoot (not renderRoot)', () => {
    const payload = createFileTreeSsrPayload({
      files: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
    });

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
      const ft = new FileTree({ files: ['README.md', 'src/index.ts'] });
      ft.hydrate({ fileTreeContainer: container });
      expect(ft.__id).toBe(payload.id);
      expect(hydrated).toBe(1);
      expect(rendered).toBe(0);
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
      preactRenderer.renderRoot = origRender;
    }
  });

  test('FileTree.hydrate falls back to renderRoot when no SSR wrapper is found', () => {
    const container = document.createElement('file-tree-container');
    if (container.shadowRoot == null) {
      container.attachShadow({ mode: 'open' });
    }

    const warn = console.warn;
    let warned = 0;
    console.warn = () => {
      warned += 1;
    };

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
      const ft = new FileTree({ files: ['README.md', 'src/index.ts'] });
      ft.hydrate({ fileTreeContainer: container });
      expect(hydrated).toBe(0);
      expect(rendered).toBe(1);
      expect(warned).toBe(1);
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
      preactRenderer.renderRoot = origRender;
      console.warn = warn;
    }
  });
});
