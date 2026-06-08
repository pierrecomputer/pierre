import type { DiffsThemeNames, ThemeRegistrationResolved } from '../../types';
import {
  prepareThemeResolution,
  validateResolvedThemeName,
} from './themeResolution';
import { themeResolver } from './themeResolver';

export async function resolveThemes(
  themes: DiffsThemeNames[]
): Promise<ThemeRegistrationResolved[]> {
  for (const themeName of themes) {
    prepareThemeResolution(themeName);
  }

  const resolvedThemes = await themeResolver.resolveThemes(themes);
  for (let i = 0; i < themes.length; i++) {
    validateResolvedThemeName(themes[i], resolvedThemes[i]);
  }

  return resolvedThemes;
}
