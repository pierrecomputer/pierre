import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { serializeFileTreeSsrPayload } from '../src/ssr';
import { flushDom, installDom } from './helpers/dom';

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

describe('file-tree icon config', () => {
  test('preloadFileTree includes custom sprite sheets and colored icon attrs', async () => {
    const { preloadFileTree } = await import('../src/render/FileTree');

    const payload = preloadFileTree({
      flattenEmptyDirectories: true,
      icons: {
        set: 'complete',
        colored: true,
        spriteSheet:
          '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-readme" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor" /></symbol></svg>',
      },
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 120 / 30,
    });

    expect(payload.shadowHtml).toContain('pst-test-readme');
    expect(payload.shadowHtml).toContain('data-file-tree-colored-icons="true"');
  });

  test('renders file icon remaps by file name', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
        initialVisibleRowCount: 120 / 30,
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

  test('remap[file-tree-icon-file] overrides the default built-in fallback when set is complete', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        icons: {
          set: 'complete',
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-generic-file" viewBox="0 0 16 16"><rect width="16" height="16" fill="currentColor" /></symbol></svg>',
          remap: {
            'file-tree-icon-file': 'pst-test-generic-file',
          },
        },
        initialExpansion: 'open',
        paths: ['unknown.xyz', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Unknown extension has no specific built-in token — remap should win
      // over the generic 'default' fallback.
      const unknownButton = getItemButton(shadowRoot, dom, 'unknown.xyz');
      expect(unknownButton.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-generic-file'
      );

      // Known extension has a specific built-in token — remap must not
      // override it.
      const tsButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      expect(tsButton.querySelector('use')?.getAttribute('href')).toBe(
        '#file-tree-builtin-typescript'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('remap[file-tree-icon-file] overrides the default built-in fallback when set is standard', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        icons: {
          set: 'standard',
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-generic-file" viewBox="0 0 16 16"><rect width="16" height="16" fill="currentColor" /></symbol></svg>',
          remap: {
            'file-tree-icon-file': 'pst-test-generic-file',
          },
        },
        initialExpansion: 'open',
        paths: ['unknown.xyz', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // Unknown extension resolves to the generic 'default' token in the
      // standard tier as well — remap must win over that placeholder.
      const unknownButton = getItemButton(shadowRoot, dom, 'unknown.xyz');
      expect(unknownButton.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-generic-file'
      );

      // A known standard-tier extension keeps its specific built-in token.
      const tsButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      expect(tsButton.querySelector('use')?.getAttribute('href')).toBe(
        '#file-tree-builtin-typescript'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('remap[file-tree-icon-file] remains the fallback when set is minimal', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        icons: {
          set: 'minimal',
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-generic-file" viewBox="0 0 16 16"><rect width="16" height="16" fill="currentColor" /></symbol></svg>',
          remap: {
            'file-tree-icon-file': 'pst-test-generic-file',
          },
        },
        initialExpansion: 'open',
        paths: ['unknown.xyz', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      // The minimal set never resolves a built-in file token, so every file
      // falls through to remap['file-tree-icon-file'].
      const unknownButton = getItemButton(shadowRoot, dom, 'unknown.xyz');
      expect(unknownButton.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-generic-file'
      );

      const tsButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      expect(tsButton.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-generic-file'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('setIcons swaps icon modes without resetting expanded state', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        icons: 'complete',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        initialVisibleRowCount: 120 / 30,
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
      const { FileTree, preloadFileTree } =
        await import('../src/render/FileTree');

      const payload = preloadFileTree({
        flattenEmptyDirectories: true,
        icons: 'complete',
        id: 'pst-hydrate-icons',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
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
        flattenEmptyDirectories: true,
        icons: 'complete',
        id: 'pst-hydrate-icons',
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts', 'src/lib/utils.ts'],
        initialVisibleRowCount: 120 / 30,
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
