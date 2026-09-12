import { getSharedHighlighter } from '@pierre/diffs';
import type { Theme } from '@pierre/highlights';
import { describe, expect, test } from 'bun:test';

import {
  type DiffThemeInput,
  diffThemeProps,
  diffThemeSelectionFromInput,
} from '../theme/diffThemeProps';

const loadedLightTheme = {
  name: 'loaded-light-test',
  appearance: 'light',
  style: { 'editor.background': '#fff' },
} satisfies Theme;

const loadedDarkTheme = {
  name: 'loaded-dark-test',
  appearance: 'dark',
  style: { 'editor.background': '#000' },
} satisfies Theme;

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

  test('loaded Theme inputs register their styles and resolve to names', async () => {
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
    const highlighter = await getSharedHighlighter({
      themes: [loadedDarkTheme.name],
    });
    const theme = highlighter.getTheme(loadedDarkTheme.name);
    expect('style' in theme ? theme.style : undefined).toEqual(
      loadedDarkTheme.style
    );
  });

  test('diff override types require names on Theme object inputs', () => {
    acceptDiffThemeInput({
      name: 'named-object',
      appearance: 'dark',
      style: {},
    });
    acceptDiffThemeInput({
      light: { name: 'named-light-object', appearance: 'light', style: {} },
      dark: 'named-dark-theme',
    });

    // @ts-expect-error Diff surfaces pass names to the worker/highlighter, so
    // object overrides must expose the name used to register the theme.
    acceptDiffThemeInput({ appearance: 'dark', style: {} });

    acceptDiffThemeInput({
      // @ts-expect-error Pair object slots have the same name requirement.
      light: { appearance: 'light', style: {} },
      dark: { name: 'named-dark-object', appearance: 'dark', style: {} },
    });
  });

  test('nameless Theme inputs still fail with a clear runtime error', () => {
    expect(() =>
      diffThemeSelectionFromInput(
        { appearance: 'dark', style: {} } as DiffThemeInput,
        'dark'
      )
    ).toThrow('Diff theme objects must include a name');
  });
});
