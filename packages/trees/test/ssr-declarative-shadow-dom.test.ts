import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

let FileTree: typeof import('../src/FileTree').FileTree;
let preloadFileTree: typeof import('../src/ssr/preloadFileTree').preloadFileTree;
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
  ({ preloadFileTree } = await import('../src/ssr/preloadFileTree'));
  ({ ensureFileTreeStyles, adoptDeclarativeShadowDom } =
    await import('../src/components/web-components'));
  ({ preactRenderer } = await import('../src/utils/preactRenderer'));
});

const CUSTOM_SPRITE_A = `
<svg>
  <symbol id="custom-a" viewBox="0 0 12 12">
    <circle cx="6" cy="6" r="6" />
  </symbol>
</svg>
`;

const CUSTOM_SPRITE_B = `
<svg>
  <symbol id="custom-b" viewBox="0 0 12 12">
    <rect x="0" y="0" width="12" height="12" />
  </symbol>
</svg>
`;

describe('SSR + declarative shadow DOM', () => {
  test('preloadFileTree returns an id and shadow HTML containing the expected wrapper', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts'],
    });

    expect(payload.id).toMatch(/^ft_srv_/);
    expect(payload.shadowHtml).toContain('data-file-tree-style');
    expect(payload.shadowHtml).toContain(`data-file-tree-id="${payload.id}"`);
    expect(payload.html).toContain(`<file-tree-container id="${payload.id}">`);
    expect(payload.html).toContain('<template shadowrootmode="open">');
    expect(payload.html).toContain(payload.shadowHtml);
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
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts', 'src/components/Button.tsx'],
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
      const ft = new FileTree({ initialFiles: ['README.md', 'src/index.ts'] });
      ft.hydrate({ fileTreeContainer: container });
      expect(ft.__id).toBe(payload.id);
      expect(hydrated).toBe(1);
      expect(rendered).toBe(0);
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
      preactRenderer.renderRoot = origRender;
    }
  });

  test('FileTree.hydrate patches draggable on SSR items when DnD is enabled', () => {
    const ssrId = 'ft_ssr_dnd_test';

    // Simulate SSR-rendered shadow DOM content (without draggable, since
    // the server renders without DnD).
    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <div data-file-tree-id="${ssrId}">
        <div>
          <button data-type="item" data-item-type="file">README.md</button>
          <button data-type="item" data-item-type="folder">src</button>
          <button data-type="item" data-item-type="file">index.ts</button>
        </div>
      </div>
    `;

    // Verify SSR buttons do NOT have draggable
    const wrapper = shadowRoot.querySelector(
      `[data-file-tree-id="${ssrId}"]`
    ) as HTMLElement;
    const buttonsBefore = wrapper.querySelectorAll('button[data-type="item"]');
    expect(buttonsBefore.length).toBe(3);
    for (const btn of buttonsBefore) {
      expect((btn as HTMLElement).draggable).toBe(false);
    }

    const origHydrate = preactRenderer.hydrateRoot;
    const origRender = preactRenderer.renderRoot;
    preactRenderer.hydrateRoot = () => {};
    preactRenderer.renderRoot = () => {};

    try {
      // Client creates FileTree WITH dragAndDrop and hydrates
      const ft = new FileTree({
        initialFiles: ['README.md', 'src/index.ts'],
        dragAndDrop: true,
        id: ssrId,
      });
      ft.hydrate({ fileTreeContainer: container });

      // After hydration, all item buttons should have draggable patched
      const buttonsAfter = wrapper.querySelectorAll('button[data-type="item"]');
      expect(buttonsAfter.length).toBe(3);
      for (const btn of buttonsAfter) {
        expect((btn as HTMLElement).draggable).toBe(true);
      }
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
      preactRenderer.renderRoot = origRender;
    }
  });

  test('getFiles returns initialFiles from constructor', () => {
    const files = ['README.md', 'src/index.ts'];
    const ft = new FileTree({ initialFiles: files });
    expect(ft.getFiles()).toEqual(files);
  });

  test('setFiles updates getFiles return value', () => {
    const ft = new FileTree({ initialFiles: ['a.txt'] });
    const newFiles = ['b.txt', 'c.txt'];
    ft.setFiles(newFiles);
    expect(ft.getFiles()).toEqual(newFiles);
  });

  test('setOptions with state.files delegates to setFiles', () => {
    const ft = new FileTree({ initialFiles: ['a.txt'] });
    ft.setOptions({}, { files: ['b.txt'] });
    expect(ft.getFiles()).toEqual(['b.txt']);
  });

  test('setOptions applies state.files when structural options also change', () => {
    const ft = new FileTree({ initialFiles: ['a.txt'] });
    ft.setOptions({ flattenEmptyDirectories: true }, { files: ['b.txt'] });
    expect(ft.getFiles()).toEqual(['b.txt']);
  });

  test('setOptions applies fileTreeSearchMode changes at runtime', () => {
    const ft = new FileTree({
      initialFiles: ['a.txt'],
      fileTreeSearchMode: 'expand-matches',
    });

    let rerenders = 0;
    (
      ft as unknown as {
        rerender: () => void;
      }
    ).rerender = () => {
      rerenders += 1;
    };

    ft.setOptions({ fileTreeSearchMode: 'hide-non-matches' });
    expect(rerenders).toBe(1);
  });

  test('setOptions applies icons changes at runtime', () => {
    const ft = new FileTree({ initialFiles: ['a.txt'] });

    let rerenders = 0;
    (
      ft as unknown as {
        rerender: () => void;
      }
    ).rerender = () => {
      rerenders += 1;
    };

    ft.setOptions({
      icons: {
        spriteSheet: CUSTOM_SPRITE_A,
        remap: {
          'file-tree-icon-file': 'custom-a',
        },
      },
    });
    expect(rerenders).toBe(1);
  });

  test('render + setOptions keep virtualized layout attributes in sync', () => {
    const container = document.createElement('file-tree-container');
    const ft = new FileTree({
      initialFiles: ['README.md'],
      virtualize: { threshold: 0 },
    });

    const origRender = preactRenderer.renderRoot;
    preactRenderer.renderRoot = () => {};
    try {
      ft.render({ fileTreeContainer: container });

      const wrapper = container.shadowRoot?.querySelector(
        '[data-file-tree-id]'
      ) as HTMLElement | null;
      expect(wrapper).not.toBeNull();
      if (wrapper == null) {
        throw new Error('Expected file-tree wrapper in shadow DOM');
      }
      expect(container.dataset.fileTreeVirtualized).toBe('true');
      expect(wrapper.dataset.fileTreeVirtualizedWrapper).toBe('true');

      ft.setOptions({ virtualize: false });
      expect(container.dataset.fileTreeVirtualized).toBeUndefined();
      expect(wrapper.dataset.fileTreeVirtualizedWrapper).toBeUndefined();
    } finally {
      preactRenderer.renderRoot = origRender;
    }
  });

  test('hydrate applies virtualized layout attributes when enabled client-side', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md'],
    });
    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    const origHydrate = preactRenderer.hydrateRoot;
    preactRenderer.hydrateRoot = () => {};
    try {
      const ft = new FileTree({
        id: payload.id,
        initialFiles: ['README.md'],
        virtualize: { threshold: 0 },
      });
      ft.hydrate({ fileTreeContainer: container });

      const wrapper = container.shadowRoot?.querySelector(
        '[data-file-tree-id]'
      ) as HTMLElement | null;
      expect(wrapper).not.toBeNull();
      if (wrapper == null) {
        throw new Error('Expected file-tree wrapper in shadow DOM');
      }
      expect(container.dataset.fileTreeVirtualized).toBe('true');
      expect(wrapper.dataset.fileTreeVirtualizedWrapper).toBe('true');
    } finally {
      preactRenderer.hydrateRoot = origHydrate;
    }
  });

  test('setOptions swaps custom sprite sheets at runtime', () => {
    const container = document.createElement('file-tree-container');
    const ft = new FileTree({
      initialFiles: ['README.md'],
      icons: {
        spriteSheet: CUSTOM_SPRITE_A,
        remap: {
          'file-tree-icon-file': 'custom-a',
        },
      },
    });

    const origRender = preactRenderer.renderRoot;
    preactRenderer.renderRoot = () => {};
    try {
      ft.render({ fileTreeContainer: container });

      const shadowRoot = container.shadowRoot;
      expect(shadowRoot).not.toBeNull();
      const getTopLevelSpriteCount = () =>
        Array.from(shadowRoot?.children ?? []).filter(
          (element) => element instanceof SVGElement
        ).length;
      expect(getTopLevelSpriteCount()).toBe(2);
      expect(shadowRoot?.querySelector('#custom-a')).not.toBeNull();

      ft.setOptions({
        icons: {
          spriteSheet: CUSTOM_SPRITE_B,
          remap: {
            'file-tree-icon-file': 'custom-b',
          },
        },
      });

      expect(getTopLevelSpriteCount()).toBe(2);
      expect(shadowRoot?.querySelector('#custom-a')).toBeNull();
      expect(shadowRoot?.querySelector('#custom-b')).not.toBeNull();
    } finally {
      preactRenderer.renderRoot = origRender;
    }
  });

  test('setOptions removes custom sprite sheet when icons are unset', () => {
    const container = document.createElement('file-tree-container');
    const ft = new FileTree({
      initialFiles: ['README.md'],
      icons: {
        spriteSheet: CUSTOM_SPRITE_A,
        remap: {
          'file-tree-icon-file': 'custom-a',
        },
      },
    });

    const origRender = preactRenderer.renderRoot;
    preactRenderer.renderRoot = () => {};
    try {
      ft.render({ fileTreeContainer: container });

      const shadowRoot = container.shadowRoot;
      const getTopLevelSpriteCount = () =>
        Array.from(shadowRoot?.children ?? []).filter(
          (element) => element instanceof SVGElement
        ).length;
      expect(getTopLevelSpriteCount()).toBe(2);
      expect(shadowRoot?.querySelector('#custom-a')).not.toBeNull();

      ft.setOptions({ icons: undefined });

      expect(getTopLevelSpriteCount()).toBe(1);
      expect(shadowRoot?.querySelector('#custom-a')).toBeNull();
    } finally {
      preactRenderer.renderRoot = origRender;
    }
  });

  test('preloadFileTree includes custom sprite sheets without requiring marker attrs', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md'],
      icons: {
        spriteSheet: CUSTOM_SPRITE_A,
        remap: {
          'file-tree-icon-file': 'custom-a',
        },
      },
    });

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    expect(shadowRoot.querySelectorAll('svg[data-icon-sprite]')).toHaveLength(
      1
    );
    expect(shadowRoot.querySelector('#custom-a')).not.toBeNull();
    expect(payload.shadowHtml).toContain('<symbol id="custom-a"');
  });

  test('preloadFileTree supports virtualized empty trees', () => {
    expect(() =>
      preloadFileTree({
        initialFiles: [],
        virtualize: { threshold: 0 },
      })
    ).not.toThrow();
  });

  test('setFiles invokes onFilesChange callback', () => {
    const calls: string[][] = [];
    const ft = new FileTree(
      { initialFiles: ['a.txt'] },
      { onFilesChange: (files) => calls.push(files) }
    );

    ft.setFiles(['b.txt', 'c.txt']);
    expect(calls).toEqual([['b.txt', 'c.txt']]);
  });

  test('setOptions with state.files invokes onFilesChange callback', () => {
    const calls: string[][] = [];
    const ft = new FileTree(
      { initialFiles: ['a.txt'] },
      { onFilesChange: (files) => calls.push(files) }
    );

    ft.setOptions({ flattenEmptyDirectories: true }, { files: ['b.txt'] });
    expect(calls).toEqual([['b.txt']]);
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
      const ft = new FileTree({ initialFiles: ['README.md', 'src/index.ts'] });
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
