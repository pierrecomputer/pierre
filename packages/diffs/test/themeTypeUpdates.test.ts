import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewRenderedItem,
  DEFAULT_THEMES,
  disposeHighlighter,
  File,
  type FileContents,
  FileDiff,
  parseDiffFromFile,
  type RenderRange,
} from '../src';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
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

function createRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    root.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? root.scrollTop);
  };
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      bottom: 800,
      height: 800,
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

function makeFile(name: string): FileContents {
  return {
    name,
    contents: 'const value = 1;\n',
  };
}

function makeRange(startingLine: number, totalLines: number): RenderRange {
  return {
    startingLine,
    totalLines,
    bufferBefore: 0,
    bufferAfter: 0,
  };
}

function makeLongFile(name: string, changedValue: number): FileContents {
  const lines = Array.from({ length: 20 }, (_, index) => {
    const value = index === 8 ? changedValue : index;
    return `const value${index} = ${value};`;
  });
  return {
    name,
    contents: `${lines.join('\n')}\n`,
    cacheKey: `${name}:${changedValue}`,
  };
}

function makeDiffItem(id: string): CodeViewDiffItem<undefined> {
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: 'example.ts', contents: 'const value = 1;\n' },
      { name: 'example.ts', contents: 'const value = 2;\n' }
    ),
  };
}

async function waitForRenderedItems(
  viewer: CodeView,
  count: number
): Promise<CodeViewRenderedItem<undefined>[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const renderedItems = viewer.getRenderedItems();
    if (renderedItems.length === count) {
      return renderedItems;
    }
    await wait(10);
  }
  throw new Error('Timed out waiting for CodeView items');
}

async function waitForThemeScheme(
  element: HTMLElement,
  scheme: 'light' | 'dark'
): Promise<HTMLStyleElement> {
  const expected = `color-scheme: ${scheme};`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const style = element.shadowRoot?.querySelector<HTMLStyleElement>(
      'style[data-theme-css]'
    );
    if (style?.textContent?.includes(expected) === true) {
      return style;
    }
    await wait(10);
  }
  throw new Error(`Timed out waiting for ${expected}`);
}

describe('themeType updates', () => {
  test('CodeView applies paired themeType changes on the next render tick', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      themeType: 'light',
    });
    try {
      viewer.setup(createRoot());
      viewer.setItems([
        {
          id: 'file:example.ts',
          type: 'file',
          file: makeFile('example.ts'),
        },
        makeDiffItem('diff:example.ts'),
      ]);
      viewer.render(true);

      const [fileItem, diffItem] = await waitForRenderedItems(viewer, 2);
      expect(fileItem).toBeDefined();
      expect(diffItem).toBeDefined();

      const fileStyle = await waitForThemeScheme(fileItem.element, 'light');
      const diffStyle = await waitForThemeScheme(diffItem.element, 'light');

      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'dark',
      });

      await wait(0);

      expect(fileStyle.textContent).toContain('color-scheme: dark;');
      expect(fileStyle.textContent).not.toContain('color-scheme: light;');
      expect(diffStyle.textContent).toContain('color-scheme: dark;');
      expect(diffStyle.textContent).not.toContain('color-scheme: light;');

      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'light',
      });

      await wait(0);

      expect(fileStyle.textContent).toContain('color-scheme: light;');
      expect(fileStyle.textContent).not.toContain('color-scheme: dark;');
      expect(diffStyle.textContent).toContain('color-scheme: light;');
      expect(diffStyle.textContent).not.toContain('color-scheme: dark;');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
      await disposeHighlighter();
    }
  });

  test('File.setThemeType applies paired themeType changes immediately', async () => {
    const { cleanup } = installDom();
    let instance: File | undefined;
    try {
      const fileContainer = document.createElement('div');
      instance = new File({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'light',
      });

      instance.render({
        file: makeFile('example.ts'),
        fileContainer,
        deferManagers: true,
        preventEmit: true,
      });

      const style = await waitForThemeScheme(fileContainer, 'light');

      instance.setThemeType('dark');
      expect(style.textContent).toContain('color-scheme: dark;');
      expect(style.textContent).not.toContain('color-scheme: light;');

      instance.setThemeType('light');
      expect(style.textContent).toContain('color-scheme: light;');
      expect(style.textContent).not.toContain('color-scheme: dark;');
    } finally {
      instance?.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });

  test('FileDiff.setThemeType applies paired themeType changes immediately', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff | undefined;
    try {
      const fileContainer = document.createElement('div');
      instance = new FileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'light',
      });

      instance.render({
        fileContainer,
        fileDiff: makeDiffItem('diff:example.ts').fileDiff,
        deferManagers: true,
        preventEmit: true,
      });

      const style = await waitForThemeScheme(fileContainer, 'light');

      instance.setThemeType('dark');
      expect(style.textContent).toContain('color-scheme: dark;');
      expect(style.textContent).not.toContain('color-scheme: light;');

      instance.setThemeType('light');
      expect(style.textContent).toContain('color-scheme: light;');
      expect(style.textContent).not.toContain('color-scheme: dark;');
    } finally {
      instance?.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });

  test('File.render applies themeType changes during partial renders', async () => {
    const { cleanup } = installDom();
    let instance: File | undefined;
    try {
      const file = makeLongFile('example.ts', 8);
      const fileContainer = document.createElement('div');
      instance = new File({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'light',
      });

      instance.render({
        file,
        fileContainer,
        renderRange: makeRange(0, 8),
        deferManagers: true,
        preventEmit: true,
      });

      const style = await waitForThemeScheme(fileContainer, 'light');

      instance.setOptions({ ...instance.options, themeType: 'dark' });
      instance.render({
        file,
        fileContainer,
        renderRange: makeRange(4, 8),
        deferManagers: true,
        preventEmit: true,
      });

      expect(style.textContent).toContain('color-scheme: dark;');
      expect(style.textContent).not.toContain('color-scheme: light;');
    } finally {
      instance?.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });

  test('FileDiff.render applies themeType changes during partial renders', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff | undefined;
    try {
      const fileDiff = parseDiffFromFile(
        makeLongFile('example.ts', 8),
        makeLongFile('example.ts', 9)
      );
      const fileContainer = document.createElement('div');
      instance = new FileDiff({
        disableErrorHandling: true,
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'light',
      });

      instance.render({
        fileContainer,
        fileDiff,
        renderRange: makeRange(0, 8),
        deferManagers: true,
        preventEmit: true,
      });

      const style = await waitForThemeScheme(fileContainer, 'light');

      instance.setOptions({ ...instance.options, themeType: 'dark' });
      instance.render({
        fileContainer,
        fileDiff,
        renderRange: makeRange(4, 8),
        deferManagers: true,
        preventEmit: true,
      });

      expect(style.textContent).toContain('color-scheme: dark;');
      expect(style.textContent).not.toContain('color-scheme: light;');
    } finally {
      instance?.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });
});
