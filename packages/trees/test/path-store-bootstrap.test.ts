import { describe, expect, test } from 'bun:test';
// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

import {
  mountPathStoreTreesBootstrapShell,
  PATH_STORE_TREES_PUBLIC_IDENTITY,
  PathStoreTreesController,
  renderPathStoreTreesBootstrapShell,
} from '../src/path-store/index';

describe('path-store bootstrap lane', () => {
  test('controller snapshot keeps public identity path-first', () => {
    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['z.ts', 'a.ts'],
    });

    const snapshot = controller.getSnapshot();

    expect(snapshot.publicIdentity).toBe(PATH_STORE_TREES_PUBLIC_IDENTITY);
    expect(snapshot.phase).toBe('bootstrap');
    expect(snapshot.firstVisibleItem?.path).toBe('a.ts');
    expect(snapshot.visibleCount).toBe(2);
    expect(Reflect.has(snapshot.firstVisibleItem ?? {}, 'id')).toBe(false);

    controller.destroy();
  });

  test('no-op render shell mounts bootstrap markup into a DOM container', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const container = dom.window.document.createElement('div');
    const controller = new PathStoreTreesController({
      flattenEmptyDirectories: false,
      initialExpansion: 'open',
      paths: ['src/index.ts'],
    });

    const cleanup = mountPathStoreTreesBootstrapShell(container, controller);

    expect(container.innerHTML).toContain('Path-store lane bootstrap shell');
    expect(container.innerHTML).toContain(
      'provisional no-op shell for Phase 0'
    );
    expect(container.innerHTML).toContain('src/');

    cleanup();
    controller.destroy();

    expect(container.innerHTML).toBe('');
  });

  test('controller and bootstrap shell rendering stay SSR-safe without window', () => {
    const originalWindow = Reflect.get(globalThis, 'window');
    const originalDocument = Reflect.get(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');

    try {
      const controller = new PathStoreTreesController({
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        paths: ['README.md'],
      });
      const html = renderPathStoreTreesBootstrapShell(controller.getSnapshot());

      expect(html).toContain('Path-store lane bootstrap shell');
      expect(html).toContain('README.md');

      controller.destroy();
    } finally {
      if (originalWindow !== undefined) {
        Object.assign(globalThis, { window: originalWindow });
      }
      if (originalDocument !== undefined) {
        Object.assign(globalThis, { document: originalDocument });
      }
    }
  });
});
