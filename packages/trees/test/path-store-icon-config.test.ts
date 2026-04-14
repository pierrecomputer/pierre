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

describe('path-store icon config', () => {
  test('preloadPathStoreFileTree includes custom sprite sheets and colored icon attrs', async () => {
    const { preloadPathStoreFileTree } = await import('../src/path-store');

    const payload = preloadPathStoreFileTree({
      flattenEmptyDirectories: true,
      icons: {
        set: 'complete',
        colored: true,
        spriteSheet:
          '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-readme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /></symbol></svg>',
      },
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
      viewportHeight: 120,
    });

    expect(payload.shadowHtml).toContain('pst-test-readme');
    expect(payload.shadowHtml).toContain('data-file-tree-colored-icons="true"');
  });

  test('renders file icon remaps by file name', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: true,
        icons: {
          byFileName: {
            'readme.md': 'pst-test-readme',
          },
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-readme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /></symbol></svg>',
        },
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      const href = readmeButton.querySelector('use')?.getAttribute('href');

      expect(href).toBe('#pst-test-readme');
      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('falls back to built-in file icon tiers when overrides are absent', async () => {
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

  test('setIcons swaps icon modes without resetting expanded state', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree } = await import('../src/path-store');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new PathStoreFileTree({
        flattenEmptyDirectories: false,
        icons: 'complete',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        viewportHeight: 120,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const directoryItem = fileTree.getItem('src');
      if (
        directoryItem == null ||
        directoryItem.isDirectory() !== true ||
        !('collapse' in directoryItem)
      ) {
        throw new Error('expected src directory handle');
      }

      directoryItem.collapse();
      await flushDom();

      let shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        shadowRoot?.querySelector('[data-item-path="src/index.ts"]')
      ).toBeNull();

      fileTree.setIcons({
        byFileName: {
          'readme.md': 'pst-test-readme',
        },
        spriteSheet:
          '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-readme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /></symbol></svg>',
      });
      await flushDom();

      shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      expect(
        shadowRoot?.querySelector('[data-item-path="src/index.ts"]')
      ).toBeNull();

      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      expect(readmeButton.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-readme'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('hydrate reuses the existing SSR wrapper when the tree id matches', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { PathStoreFileTree, preloadPathStoreFileTree } =
        await import('../src/path-store');

      const payload = preloadPathStoreFileTree({
        flattenEmptyDirectories: true,
        icons: 'complete',
        id: 'pst-hydrate-icons',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
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
        flattenEmptyDirectories: true,
        icons: 'complete',
        id: 'pst-hydrate-icons',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        viewportHeight: 120,
      });

      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const shadowRoot = host.shadowRoot;
      const wrapperCountAfter = shadowRoot?.querySelectorAll(
        '[data-file-tree-virtualized-wrapper="true"]'
      ).length;
      const readmeButtons = shadowRoot?.querySelectorAll(
        '[data-item-path="README.md"]'
      ).length;

      expect(wrapperCountAfter).toBe(1);
      expect(readmeButtons).toBe(1);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
