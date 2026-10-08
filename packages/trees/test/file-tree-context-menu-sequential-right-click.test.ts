import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import type { FileTreeContextMenuOpenContext } from '../src/model/publicTypes';
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

// Regression for #664: right-clicking file B while file A's menu is open must
// re-anchor the menu onto B rather than dismiss it. The failure mode is a
// stale close() from menu A's superseded consumer layer (Radix
// `onOpenChange(false)`) firing asynchronously after menu B has already opened
// and tearing menu B down because the close was not tied to a menu instance.
describe('file-tree sequential right-click context menu', () => {
  test('right-clicking a second row re-anchors the menu instead of closing it', async () => {
    const { cleanup, dom } = installDom();
    try {
      const { FileTree } = await import('../src/render/FileTree');
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      // Capture each opened menu's context keyed by the row it was opened for,
      // so we can later fire the stale close() belonging to menu A.
      const contextByPath = new Map<string, FileTreeContextMenuOpenContext>();

      const fileTree = new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: (item, context): HTMLElement => {
              contextByPath.set(item.path, context);
              const menu = dom.window.document.createElement('div');
              menu.dataset.testMenu = 'true';
              menu.dataset.itemPath = item.path;
              return menu as unknown as HTMLElement;
            },
          },
        },
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        paths: ['a.ts', 'b.ts'],
        initialVisibleRowCount: 120 / 30,
      });

      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const shadowRoot = host?.shadowRoot;

      // Open menu A via right-click.
      getItemButton(shadowRoot, dom, 'a.ts').dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        })
      );
      await flushDom();

      let slotted = host?.querySelector(
        '[slot="context-menu"][data-test-menu]'
      );
      expect(slotted).not.toBeNull();
      expect((slotted as HTMLElement | null)?.dataset.itemPath).toBe('a.ts');

      // Right-click a different row while menu A is open. Menu B should open
      // anchored to b.ts.
      getItemButton(shadowRoot, dom, 'b.ts').dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 20,
          clientY: 40,
        })
      );
      await flushDom();

      slotted = host?.querySelector('[slot="context-menu"][data-test-menu]');
      expect(slotted).not.toBeNull();
      expect((slotted as HTMLElement | null)?.dataset.itemPath).toBe('b.ts');

      // Simulate menu A's superseded consumer layer firing its captured close()
      // asynchronously after menu B has opened.
      const staleCloseA = contextByPath.get('a.ts');
      if (staleCloseA == null) {
        throw new Error('expected captured context for a.ts');
      }
      staleCloseA.close();
      await flushDom(2);

      // The menu must still be open and anchored to b.ts.
      slotted = host?.querySelector('[slot="context-menu"][data-test-menu]');
      expect(slotted).not.toBeNull();
      expect((slotted as HTMLElement | null)?.dataset.itemPath).toBe('b.ts');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });
});
