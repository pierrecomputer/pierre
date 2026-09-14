import { getSharedHighlighter } from '@pierre/diffs';
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
};

const loadedDarkTheme = {
  name: 'loaded-dark-test',
  appearance: 'dark',
  style: { 'editor.background': '#000' },
};

const loadedShikiTheme = {
  name: 'loaded-shiki-test',
  type: 'dark',
  colors: {
    'editor.foreground': '#abcdef',
    'editor.background': '#123456',
  },
  tokenColors: [
    {
      scope: ['keyword', 'storage'],
      settings: { foreground: '#ff0000' },
    },
  ],
};

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

  test('named theme objects with light and dark fields are not theme pairs', () => {
    const theme = { name: 'custom-palette', light: '#ffffff', dark: '#000000' };
    expect(diffThemeSelectionFromInput(theme, 'dark')).toEqual({
      lightThemeName: theme.name,
      darkThemeName: theme.name,
      colorScheme: 'dark',
    });
  });

  test('Highlights theme inputs register their styles and resolve to names', async () => {
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
      preferredHighlighter: 'highlights',
    });
    const theme = highlighter.getTheme(loadedDarkTheme.name);
    expect('style' in theme ? theme.style : undefined).toEqual(
      loadedDarkTheme.style
    );
  });

  test.each(['shiki-js', 'shiki-wasm'] as const)(
    '%s resolves theme objects and uses their token colors',
    async (preferredHighlighter) => {
      expect(diffThemeSelectionFromInput(loadedShikiTheme, 'dark')).toEqual({
        lightThemeName: loadedShikiTheme.name,
        darkThemeName: loadedShikiTheme.name,
        colorScheme: 'dark',
      });
      const highlighter = await getSharedHighlighter({
        themes: [loadedShikiTheme.name],
        langs: ['typescript'],
        preferredHighlighter,
      });
      const theme = highlighter.getTheme(loadedShikiTheme.name);
      expect('colors' in theme ? theme.colors : undefined).toEqual(
        loadedShikiTheme.colors
      );
      expect(
        highlighter.codeToTokens('const answer = 42;', {
          lang: 'typescript',
          theme,
        }).tokens[0][0].color
      ).toBe('#FF0000');
    }
  );

  test('diff override types require names on theme object inputs', () => {
    acceptDiffThemeInput(loadedDarkTheme);
    acceptDiffThemeInput({
      light: loadedLightTheme,
      dark: 'named-dark-theme',
    });
    acceptDiffThemeInput({
      light: 'named-light-theme',
      dark: loadedShikiTheme,
    });

    // @ts-expect-error Diff surfaces pass names to the worker/highlighter, so
    // object overrides must expose the name used to register the theme.
    acceptDiffThemeInput({ appearance: 'dark', style: {} });

    acceptDiffThemeInput({
      // @ts-expect-error Pair object slots have the same name requirement.
      light: { appearance: 'light', style: {} },
      dark: loadedDarkTheme,
    });
  });

  test('nameless theme inputs still fail with a clear runtime error', () => {
    expect(() =>
      diffThemeSelectionFromInput(
        { appearance: 'dark', style: {} } as unknown as DiffThemeInput,
        'dark'
      )
    ).toThrow('Diff theme objects must include a name');
  });
});
