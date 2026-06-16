// → future @pierre/diffs. Names-now mapping: consumes the selected theme names,
// not the resolved active-theme snapshot, because diffs' prop is name-based and
// it resolves internally. Diffs carries both light/dark names because it passes
// the pair through to Shiki/worker render options (`themes`) so both variants
// are available for fast mode switches; `themeType` only selects the active
// branch for CSS/color-scheme. When diffs accepts resolved objects, this is the
// only mapping that changes.
import {
  type DiffsThemeNames,
  registerCustomTheme,
  type ThemeRegistrationResolved,
  type ThemesType,
  type ThemeTypes,
} from '@pierre/diffs';
import type { ThemeLike } from '@pierre/theming';

import {
  isThemePair,
  requireThemeValueName,
  type ThemeNameSelection,
  type ThemePair,
} from './ThemeSource';

export type DiffThemeValue = string | (ThemeLike & { name: string });
export type DiffThemeInput = DiffThemeValue | ThemePair<DiffThemeValue>;

const seededDiffThemeNames = new Set<string>();

export function diffThemeProps(sel: ThemeNameSelection): {
  theme: ThemesType;
  themeType: ThemeTypes;
} {
  return {
    theme: {
      dark: sel.darkThemeName as DiffsThemeNames,
      light: sel.lightThemeName as DiffsThemeNames,
    },
    themeType: sel.colorScheme,
  };
}

export function diffThemeSelectionFromInput(
  input: DiffThemeInput,
  colorScheme: 'dark' | 'light'
): ThemeNameSelection {
  if (isThemePair(input)) {
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

  const name = requireThemeValueName(value);
  if (!seededDiffThemeNames.has(name)) {
    seededDiffThemeNames.add(name);
    registerCustomTheme(name, () =>
      Promise.resolve(value as ThemeRegistrationResolved)
    );
  }
  return name;
}
