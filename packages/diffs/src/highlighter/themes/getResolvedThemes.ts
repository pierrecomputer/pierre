import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import { ResolvedThemes } from './constants';

// This method should only be called if you know all themes are resolved,
// otherwise it will fail. The main intention is a helper to avoid an async
// tick if we don't actually need it
export function getResolvedThemes(
  themeNames: DiffsThemeNames[]
): ThemeRegistrationResolved[] {
  const resolvedThemes: ThemeRegistrationResolved[] = [];
  for (const themeName of themeNames) {
    const theme = ResolvedThemes.get(themeName);
    if (theme == null) {
      throw new Error(
        `getAllResolvedThemes: ${themeName} is unresolved, you must resolve all necessary themes before calling this function`
      );
    }
    resolvedThemes.push(theme);
  }
  return resolvedThemes;
}
