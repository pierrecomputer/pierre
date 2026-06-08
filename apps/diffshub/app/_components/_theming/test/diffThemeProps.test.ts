import type { ThemeLike } from '@pierre/theming';
import { describe, expect, test } from 'bun:test';

import {
  type DiffThemeInput,
  diffThemeProps,
  diffThemeSelectionFromInput,
} from '../js/diffThemeProps';

const loadedLightTheme = {
  name: 'loaded-light-test',
  type: 'light',
  colors: { 'editor.background': '#fff' },
} satisfies ThemeLike & { name: string };

const loadedDarkTheme = {
  name: 'loaded-dark-test',
  type: 'dark',
  colors: { 'editor.background': '#000' },
} satisfies ThemeLike & { name: string };

function acceptDiffThemeInput(_input: DiffThemeInput): void {}

describe('diffThemeProps', () => {
  test('passes selection names through as { theme, themeType }', () => {
    expect(
      diffThemeProps({
        lightThemeName: 'github-light',
        darkThemeName: 'ayu-dark',
        colorScheme: 'dark',
      })
    ).toEqual({
      theme: { light: 'github-light', dark: 'ayu-dark' },
      themeType: 'dark',
    });
  });

  test('themeType follows the selection colorScheme', () => {
    expect(
      diffThemeProps({
        lightThemeName: 'a',
        darkThemeName: 'b',
        colorScheme: 'light',
      }).themeType
    ).toBe('light');
  });

  test('single fixed theme inputs resolve to the same light and dark name', () => {
    expect(diffThemeSelectionFromInput('fixed-theme', 'dark')).toEqual({
      lightThemeName: 'fixed-theme',
      darkThemeName: 'fixed-theme',
      colorScheme: 'dark',
    });
  });

  test('{ light, dark } inputs resolve to matching light and dark names', () => {
    expect(
      diffThemeSelectionFromInput(
        { light: 'pair-light', dark: 'pair-dark' },
        'light'
      )
    ).toEqual({
      lightThemeName: 'pair-light',
      darkThemeName: 'pair-dark',
      colorScheme: 'light',
    });
  });

  test('loaded ThemeLike inputs seed by theme.name and resolve to names', () => {
    expect(
      diffThemeSelectionFromInput(
        { light: loadedLightTheme, dark: loadedDarkTheme },
        'dark'
      )
    ).toEqual({
      lightThemeName: 'loaded-light-test',
      darkThemeName: 'loaded-dark-test',
      colorScheme: 'dark',
    });
  });

  test('diff override types require names on ThemeLike object inputs', () => {
    acceptDiffThemeInput({ name: 'named-object', type: 'dark' });
    acceptDiffThemeInput({
      light: { name: 'named-light-object', type: 'light' },
      dark: 'named-dark-theme',
    });

    // @ts-expect-error Diff surfaces pass names to the worker/highlighter, so
    // object overrides must expose the name used to register the theme.
    acceptDiffThemeInput({ type: 'dark', colors: {} });

    acceptDiffThemeInput({
      // @ts-expect-error Pair object slots have the same name requirement.
      light: { type: 'light', colors: {} },
      dark: { name: 'named-dark-object', type: 'dark' },
    });
  });

  test('nameless ThemeLike inputs still fail with a clear runtime error', () => {
    expect(() =>
      diffThemeSelectionFromInput(
        { type: 'dark', colors: {} } as DiffThemeInput,
        'dark'
      )
    ).toThrow('ThemeInput ThemeLike values used by diff wrappers');
  });
});
