import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import {
  FILE_TREE_DENSITY_PRESETS,
  resolveFileTreeDensity,
} from '../src/model/density';
import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from '../src/model/virtualization';
import { FileTree, preloadFileTree } from '../src/render/FileTree';
import { serializeFileTreeSsrPayload } from '../src/ssr';

// Stands up just enough of a DOM for the vanilla `FileTree` to mount so we can
// inspect the host element's inline styles after `render()` and `hydrate()`.
function installDom(): {
  cleanup: () => void;
  dom: JSDOM;
} {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
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

describe('resolveFileTreeDensity', () => {
  test('returns the default preset when density is undefined', () => {
    expect(resolveFileTreeDensity(undefined, undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.default.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.default.factor,
    });
  });

  test('resolves keyword presets', () => {
    expect(resolveFileTreeDensity('compact', undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.compact.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.compact.factor,
    });
    expect(resolveFileTreeDensity('relaxed', undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.relaxed.itemHeight,
      factor: FILE_TREE_DENSITY_PRESETS.relaxed.factor,
    });
  });

  test('explicit itemHeight overrides the preset row height but not the factor', () => {
    expect(resolveFileTreeDensity('compact', 28)).toEqual({
      itemHeight: 28,
      factor: FILE_TREE_DENSITY_PRESETS.compact.factor,
    });
  });

  test('numeric density keeps the default row height by default', () => {
    expect(resolveFileTreeDensity(0.85, undefined)).toEqual({
      itemHeight: FILE_TREE_DENSITY_PRESETS.default.itemHeight,
      factor: 0.85,
    });
  });

  test('numeric density still honors an explicit itemHeight', () => {
    expect(resolveFileTreeDensity(1.5, 40)).toEqual({
      itemHeight: 40,
      factor: 1.5,
    });
  });

  test('FILE_TREE_DEFAULT_ITEM_HEIGHT is sourced from the default preset', () => {
    expect(FILE_TREE_DEFAULT_ITEM_HEIGHT).toBe(
      FILE_TREE_DENSITY_PRESETS.default.itemHeight
    );
  });
});

describe('preloadFileTree density host style', () => {
  test('keyword density is inlined on the SSR host element', () => {
    const payload = preloadFileTree({
      density: 'compact',
      paths: ['README.md'],
    });

    const compact = FILE_TREE_DENSITY_PRESETS.compact;
    const expectedStyle = `style="--trees-item-height:${String(compact.itemHeight)}px;--trees-density-override:${String(compact.factor)}"`;

    expect(payload.outerStart).toContain(expectedStyle);
    expect(payload.domOuterStart).toContain(expectedStyle);

    const declarativeHtml = serializeFileTreeSsrPayload(payload);
    const domHtml = serializeFileTreeSsrPayload(payload, 'dom');
    expect(declarativeHtml).toContain(expectedStyle);
    expect(domHtml).toContain(expectedStyle);
  });

  test('numeric density keeps the default row height and inlines the factor', () => {
    const payload = preloadFileTree({
      density: 0.75,
      paths: ['README.md'],
    });

    const expectedStyle = `style="--trees-item-height:${String(FILE_TREE_DENSITY_PRESETS.default.itemHeight)}px;--trees-density-override:0.75"`;

    expect(payload.outerStart).toContain(expectedStyle);
    expect(payload.domOuterStart).toContain(expectedStyle);
  });

  test('explicit itemHeight overrides the preset row height in the host style', () => {
    const payload = preloadFileTree({
      density: 'relaxed',
      itemHeight: 44,
      paths: ['README.md'],
    });

    const relaxed = FILE_TREE_DENSITY_PRESETS.relaxed;
    expect(payload.outerStart).toContain(
      `style="--trees-item-height:44px;--trees-density-override:${String(relaxed.factor)}"`
    );
  });
});

describe('FileTree vanilla render density host style', () => {
  test('render() paints the resolved density vars on the host and exposes them via the model accessors', async () => {
    const { cleanup, dom } = installDom();
    try {
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const fileTree = new FileTree({
        density: 'compact',
        paths: ['README.md', 'src/index.ts'],
      });
      fileTree.render({ containerWrapper: mount });
      await flushDom();

      const host = fileTree.getFileTreeContainer();
      const compact = FILE_TREE_DENSITY_PRESETS.compact;
      expect(host?.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(compact.itemHeight)}px`
      );
      expect(host?.style.getPropertyValue('--trees-density-override')).toBe(
        String(compact.factor)
      );
      expect(fileTree.getItemHeight()).toBe(compact.itemHeight);
      expect(fileTree.getDensityFactor()).toBe(compact.factor);

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('caller-set host inline values win, mirroring the React wrapper', async () => {
    const { cleanup, dom } = installDom();
    try {
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const customHost = dom.window.document.createElement(
        'file-tree-container'
      );
      customHost.style.setProperty('--trees-item-height', '40px');
      customHost.style.setProperty('--trees-density-override', '1.5');
      mount.appendChild(customHost);

      const fileTree = new FileTree({
        density: 'compact',
        paths: ['README.md'],
      });
      fileTree.render({ fileTreeContainer: customHost });
      await flushDom();

      expect(customHost.style.getPropertyValue('--trees-item-height')).toBe(
        '40px'
      );
      expect(
        customHost.style.getPropertyValue('--trees-density-override')
      ).toBe('1.5');

      fileTree.cleanUp();
      // Caller-set inline values must survive cleanUp because the model
      // never owned them. Only vars written by `#applyDensityHostStyle`
      // get stripped.
      expect(customHost.style.getPropertyValue('--trees-item-height')).toBe(
        '40px'
      );
      expect(
        customHost.style.getPropertyValue('--trees-density-override')
      ).toBe('1.5');
    } finally {
      cleanup();
    }
  });

  test('reusing a host with a new density refreshes the model-owned vars', async () => {
    const { cleanup, dom } = installDom();
    try {
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const firstTree = new FileTree({
        density: 'compact',
        paths: ['README.md', 'src/index.ts'],
      });
      firstTree.render({ containerWrapper: mount });
      await flushDom();

      const host = firstTree.getFileTreeContainer();
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected first-render host');
      }

      const compact = FILE_TREE_DENSITY_PRESETS.compact;
      expect(host.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(compact.itemHeight)}px`
      );
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(compact.factor)
      );

      firstTree.cleanUp();
      // cleanUp() must strip the model-owned vars it wrote during mount so
      // the next instance's empty-check guard sees a clean slate. Without
      // this strip the new instance would inherit stale row heights.
      expect(host.style.getPropertyValue('--trees-item-height')).toBe('');
      expect(host.style.getPropertyValue('--trees-density-override')).toBe('');

      const secondTree = new FileTree({
        density: 'relaxed',
        paths: ['README.md', 'src/index.ts'],
      });
      secondTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const relaxed = FILE_TREE_DENSITY_PRESETS.relaxed;
      expect(host.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(relaxed.itemHeight)}px`
      );
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(relaxed.factor)
      );

      secondTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('reusing a host preserves a caller override applied between mounts', async () => {
    const { cleanup, dom } = installDom();
    try {
      const mount = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(mount);

      const firstTree = new FileTree({
        density: 'compact',
        paths: ['README.md'],
      });
      firstTree.render({ containerWrapper: mount });
      await flushDom();

      const host = firstTree.getFileTreeContainer();
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected first-render host');
      }
      firstTree.cleanUp();

      // Caller takes manual control of the row height between mounts. The
      // next mount must respect this rather than reverting to the new
      // model's value.
      host.style.setProperty('--trees-item-height', '52px');

      const secondTree = new FileTree({
        density: 'relaxed',
        paths: ['README.md'],
      });
      secondTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      const relaxed = FILE_TREE_DENSITY_PRESETS.relaxed;
      expect(host.style.getPropertyValue('--trees-item-height')).toBe('52px');
      // The factor was never touched by the caller, so it still tracks the
      // model and should refresh from compact's 0.8 to relaxed's value.
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(relaxed.factor)
      );

      secondTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('hydrate preserves the SSR-supplied inline density vars', async () => {
    const { cleanup, dom } = installDom();
    try {
      const payload = preloadFileTree({
        density: 'compact',
        paths: ['README.md', 'src/index.ts'],
      });

      const mount = dom.window.document.createElement('div');
      mount.innerHTML = serializeFileTreeSsrPayload(payload, 'dom');
      dom.window.document.body.appendChild(mount);

      const host = mount.querySelector('file-tree-container');
      if (!(host instanceof dom.window.HTMLElement)) {
        throw new Error('expected SSR host');
      }

      const compact = FILE_TREE_DENSITY_PRESETS.compact;
      expect(host.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(compact.itemHeight)}px`
      );
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(compact.factor)
      );

      const fileTree = new FileTree({
        density: 'compact',
        id: payload.id,
        paths: ['README.md', 'src/index.ts'],
      });
      fileTree.hydrate({ fileTreeContainer: host });
      await flushDom();

      expect(host.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(compact.itemHeight)}px`
      );
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(compact.factor)
      );

      fileTree.cleanUp();
      // SSR-supplied vars must survive cleanUp because the empty-check guard
      // skipped writing them in the first place — they aren't model-owned.
      expect(host.style.getPropertyValue('--trees-item-height')).toBe(
        `${String(compact.itemHeight)}px`
      );
      expect(host.style.getPropertyValue('--trees-density-override')).toBe(
        String(compact.factor)
      );
    } finally {
      cleanup();
    }
  });
});
