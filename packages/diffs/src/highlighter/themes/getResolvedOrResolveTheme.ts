import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { ResolvedThemes } from './constants';
import { resolveTheme } from './resolveTheme';

export function getResolvedOrResolveTheme(
  themeName: DiffsThemeNames
): ThemeRegistrationResolved | Promise<ThemeRegistrationResolved> {
  return ResolvedThemes.get(themeName) ?? resolveTheme(themeName);
}
