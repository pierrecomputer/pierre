import type { DiffsThemeNames, ThemesType } from '../types';

export function areThemesEqual(
  themeA: DiffsThemeNames | ThemesType | undefined,
  themeB: DiffsThemeNames | ThemesType | undefined
): boolean {
  if (
    themeA == null ||
    themeB == null ||
    typeof themeA === 'string' ||
    typeof themeB === 'string'
  ) {
    return themeA === themeB;
  }
  return themeA.dark === themeB.dark && themeA.light === themeB.light;
}
