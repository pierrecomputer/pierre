import { describe, expect, test } from 'bun:test';

import { serializeFileTreeSsrPayload } from '../src/ssr';
import { flushDom, installDom } from './helpers/dom';

describe('file-tree header slot', () => {
  test('preloadFileTree includes the header slot outlet', async () => {
    const { preloadFileTree } = await import('../src/render/FileTree');

    const payload = preloadFileTree({
      composition: {
        header: {
          html: '<button data-test-ssr-header>Header action</button>',
        },
      },
      flattenEmptyDirectories: true,
      initialExpansion: 'open',
      paths: ['README.md', 'src/index.ts'],
      initialVisibleRowCount: 120 / 30,
    });

    expect(payload.shadowHtml).toContain('slot name="header"');
    expect(payload.outerEnd).toContain('slot="header"');
    expect(payload.outerEnd).toContain('data-test-ssr-header');
  });

  test('render attaches and cleanup removes host-managed header content', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
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
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      expect(host?.querySelectorAll('[slot="header"]')).toHaveLength(1);
      expect(host?.querySelector('[data-test-header="true"]')).not.toBeNull();

      fileTree.cleanUp();
      expect(host?.querySelector('[slot="header"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('render attaches HTML-only header content without requiring SSR markup', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        composition: {
          header: {
            html: '<button data-test-html-header="true">HTML header</button>',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      expect(host?.querySelectorAll('[slot="header"]')).toHaveLength(1);
      expect(
        host?.querySelector('[data-test-html-header="true"]')?.textContent
      ).toBe('HTML header');

      fileTree.cleanUp();
      expect(host?.querySelector('[slot="header"]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('hydrate keeps header slot content to a single host-managed node', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree, preloadFileTree } =
        await import('../src/render/FileTree');
      const payload = preloadFileTree({
        composition: {
          header: {
            html: '<div data-test-ssr-header="true">Hydrated header</div>',
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['README.md', 'src/index.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }
      expect(host.querySelectorAll('[slot="header"]')).toHaveLength(1);

      const fileTree = new FileTree({
        composition: {
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
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();
      fileTree.render({ fileTreeContainer: host });
      await flushDom();

      expect(host.querySelectorAll('[slot="header"]')).toHaveLength(1);
      expect(
        host.querySelector('[data-test-hydrated-header="true"]')
      ).not.toBeNull();
      expect(
        host.querySelectorAll('[data-test-ssr-header="true"]')
      ).toHaveLength(0);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
