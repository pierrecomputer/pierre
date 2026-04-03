import { beforeAll, describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

import {
  remapExpandedPathsForFolderRename,
  renameFileTreePaths,
} from '../src/utils/renameFileTreePaths';

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
    HTMLStyleElement: dom.window.HTMLStyleElement,
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

const FILE_TYPE_CUSTOM_SPRITE = `
<svg>
  <symbol id="custom-default" viewBox="0 0 12 12">
    <rect x="0" y="0" width="12" height="12" />
  </symbol>
  <symbol id="custom-package" viewBox="0 0 12 12">
    <circle cx="6" cy="6" r="6" />
  </symbol>
  <symbol id="custom-ts" viewBox="0 0 12 12">
    <path d="M1 1h10v10H1z" />
  </symbol>
  <symbol id="custom-spec-ts" viewBox="0 0 12 12">
    <path d="M1 1h10v10H1zM3 3h6v6H3z" />
  </symbol>
  <symbol id="custom-gitignore" viewBox="0 0 12 12">
    <path d="M1 6h10" />
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

  test('preloadFileTree omits the built-in search input by default', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts'],
    });

    expect(payload.shadowHtml).not.toContain('data-file-tree-search-input');
    expect(payload.shadowHtml).not.toContain('data-file-tree-search-container');
  });

  test('preloadFileTree includes the built-in search input when enabled', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts'],
      search: true,
    });

    expect(payload.shadowHtml).toContain('data-file-tree-search-input');
    expect(payload.shadowHtml).toContain('data-file-tree-search-container');
  });

  test('preloadFileTree includes unsafeCSS when provided', () => {
    const payload = preloadFileTree({
      initialFiles: ['README.md', 'src/index.ts'],
      unsafeCSS: `[data-item-section="content"] { color: hotpink; }`,
    });

    expect(payload.shadowHtml).toContain('data-file-tree-unsafe-css');
    expect(payload.shadowHtml).toContain('@layer unsafe');
    expect(payload.shadowHtml).toContain('color: hotpink');
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

  test('preloadFileTree remaps file icons by file name and extension', () => {
    const payload = preloadFileTree({
      initialFiles: [
        'package.json',
        'index.ts',
        'widget.spec.ts',
        '.gitignore',
        'README.md',
      ],
      icons: {
        spriteSheet: FILE_TYPE_CUSTOM_SPRITE,
        remap: {
          'file-tree-icon-file': 'custom-default',
        },
        byFileName: {
          'package.json': 'custom-package',
          '.gitignore': 'custom-gitignore',
        },
        byFileExtension: {
          ts: 'custom-ts',
          'spec.ts': 'custom-spec-ts',
        },
      },
    });

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    const wrapper = shadowRoot.querySelector(
      `[data-file-tree-id="${payload.id}"]`
    );
    expect(wrapper).not.toBeNull();
    if (wrapper == null) {
      throw new Error('Expected file-tree wrapper in shadow DOM');
    }

    const getIconHref = (fileName: string): string => {
      const button = Array.from(
        wrapper.querySelectorAll('button[data-type="item"]')
      ).find((item) => item.getAttribute('aria-label') === fileName);
      expect(button).not.toBeUndefined();
      if (button == null) {
        throw new Error(`Expected file row for ${fileName}`);
      }
      const useNode = button.querySelector('div[data-item-section="icon"] use');
      const href = useNode?.getAttribute('href');
      expect(href).not.toBeNull();
      if (href == null) {
        throw new Error(`Expected icon for ${fileName}`);
      }
      return href;
    };

    expect(getIconHref('package.json')).toBe('#custom-package');
    expect(getIconHref('index.ts')).toBe('#custom-ts');
    expect(getIconHref('widget.spec.ts')).toBe('#custom-spec-ts');
    expect(getIconHref('.gitignore')).toBe('#custom-gitignore');
    expect(getIconHref('README.md')).toBe('#custom-default');
  });

  test('preloadFileTree uses the complete icon set when icons are unset', () => {
    const payload = preloadFileTree({
      initialFiles: [
        'package.json',
        'index.ts',
        'app.tsx',
        'card.module.css',
        'README.md',
        'image.png',
        'agent.mcp',
      ],
    });

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    const wrapper = shadowRoot.querySelector(
      `[data-file-tree-id="${payload.id}"]`
    );
    expect(wrapper).not.toBeNull();
    if (wrapper == null) {
      throw new Error('Expected file-tree wrapper in shadow DOM');
    }

    const getIconHref = (fileName: string): string => {
      const button = Array.from(
        wrapper.querySelectorAll('button[data-type="item"]')
      ).find((item) => item.getAttribute('aria-label') === fileName);
      expect(button).not.toBeUndefined();
      if (button == null) {
        throw new Error(`Expected file row for ${fileName}`);
      }
      const useNode = button.querySelector('div[data-item-section="icon"] use');
      const href = useNode?.getAttribute('href');
      expect(href).not.toBeNull();
      if (href == null) {
        throw new Error(`Expected icon for ${fileName}`);
      }
      return href;
    };

    expect(getIconHref('package.json')).toBe('#file-tree-builtin-json');
    expect(getIconHref('index.ts')).toBe('#file-tree-builtin-typescript');
    expect(getIconHref('app.tsx')).toBe('#file-tree-builtin-react');
    expect(getIconHref('card.module.css')).toBe('#file-tree-builtin-css');
    expect(getIconHref('README.md')).toBe('#file-tree-builtin-markdown');
    expect(getIconHref('image.png')).toBe('#file-tree-builtin-image');
    expect(getIconHref('agent.mcp')).toBe('#file-tree-builtin-mcp');
  });

  test('preloadFileTree uses the minimal icon set when requested', () => {
    const payload = preloadFileTree({
      initialFiles: ['package.json', 'index.ts', 'app.tsx'],
      icons: 'minimal',
    });

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    const wrapper = shadowRoot.querySelector(
      `[data-file-tree-id="${payload.id}"]`
    );
    expect(wrapper).not.toBeNull();
    if (wrapper == null) {
      throw new Error('Expected file-tree wrapper in shadow DOM');
    }

    const iconHrefs = Array.from(
      wrapper.querySelectorAll('button[data-type="item"] use')
    ).map((node) => node.getAttribute('href'));

    expect(iconHrefs).toEqual([
      '#file-tree-icon-file',
      '#file-tree-icon-file',
      '#file-tree-icon-file',
    ]);
  });

  test('preloadFileTree uses the standard icon set when requested', () => {
    const payload = preloadFileTree({
      initialFiles: [
        'package.json',
        'index.ts',
        'app.tsx',
        'card.module.css',
        'README.md',
        'image.png',
        'agent.mcp',
      ],
      icons: 'standard',
    });

    const container = document.createElement('file-tree-container');
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = payload.shadowHtml;

    const wrapper = shadowRoot.querySelector(
      `[data-file-tree-id="${payload.id}"]`
    );
    expect(wrapper).not.toBeNull();
    if (wrapper == null) {
      throw new Error('Expected file-tree wrapper in shadow DOM');
    }

    const getIconHref = (fileName: string): string => {
      const button = Array.from(
        wrapper.querySelectorAll('button[data-type="item"]')
      ).find((item) => item.getAttribute('aria-label') === fileName);
      expect(button).not.toBeUndefined();
      if (button == null) {
        throw new Error(`Expected file row for ${fileName}`);
      }
      const useNode = button.querySelector('div[data-item-section="icon"] use');
      const href = useNode?.getAttribute('href');
      expect(href).not.toBeNull();
      if (href == null) {
        throw new Error(`Expected icon for ${fileName}`);
      }
      return href;
    };

    expect(getIconHref('package.json')).toBe('#file-tree-builtin-json');
    expect(getIconHref('index.ts')).toBe('#file-tree-builtin-typescript');
    expect(getIconHref('app.tsx')).toBe('#file-tree-builtin-typescript');
    expect(getIconHref('card.module.css')).toBe('#file-tree-builtin-css');
    expect(getIconHref('README.md')).toBe('#file-tree-builtin-markdown');
    expect(getIconHref('image.png')).toBe('#file-tree-builtin-image');
    expect(getIconHref('agent.mcp')).toBe('#file-tree-builtin-mcp');
  });

  test('setOptions swaps built-in icon sets and colored mode at runtime', () => {
    const container = document.createElement('file-tree-container');
    const ft = new FileTree({
      initialFiles: ['index.ts'],
      icons: 'minimal',
    });

    const origRender = preactRenderer.renderRoot;
    preactRenderer.renderRoot = () => {};
    try {
      ft.render({ fileTreeContainer: container });

      const shadowRoot = container.shadowRoot;
      const wrapper = shadowRoot?.querySelector(
        '[data-file-tree-id]'
      ) as HTMLElement | null;
      expect(wrapper).not.toBeNull();
      expect(
        shadowRoot?.querySelector('#file-tree-builtin-typescript')
      ).toBeNull();
      expect(wrapper?.dataset.fileTreeColoredIcons).toBeUndefined();

      ft.setOptions({
        icons: {
          set: 'complete',
          colored: true,
        },
      });

      expect(
        shadowRoot?.querySelector('#file-tree-builtin-typescript')
      ).not.toBeNull();
      expect(wrapper?.dataset.fileTreeColoredIcons).toBe('true');
    } finally {
      preactRenderer.renderRoot = origRender;
    }
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

  test('folder rename remaps expanded subtree paths', () => {
    const result = renameFileTreePaths({
      files: ['src/index.ts', 'src/components/Button.tsx'],
      path: 'src',
      isFolder: true,
      nextBasename: 'source',
    });
    expect('error' in result).toBe(false);
    if ('error' in result) {
      return;
    }

    const nextExpanded = remapExpandedPathsForFolderRename({
      expandedPaths: ['src', 'src/components'],
      sourcePath: result.sourcePath,
      destinationPath: result.destinationPath,
    });

    expect(result.nextFiles).toContain('source/index.ts');
    expect(result.nextFiles).toContain('source/components/Button.tsx');
    expect(nextExpanded).toContain('source');
    expect(nextExpanded).toContain('source/components');
    expect(nextExpanded).not.toContain('src');
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

  test('render injects unsafeCSS into the shadow root and keeps it in sync', () => {
    const container = document.createElement('file-tree-container');
    const ft = new FileTree({
      initialFiles: ['README.md', 'src/index.ts'],
      unsafeCSS: `[data-item-section="content"] { color: hotpink; }`,
    });

    ft.render({ fileTreeContainer: container });

    const initialStyle = container.shadowRoot?.querySelector(
      'style[data-file-tree-unsafe-css]'
    );
    expect(initialStyle?.textContent).toContain('color: hotpink');
    expect(initialStyle?.textContent).toContain('@layer unsafe');

    ft.setOptions({
      unsafeCSS: `[data-item-section="content"] { color: lime; }`,
    });

    const updatedStyle = container.shadowRoot?.querySelector(
      'style[data-file-tree-unsafe-css]'
    );
    expect(updatedStyle?.textContent).toContain('color: lime');

    ft.setOptions({ unsafeCSS: '' });
    expect(
      container.shadowRoot?.querySelector('style[data-file-tree-unsafe-css]')
    ).toBeNull();
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
