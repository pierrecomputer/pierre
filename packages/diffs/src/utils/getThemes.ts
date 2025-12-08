import { DEFAULT_THEMES } from '../constants';
import type { DiffsThemeNames, ThemesType } from '../types';

export function getThemes(
  theme: DiffsThemeNames | ThemesType = DEFAULT_THEMES
): DiffsThemeNames[] {
  const themesArr: DiffsThemeNames[] = [];
  if (typeof theme === 'string') {
    themesArr.push(theme);
  } else {
    themesArr.push(theme.dark);
    themesArr.push(theme.light);
  }
  return themesArr;
}
