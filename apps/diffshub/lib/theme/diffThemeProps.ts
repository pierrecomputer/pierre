// Maps selected theme names to diff options, registering Highlights theme
// objects before the highlighter or workers resolve those names.
import {
  registerCustomTheme,
  type ThemesType,
  type ThemeTypes,
} from '@pierre/diffs';
import type { Theme } from '@pierre/highlights';

import type { ThemeNameSelection, ThemePair } from './ThemeSource';

export type DiffThemeValue = string | Theme;
export type DiffThemeInput = DiffThemeValue | ThemePair<DiffThemeValue>;

const seededDiffThemeNames = new Set<string>();

export function diffThemeProps(sel: ThemeNameSelection): {
  theme: ThemesType;
  themeType: ThemeTypes;
} {
  return {
    theme: {
      dark: sel.darkThemeName,
      light: sel.lightThemeName,
    },
    themeType: sel.colorScheme,
  };
}

export function diffThemeSelectionFromInput(
  input: DiffThemeInput,
  colorScheme: 'dark' | 'light'
): ThemeNameSelection {
  if (typeof input === 'object' && 'light' in input && 'dark' in input) {
    return {
      lightThemeName: nameForDiffThemeValue(input.light),
      darkThemeName: nameForDiffThemeValue(input.dark),
      colorScheme,
    };
  }
  const name = nameForDiffThemeValue(input);
  return { lightThemeName: name, darkThemeName: name, colorScheme };
}

function nameForDiffThemeValue(value: DiffThemeValue): string {
  if (typeof value === 'string') return value;

  const { name } = value;
  if (name == null || name === '') {
    throw new Error('Diff theme objects must include a name');
  }
  if (!seededDiffThemeNames.has(name)) {
    seededDiffThemeNames.add(name);
    registerCustomTheme(name, () => Promise.resolve(value));
  }
  return name;
}
