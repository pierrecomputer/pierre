/** @jsxImportSource react */

import type { CodeViewHandle } from '@pierre/diffs/react';
import type { ThemeLike } from '@pierre/theme-kit';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, createRef } from 'react';
import type { CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ChromeMapping } from '../js/chromeThemeProps';
import { ThemedCodeView } from '../react/ThemedCodeView';
import { ThemedSurface } from '../react/ThemedSurface';
import { ThemeProvider } from '../react/ThemeProvider';

const originalGlobals = {
  document: Reflect.get(globalThis, 'document'),
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
  test('ThemedCodeView preserves caller themeType while applying the active theme pair', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const codeViewRef = createRef<CodeViewHandle<undefined>>();
    let root: Root | undefined;

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemedCodeView
          ref={codeViewRef}
          disableWorkerPool
          options={{
            theme: { light: 'old-light', dark: 'old-dark' },
            themeType: 'system',
          }}
          theme={{ light: 'next-light', dark: 'next-dark' }}
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
    expect(instance?.options.theme).toEqual({
      light: 'next-light',
      dark: 'next-dark',
    });
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
        <ThemeProvider theme={darkTheme}>
          <ThemedSurface
            mapping={themeNameMapping}
            theme={{ light: lightTheme, dark: darkTheme }}
          />
        </ThemeProvider>
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
});
