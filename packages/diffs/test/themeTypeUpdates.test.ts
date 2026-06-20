import { afterAll, describe, expect, test } from 'bun:test';

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
  VirtualizedFile,
  VirtualizedFileDiff,
} from '../src';
import { createRoot, installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

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
    }
  });

  test('CodeView-owned virtualized items reject direct themeType changes', () => {
    const { cleanup } = installDom();
    try {
      const viewer = new CodeView();
      const file = new VirtualizedFile({}, viewer);
      const diff = new VirtualizedFileDiff({}, viewer);

      expect(() => file.setThemeType('dark')).toThrow(
        'VirtualizedFile.setThemeType cannot be used inside CodeView. Update CodeView options instead.'
      );
      expect(() => diff.setThemeType('dark')).toThrow(
        'VirtualizedFileDiff.setThemeType cannot be used inside CodeView. Update CodeView options instead.'
      );
    } finally {
      cleanup();
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
    }
  });
});
