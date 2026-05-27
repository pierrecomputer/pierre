import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { CodeView } from '../src/components/CodeView';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import { DEFAULT_THEMES } from '../src/constants';
import type {
  CodeViewItem,
  FileContents,
  FileDiffMetadata,
  PostRenderPhase,
} from '../src/types';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    Node: Reflect.get(globalThis, 'Node'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockResizeObserver {
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }

  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const timeout = frames.get(id);
      if (timeout != null) {
        clearTimeout(timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    document: dom.window.document,
    DocumentFragment: dom.window.DocumentFragment,
    Element: dom.window.Element,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    Node: dom.window.Node,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, timeout);
      return id;
    }) as typeof requestAnimationFrame,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  });

  return {
    cleanup() {
      for (const timeout of frames.values()) {
        clearTimeout(timeout);
      }
      frames.clear();

      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
  };
}

function createHydrationContainer(): HTMLElement {
  const container = document.createElement('div');
  container.attachShadow({ mode: 'open' });
  return container;
}

function createRoot(height: number): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    root.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  document.body.appendChild(root);
  return root;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchScroll(root: HTMLElement): void {
  root.dispatchEvent(new window.Event('scroll'));
}

function makeFile(
  name: string,
  label: string,
  lineCount: number
): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `${label} line ${index + 1}`
    ).join('\n'),
  };
}

function makeFileItem(
  id: string,
  label: string,
  lineCount: number
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, label, lineCount),
  };
}

async function renderItems(
  viewer: CodeView,
  items: readonly CodeViewItem[]
): Promise<void> {
  viewer.setItems(items);
  viewer.render(true);
  await wait(0);
}

async function waitForPhases(
  phases: readonly { id: string; phase: PostRenderPhase }[],
  expected: readonly { id: string; phase: PostRenderPhase }[]
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      expect(phases).toEqual(expected);
      return;
    } catch {
      await wait(10);
    }
  }
  expect(phases).toEqual(expected);
}

const file: FileContents = {
  name: 'file.ts',
  contents: 'const value = 1;\n',
};

const unresolvedFile: FileContents = {
  name: 'file.ts',
  contents: `const value = 1;
<<<<<<< HEAD
const conflict = 'current';
=======
const conflict = 'incoming';
>>>>>>> branch
`,
};

const fileDiff: FileDiffMetadata = {
  name: 'file.ts',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: false,
  deletionLines: [],
  additionLines: [],
};

describe('onPostRender phases', () => {
  test('File emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });
      instance.hydrate({ file, fileContainer });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('FileDiff emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ fileDiff, fileContainer });
      instance.hydrate({ fileDiff, fileContainer });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('FileDiff emits unmount for the previous container when render swaps containers', () => {
    const { cleanup } = installDom();
    const firstContainer = createHydrationContainer();
    const secondContainer = createHydrationContainer();
    const phases: { container: 'first' | 'second'; phase: PostRenderPhase }[] =
      [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(node, _instance, phase) {
        phases.push({
          container: node === firstContainer ? 'first' : 'second',
          phase,
        });
      },
    });

    try {
      instance.render({ fileDiff, fileContainer: firstContainer });
      instance.render({ fileDiff, fileContainer: secondContainer });

      expect(phases).toEqual([
        { container: 'first', phase: 'mount' },
        { container: 'first', phase: 'unmount' },
        { container: 'second', phase: 'mount' },
      ]);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('UnresolvedFile emits mount, update, and unmount around cleanup', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new UnresolvedFile({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file: unresolvedFile, fileContainer });
      instance.hydrate({ file: unresolvedFile, fileContainer });
      instance.cleanUp();
      instance.cleanUp();

      expect(phases).toEqual(['mount', 'update', 'unmount']);
    } finally {
      cleanup();
    }
  });

  test('File placeholder rendering unmounts once and allows remount', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });
      instance.renderPlaceholder(24);
      instance.renderPlaceholder(48);
      instance.hydrate({ file, fileContainer });

      expect(phases).toEqual(['mount', 'unmount', 'mount']);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('FileDiff placeholder rendering unmounts once and allows remount', () => {
    const { cleanup } = installDom();
    const phases: PostRenderPhase[] = [];
    const instance = new FileDiff({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        phases.push(phase);
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ fileDiff, fileContainer });
      instance.renderPlaceholder(24);
      instance.renderPlaceholder(48);
      instance.hydrate({ fileDiff, fileContainer });

      expect(phases).toEqual(['mount', 'unmount', 'mount']);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('cleanup propagates File unmount callback errors', () => {
    const { cleanup } = installDom();
    const instance = new File({
      collapsed: true,
      disableFileHeader: true,
      onPostRender(_node, _instance, phase) {
        if (phase === 'unmount') {
          throw new Error('unmount failed');
        }
      },
    });
    const fileContainer = createHydrationContainer();

    try {
      instance.hydrate({ file, fileContainer });

      expect(() => instance.cleanUp()).toThrow('unmount failed');
      instance.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('CodeView forwards unmount when a rendered item scrolls out', async () => {
    const { cleanup } = installDom();
    const phases: { id: string; phase: PostRenderPhase }[] = [];
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, _instance, phase, context) {
        phases.push({ id: context.item.id, phase });
      },
    });
    const root = createRoot(120);
    const items = [
      makeFileItem('file:first', 'first content', 100),
      makeFileItem('file:second', 'second content', 100),
    ];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      await waitForPhases(phases, [{ id: 'file:first', phase: 'mount' }]);

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      await waitForPhases(phases, [
        { id: 'file:first', phase: 'mount' },
        { id: 'file:first', phase: 'unmount' },
        { id: 'file:second', phase: 'mount' },
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
