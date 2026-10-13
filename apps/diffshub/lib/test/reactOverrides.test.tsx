/** @jsxImportSource react */

import {
  getSharedHighlighter,
  parseDiffFromFile,
  resolveThemes,
} from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import type { ThemeLike } from '@pierre/theming';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, createRef } from 'react';
import type { CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ThemedCodeView } from '../../components/ThemedCodeView';
import { ThemedSurface } from '../../components/ThemedSurface';
import { ThemeSourceProvider } from '../../components/ThemeSourceProvider';
import type { ChromeMapping } from '../theme/chromeThemeProps';
import { HIGHLIGHT_THEMES } from '../theme/highlightTheme';

const originalGlobals = {
  document: Reflect.get(globalThis, 'document'),
  Element: Reflect.get(globalThis, 'Element'),
  DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
  HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
  SVGElement: Reflect.get(globalThis, 'SVGElement'),
  Node: Reflect.get(globalThis, 'Node'),
  HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
  HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
  IS_REACT_ACT_ENVIRONMENT: Reflect.get(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean },
    'IS_REACT_ACT_ENVIRONMENT'
  ),
  cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
  requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
  ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
  window: Reflect.get(globalThis, 'window'),
};

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost',
});

const lightTheme: ThemeLike = {
  name: 'light-theme',
  type: 'light',
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#111111',
    'sideBar.background': '#ffffff',
    'sideBar.foreground': '#111111',
  },
};

const darkTheme: ThemeLike = {
  name: 'dark-theme',
  type: 'dark',
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#eeeeee',
    'sideBar.background': '#000000',
    'sideBar.foreground': '#eeeeee',
  },
};

const themeNameMapping: ChromeMapping = (_chrome, theme) =>
  ({
    '--test-theme-name': theme.name ?? '',
  }) as CSSProperties;

class MockResizeObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    DocumentFragment: dom.window.DocumentFragment,
    HTMLPreElement: dom.window.HTMLPreElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    ResizeObserver: MockResizeObserver,
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    window: dom.window,
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.assign(globalThis, { [key]: value });
    }
  }
  dom.window.close();
});

async function flushReact(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('React themed component overrides', () => {
  test('ThemedCodeView preserves caller themeType with a fixed highlighting theme', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const codeViewRef = createRef<CodeViewHandle<undefined, undefined>>();
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemedCodeView
          ref={codeViewRef}
          options={{
            theme: { light: 'github-light', dark: 'github-dark' },
            themeType: 'system',
          }}
          theme={{ light: 'pierre-light', dark: 'pierre-dark' }}
        />
      );
      await flushReact();
    });

    const instance = codeViewRef.current?.getInstance() as
      | {
          options: {
            theme: { light: string; dark: string };
            themeType: string;
          };
        }
      | undefined;
    expect(instance?.options.theme).toEqual(HIGHLIGHT_THEMES);
    expect(instance?.options.themeType).toBe('system');

    await act(async () => {
      root?.unmount();
      await flushReact();
    });
    container.remove();
  });

  test('per-component theme pairs use the provider color scheme', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeSourceProvider theme={darkTheme}>
          <ThemedSurface
            mapping={themeNameMapping}
            theme={{ light: lightTheme, dark: darkTheme }}
          />
        </ThemeSourceProvider>
      );
      await flushReact();
    });

    const surface = container.firstElementChild as HTMLElement;
    expect(surface.style.getPropertyValue('--test-theme-name')).toBe(
      'dark-theme'
    );

    await act(async () => {
      root?.unmount();
      await flushReact();
    });
    container.remove();
  });

  test('theme switches update the palette without tokenizing mounted files and diffs again', async () => {
    await resolveThemes(
      ['pierre-light', 'pierre-dark', 'github-light', 'github-dark'],
      'highlights'
    );
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: [HIGHLIGHT_THEMES.light],
      langs: ['typescript'],
    });
    const tokenize = spyOn(highlighter, 'codeToTokens');
    const container = document.createElement('div');
    document.body.append(container);
    const ref = createRef<CodeViewHandle<undefined, undefined>>();
    const file = { name: 'test.ts', contents: 'const count = 1;\n' };
    const items = [
      { id: 'file', type: 'file' as const, file },
      {
        id: 'diff',
        type: 'diff' as const,
        fileDiff: parseDiffFromFile(file, {
          ...file,
          contents: 'const count = 2;\n',
        }),
      },
    ];
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <ThemedCodeView
            ref={ref}
            items={items}
            theme={{ light: 'pierre-light', dark: 'pierre-dark' }}
            options={{ themeType: 'light' }}
          />
        );
        await flushReact();
      });
      await act(async () => {
        ref.current?.getInstance()?.render(true);
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(tokenize.mock.calls.length).toBeGreaterThan(0);
      expect(ref.current?.getInstance()?.getRenderedItems()).toHaveLength(2);
      const firstTokenCount = tokenize.mock.calls.length;
      const firstPalette = container.firstElementChild?.getAttribute('style');
      for (const themeType of ['dark', 'light'] as const) {
        await act(async () => {
          root.render(
            <ThemedCodeView
              ref={ref}
              items={items}
              theme={{ light: 'github-light', dark: 'github-dark' }}
              options={{ themeType }}
            />
          );
          await flushReact();
        });
        await act(async () => {
          ref.current?.getInstance()?.render(true);
          await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(tokenize.mock.calls.length).toBe(firstTokenCount);
      }
      expect(container.firstElementChild?.getAttribute('style')).not.toBe(
        firstPalette
      );
      expect(container.firstElementChild?.getAttribute('style')).toContain(
        '--diffs-token-keyword'
      );
    } finally {
      act(() => root.unmount());
      tokenize.mockRestore();
      container.remove();
    }
  });
});
