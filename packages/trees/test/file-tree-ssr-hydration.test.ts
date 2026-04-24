import { describe, expect, test } from 'bun:test';

import { serializeFileTreeSsrPayload } from '../src/ssr';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadPreloadFileTree } from './helpers/loadFileTree';
import {
  getFocusedItemPath,
  getItemButton,
  getSelectedItemPaths,
  getUnsafeCssStyle,
} from './helpers/renderHarness';

describe('file-tree SSR and hydration', () => {
  test('preloadFileTree returns SSR-safe initial html', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      initialVisibleRowCount: 120 / 30,
    });

    const parserHtml = serializeFileTreeSsrPayload(payload);
    const domHtml = serializeFileTreeSsrPayload(payload, 'dom');
    expect(parserHtml).toContain('<file-tree-container');
    expect(parserHtml).toContain('template shadowrootmode="open"');
    expect(domHtml).toContain('data-file-tree-shadowrootmode="open"');
    expect(domHtml).not.toContain('template shadowrootmode="open"');
    expect(payload.shadowHtml).toContain(
      'data-file-tree-virtualized-root="true"'
    );
    expect(payload.shadowHtml).not.toContain(
      'data-file-tree-sticky-overlay="true"'
    );
    expect(payload.shadowHtml).toContain('README.md');
  });

  test('preloadFileTree includes initial selected row attributes', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      initialSelectedPaths: ['README.md'],
      paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
      initialVisibleRowCount: 120 / 30,
    });

    expect(payload.shadowHtml).toMatch(
      /aria-selected="true"[^>]*data-item-path="README\.md"[^>]*data-item-selected="true"/
    );
  });

  test('initialSelectedPaths preserve selected and focused state through preload and hydrate', async () => {
    const { cleanup, dom } = installDom();
    try {
      const preloadFileTree = await loadPreloadFileTree();
      const FileTree = await loadFileTree();
      const options = {
        flattenEmptyDirectories: false,
        id: 'pst-hydrate-initial-selection',
        initialExpansion: 'open',
        initialSelectedPaths: ['a.ts', 'c.ts'],
        paths: ['a.ts', 'b.ts', 'c.ts'],
        initialVisibleRowCount: 120 / 30,
      } satisfies ConstructorParameters<typeof FileTree>[0];
      const payload = preloadFileTree(options);

      expect(payload.shadowHtml).toMatch(
        /aria-selected="true"[^>]*data-item-path="a\.ts"[^>]*data-item-selected="true"/
      );
      expect(payload.shadowHtml).toMatch(
        /aria-selected="true"[^>]*data-item-path="c\.ts"[^>]*data-item-selected="true"/
      );
      expect(payload.shadowHtml).toMatch(
        /data-item-path="c\.ts"[^>]*tabindex="0"/
      );

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const fileTree = new FileTree(options);
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      expect(fileTree.getSelectedPaths()).toEqual(['a.ts', 'c.ts']);
      expect(fileTree.getFocusedPath()).toBe('c.ts');
      expect(getSelectedItemPaths(host.shadowRoot, dom)).toEqual([
        'a.ts',
        'c.ts',
      ]);
      expect(getFocusedItemPath(host.shadowRoot, dom)).toBe('c.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('render injects wrapped unsafeCSS into the shadow root', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        paths: ['README.md'],
        unsafeCSS: '[data-item-path="README.md"] { color: rgb(255 0 0); }',
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const unsafeStyle = getUnsafeCssStyle(
        fileTree.getFileTreeContainer()?.shadowRoot,
        dom
      );
      expect(unsafeStyle).not.toBeNull();
      expect(unsafeStyle?.textContent).toContain('@layer unsafe');
      expect(unsafeStyle?.textContent).toContain('color: rgb(255 0 0);');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree and hydrate keep one wrapped unsafeCSS style element', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const preloadFileTree = await loadPreloadFileTree();
      const options = {
        flattenEmptyDirectories: true,
        id: 'pst-unsafe-css-hydration',
        paths: ['README.md'],
        unsafeCSS: 'button[data-type="item"] { color: rgb(255 0 0); }',
        initialVisibleRowCount: 120 / 30,
      } satisfies ConstructorParameters<typeof FileTree>[0];
      const payload = preloadFileTree(options);

      expect(payload.shadowHtml).toContain('data-file-tree-unsafe-css');
      expect(payload.shadowHtml).toContain('@layer unsafe');

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      expect(
        payload.shadowHtml.match(/data-file-tree-unsafe-css/g)?.length ?? 0
      ).toBe(1);

      const fileTree = new FileTree(options);
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      expect(
        host.shadowRoot?.querySelectorAll('style[data-file-tree-unsafe-css]')
          .length
      ).toBe(1);
      const unsafeStyle = getUnsafeCssStyle(host.shadowRoot, dom);
      expect(unsafeStyle?.textContent).toContain('@layer unsafe');
      expect(unsafeStyle?.textContent).toContain('color: rgb(255 0 0);');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree escapes unsafeCSS before embedding SSR styles', async () => {
    const preloadFileTree = await loadPreloadFileTree();
    const payload = preloadFileTree({
      paths: ['README.md'],
      unsafeCSS:
        'button[data-type="item"]::after { content: "</style><div data-escape-break></div>"; }',
      initialVisibleRowCount: 120 / 30,
    });

    expect(payload.shadowHtml).toContain('<\\/style><div data-escape-break');
    expect(payload.shadowHtml).not.toContain('</style><div data-escape-break');
  });
  test('preloadFileTree sorts unsorted top-level entries before files and keeps root chains flattened', async () => {
    const preloadFileTree = await loadPreloadFileTree();

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      paths: [
        'README.md',
        'package.json',
        'assets/images/social/logo.png',
        'assets/images/social/banner.png',
        'docs/guides/getting-started.md',
        'docs/guides/faq.md',
        'src/index.ts',
        'src/lib/utils.ts',
        'src/lib/theme.ts',
        'src/components/Button.tsx',
      ],
      initialVisibleRowCount: 460 / 30,
    });

    expect(
      Array.from(
        payload.shadowHtml.matchAll(/data-item-path="([^"]+)"/g),
        (match) => match[1] ?? ''
      ).filter((path) => path.length > 0)
    ).toEqual([
      'assets/images/social/',
      'docs/guides/',
      'src/',
      'package.json',
      'README.md',
    ]);
  });

  test('hydration keeps row content aligned with row paths for unsorted raw input', async () => {
    const { cleanup, dom } = installDom();
    try {
      const FileTree = await loadFileTree();
      const preloadFileTree = await loadPreloadFileTree();

      const unsortedPaths = [
        'README.md',
        'package.json',
        'assets/images/social/logo.png',
        'assets/images/social/banner.png',
        'docs/guides/getting-started.md',
        'docs/guides/faq.md',
        'src/index.ts',
        'src/lib/utils.ts',
        'src/lib/theme.ts',
        'src/components/Button.tsx',
      ] as const;
      const options = {
        dragAndDrop: true,
        flattenEmptyDirectories: true,
        id: 'pst-hydrate-shape',
        initialExpandedPaths: [
          'assets/images/social/',
          'docs/guides/',
          'src/',
          'src/lib/',
        ],
        paths: unsortedPaths,
        initialVisibleRowCount: 460 / 30,
      } satisfies ConstructorParameters<typeof FileTree>[0];
      const payload = preloadFileTree(options);

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const ssrPaths = Array.from(
        payload.shadowHtml.matchAll(/data-item-path="([^"]+)"/g),
        (match) => match[1] ?? ''
      ).filter((path) => path.length > 0);

      const fileTree = new FileTree(options);
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const shadowRoot = host.shadowRoot;
      const hydratedPaths = Array.from(
        shadowRoot?.querySelectorAll('button[data-type="item"]') ?? []
      )
        .filter(
          (button): button is HTMLButtonElement =>
            button instanceof dom.window.HTMLButtonElement
        )
        .map((button) => button.dataset.itemPath)
        .filter((path): path is string => path != null);
      const getContentText = (path: string): string =>
        getItemButton(shadowRoot, dom, path)
          .querySelector('[data-item-section="content"]')
          ?.textContent?.replaceAll(/\s+/g, ' ')
          .trim() ?? '';

      expect(hydratedPaths).toEqual(ssrPaths);
      expect(getContentText('README.md')).toContain('README');
      expect(getContentText('README.md')).not.toContain('assets');
      expect(getContentText('package.json')).toContain('package');
      expect(getContentText('package.json')).not.toContain('banner');
      const flattenedAssetsContent = getItemButton(
        shadowRoot,
        dom,
        'assets/images/social/'
      ).querySelector('[data-item-section="content"]');
      expect(getContentText('assets/images/social/')).toContain('assets');
      expect(getContentText('assets/images/social/')).toContain('social');
      expect(
        flattenedAssetsContent?.querySelector('[data-icon-name]')
      ).toBeNull();
      expect(
        getItemButton(shadowRoot, dom, 'README.md').querySelector(
          '[data-item-section="icon"] [data-icon-name]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
