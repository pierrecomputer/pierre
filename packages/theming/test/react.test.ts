import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import {
  createThemeController,
  createThemeResolver,
  type ThemeLike,
} from '../src';
import { useThemeController } from '../src/react';

describe('React bindings', () => {
  test('render the controller state and resolved theme', () => {
    const theme: ThemeLike = {
      name: 'react-dark',
      type: 'dark',
      fg: '#ffffff',
      bg: '#000000',
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#ffffff',
        'sideBar.background': '#000000',
        'sideBar.foreground': '#ffffff',
      },
    };
    const resolver = createThemeResolver();
    resolver.seedResolvedTheme('react-dark', theme);
    const controller = createThemeController({
      resolver,
      defaultMode: 'dark',
      defaultDarkThemeName: 'react-dark',
      defaultLightThemeName: 'react-dark',
    });

    function Probe() {
      const state = useThemeController(controller);

      return createElement(
        'span',
        null,
        `${state.mode}|${state.resolvedColorScheme}|${state.resolvedTheme?.name}`
      );
    }

    expect(renderToString(createElement(Probe))).toContain(
      'dark|dark|react-dark'
    );
  });
});
