import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { resolveFileTreeGitStatusState } from '../src/model/gitStatus';
import type { GitStatusEntry } from '../src/publicTypes';
import { serializeFileTreeSsrPayload } from '../src/ssr';
import { flushDom, installDom } from './helpers/dom';

const FILES = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Card.tsx',
  'src/utils/worker.ts',
  'src/utils/stream.ts',
  'test/index.test.ts',
] as const;

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

function getDecorationLabel(button: HTMLButtonElement): string | null {
  return (
    button
      .querySelector('[data-item-section="decoration"]')
      ?.textContent?.trim() ?? null
  );
}

function getGitLabel(button: HTMLButtonElement): string | null {
  return (
    button
      .querySelector('[data-item-section="git"] > span')
      ?.textContent?.trim() ?? null
  );
}

describe('file-tree git status', () => {
  test('later directory statuses clear stale ignored inheritance', () => {
    const state = resolveFileTreeGitStatusState([
      { path: 'src/', status: 'ignored' },
      { path: 'src/', status: 'modified' },
    ]);

    expect(state).not.toBeNull();
    expect(state?.statusByPath.get('src/')).toBe('modified');
    expect(state?.ignoredDirectoryPaths.has('src/')).toBe(false);
  });

  test('renders markers for all supported file git statuses and folder change attrs', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [
          { path: 'README.md', status: 'untracked' },
          { path: 'package.json', status: 'renamed' },
          { path: 'src/index.ts', status: 'modified' },
          { path: 'src/components/Button.tsx', status: 'added' },
          { path: 'src/components/Card.tsx', status: 'ignored' },
          { path: 'test/index.test.ts', status: 'deleted' },
        ],
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const readmeButton = getItemButton(shadowRoot, dom, 'README.md');
      const packageButton = getItemButton(shadowRoot, dom, 'package.json');
      const indexButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      const addedButton = getItemButton(
        shadowRoot,
        dom,
        'src/components/Button.tsx'
      );
      const ignoredButton = getItemButton(
        shadowRoot,
        dom,
        'src/components/Card.tsx'
      );
      const deletedButton = getItemButton(
        shadowRoot,
        dom,
        'test/index.test.ts'
      );
      const srcFolder = getItemButton(shadowRoot, dom, 'src/');

      expect(readmeButton.getAttribute('data-item-git-status')).toBe(
        'untracked'
      );
      expect(getGitLabel(readmeButton)).toBe('U');
      expect(packageButton.getAttribute('data-item-git-status')).toBe(
        'renamed'
      );
      expect(getGitLabel(packageButton)).toBe('R');
      expect(indexButton.getAttribute('data-item-git-status')).toBe('modified');
      expect(getGitLabel(indexButton)).toBe('M');
      expect(addedButton.getAttribute('data-item-git-status')).toBe('added');
      expect(getGitLabel(addedButton)).toBe('A');
      expect(ignoredButton.getAttribute('data-item-git-status')).toBe(
        'ignored'
      );
      expect(getGitLabel(ignoredButton)).toBeNull();
      expect(deletedButton.getAttribute('data-item-git-status')).toBe(
        'deleted'
      );
      expect(getGitLabel(deletedButton)).toBe('D');

      expect(srcFolder.getAttribute('data-item-contains-git-change')).toBe(
        'true'
      );
      expect(srcFolder.hasAttribute('data-item-git-status')).toBe(false);
      expect(
        srcFolder.querySelector(
          '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders explicit ignored directory statuses without a descendant dot', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [{ path: 'src/', status: 'ignored' }],
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const srcFolder = getItemButton(shadowRoot, dom, 'src/');
      expect(srcFolder.getAttribute('data-item-git-status')).toBe('ignored');
      expect(
        srcFolder.getAttribute('data-item-contains-git-change')
      ).toBeNull();
      expect(getGitLabel(srcFolder)).toBeNull();
      expect(
        srcFolder.querySelector(
          '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
        )
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('ignored directories tint descendants unless a child has its own status', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [
          { path: 'src/', status: 'ignored' },
          { path: 'src/index.ts', status: 'modified' },
        ],
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const srcFolder = getItemButton(shadowRoot, dom, 'src/');
      const cardButton = getItemButton(
        shadowRoot,
        dom,
        'src/components/Card.tsx'
      );
      const workerButton = getItemButton(
        shadowRoot,
        dom,
        'src/utils/worker.ts'
      );
      const indexButton = getItemButton(shadowRoot, dom, 'src/index.ts');

      expect(srcFolder.getAttribute('data-item-git-status')).toBe('ignored');
      expect(getGitLabel(srcFolder)).toBeNull();
      expect(cardButton.getAttribute('data-item-git-status')).toBe('ignored');
      expect(getGitLabel(cardButton)).toBeNull();
      expect(workerButton.getAttribute('data-item-git-status')).toBe('ignored');
      expect(getGitLabel(workerButton)).toBeNull();
      expect(indexButton.getAttribute('data-item-git-status')).toBe('modified');
      expect(getGitLabel(indexButton)).toBe('M');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('unknown leaf paths still mark known ancestor folders as changed', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [{ path: 'src/new-file.ts', status: 'added' }],
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const srcFolder = getItemButton(shadowRoot, dom, 'src/');
      expect(srcFolder.getAttribute('data-item-contains-git-change')).toBe(
        'true'
      );
      expect(
        srcFolder.querySelector(
          '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('flattened rows mark the rendered terminal directory instead of inventing a file status', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: true,
        gitStatus: [{ path: 'src/lib/util.ts', status: 'modified' }],
        initialExpandedPaths: ['src/'],
        paths: ['src/lib/util.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const flattenedFolder = getItemButton(shadowRoot, dom, 'src/lib/');

      expect(
        flattenedFolder.getAttribute('data-item-contains-git-change')
      ).toBe('true');
      expect(flattenedFolder.hasAttribute('data-item-git-status')).toBe(false);
      expect(
        flattenedFolder.querySelector(
          '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
        )
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('folder change dots keep the legacy 6px size and respect dot icon remaps', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [{ path: 'src/index.ts', status: 'modified' }],
        icons: {
          remap: {
            'file-tree-icon-dot': 'pst-test-dot',
          },
          spriteSheet:
            '<svg data-icon-sprite aria-hidden="true" width="0" height="0"><symbol id="pst-test-dot" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor" /></symbol></svg>',
        },
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const srcFolder = getItemButton(shadowRoot, dom, 'src/');
      const dotIcon = srcFolder.querySelector(
        '[data-item-section="git"] [data-icon-name="file-tree-icon-dot"]'
      );
      expect(dotIcon?.getAttribute('width')).toBe('6');
      expect(dotIcon?.getAttribute('height')).toBe('6');
      expect(dotIcon?.querySelector('use')?.getAttribute('href')).toBe(
        '#pst-test-dot'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('setGitStatus refreshes decorations even when the caller reuses the same array reference', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const runtimeStatuses: GitStatusEntry[] = [
        { path: 'src/index.ts', status: 'modified' },
      ];
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: runtimeStatuses,
        initialExpansion: 'open',
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;
      const wrapperBefore = shadowRoot?.querySelector(
        '[data-file-tree-virtualized-wrapper="true"]'
      );
      expect(
        getItemButton(shadowRoot, dom, 'src/index.ts').getAttribute(
          'data-item-git-status'
        )
      ).toBe('modified');

      runtimeStatuses[0] = { path: 'README.md', status: 'added' };
      fileTree.setGitStatus(runtimeStatuses);
      await flushDom();

      expect(
        shadowRoot
          ?.querySelector('[data-item-path="src/index.ts"]')
          ?.getAttribute('data-item-git-status')
      ).toBeNull();
      expect(
        getItemButton(shadowRoot, dom, 'README.md').getAttribute(
          'data-item-git-status'
        )
      ).toBe('added');
      expect(
        shadowRoot?.querySelector('[data-file-tree-virtualized-wrapper="true"]')
      ).toBe(wrapperBefore);

      fileTree.setGitStatus(undefined);
      await flushDom();

      expect(shadowRoot?.querySelector('[data-item-git-status]')).toBeNull();
      expect(
        shadowRoot?.querySelector('[data-item-contains-git-change="true"]')
      ).toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('custom row decorations and git status render in separate lanes', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);
      const fileTree = new FileTree({
        flattenEmptyDirectories: false,
        gitStatus: [{ path: 'src/index.ts', status: 'modified' }],
        initialExpansion: 'open',
        paths: FILES,
        renderRowDecoration: ({ item }) =>
          item.path === 'src/index.ts'
            ? { text: 'TS', title: 'TypeScript file' }
            : null,
        initialVisibleRowCount: 180 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;
      const indexButton = getItemButton(shadowRoot, dom, 'src/index.ts');
      expect(indexButton.getAttribute('data-item-git-status')).toBe('modified');
      expect(getDecorationLabel(indexButton)).toBe('TS');
      expect(getGitLabel(indexButton)).toBe('M');
      expect(
        indexButton.querySelector('[data-item-section="decoration"]')
      ).not.toBeNull();
      expect(
        indexButton.querySelector('[data-item-section="git"]')
      ).not.toBeNull();

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preload and hydrate preserve git-status attrs without duplicating the SSR wrapper', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree, preloadFileTree } =
        await import('../src/render/FileTree');
      const options = {
        flattenEmptyDirectories: false,
        gitStatus: [{ path: 'src/index.ts', status: 'renamed' as const }],
        id: 'pst-git-status-ssr',
        initialExpansion: 'open' as const,
        paths: FILES,
        initialVisibleRowCount: 180 / 30,
      };
      const payload = preloadFileTree(options);

      expect(payload.shadowHtml).toContain('data-item-git-status="renamed"');
      expect(payload.shadowHtml).toContain(
        'data-item-contains-git-change="true"'
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

      const shadowRoot = host.shadowRoot;
      expect(
        shadowRoot?.querySelectorAll(
          '[data-file-tree-virtualized-wrapper="true"]'
        ).length
      ).toBe(1);
      expect(
        getItemButton(shadowRoot, dom, 'src/index.ts').getAttribute(
          'data-item-git-status'
        )
      ).toBe('renamed');
      expect(
        getItemButton(shadowRoot, dom, 'src/').getAttribute(
          'data-item-contains-git-change'
        )
      ).toBe('true');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
