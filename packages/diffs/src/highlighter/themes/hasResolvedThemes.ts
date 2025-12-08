import type { DiffsThemeNames } from '../../types';
import { ResolvedThemes } from './constants';

export function hasResolvedThemes(themeNames: DiffsThemeNames[]): boolean {
  for (const themeName of themeNames) {
    if (!ResolvedThemes.has(themeName)) {
      return false;
    }
  }
  return true;
}
